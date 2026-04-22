// services/notificationService.js

import { randomUUID } from 'crypto';
import admin from '../config/firebase.js';
import sql from '../db.js';
import { NotificationEventConfig } from './notificationEventConfig.js';
import { NotificationTemplateService } from './notificationTemplateService.js';

// Constants
const BATCH_SIZE = 500;

// Cache for Kill Switch (Fix 5)
let killSwitchCache = null;
let lastKillSwitchCheck = 0;
const CACHE_TTL = 60000; // 60 seconds

/**
 * Send notification by resolving tokens internally from user IDs
 * Includes batching (500 limit) and retry logic.
 * @param {number[]} userIds
 * @param {string} type
 * @param {object} params
 */
export async function sendNotificationToUsers(userIds = [], type, params = {}, context = {}) {
  if (!userIds || userIds.length === 0) return { successCount: 0, failureCount: 0 };

  // 1️⃣ Validate Event Mapping & Render
  let renderResult;
  try {
    renderResult = NotificationTemplateService.render(type, params);
  } catch (err) {
    console.error('Template render error:', err);
    await logNotificationSummary({ type, errorMessage: err.message }); // Log template failure
    return { successCount: 0, failureCount: 0 };
  }

  const soundFile = NotificationEventConfig[type].sound;
  const channelId = renderResult.android.channelId;

  // 2️⃣ Kill Switch Check
  if (await isKillSwitchActive(type)) {
    return { successCount: 0, failureCount: 0 };
  }

  // 3️⃣ Fetch Tokens with language preference
  let userTokens = await fetchTokens(userIds);
  if (!userTokens || userTokens.length === 0) return { successCount: 0, failureCount: 0 };

  // 4️⃣ Group tokens by language and render per-language templates
  let totalSuccess = 0;
  let totalFailure = 0;

  // Group by language_code (default 'en')
  const langGroups = {};
  for (const device of userTokens) {
    const lang = device.language_code || 'en';
    if (!langGroups[lang]) langGroups[lang] = [];
    langGroups[lang].push(device.fcm_token);
  }

  const batchPromises = [];

  for (const [lang, tokens] of Object.entries(langGroups)) {
    // Render templates in this language
    let langRender;
    try {
      langRender = NotificationTemplateService.render(type, params, lang);
    } catch (err) {

      langRender = renderResult; // Fall back to English
    }

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const tokenChunk = tokens.slice(i, i + BATCH_SIZE);
      batchPromises.push(sendBatch(tokenChunk, {
        title: langRender.title,
        body: langRender.body,
        deepLink: langRender.deepLink,
        soundFile,
        channelId: `${channelId}_custom`,
        type,
        customSound: true
      }));
    }
  }

  // Count total tokens from langGroups
  const totalTokenCount = Object.values(langGroups)
    .reduce((sum, tokens) => sum + tokens.length, 0);

  const results = await Promise.all(batchPromises);
  results.forEach((res) => {
    totalSuccess += res.success;
    totalFailure += res.failure;
  });

  // 5️⃣ Log Final Summary
  await logNotificationSummary({
    type,
    tokensTargeted: totalTokenCount,
    tokensSent: totalSuccess,
    tokensFailed: totalFailure,
    channelId: renderResult.android?.channelId,
    senderId: context.senderId || null,
    batchId: context.batchId || null,
    role: context.role || null
  });

  return { successCount: totalSuccess, failureCount: totalFailure };
}

/**
 * Process a single batch of up to 500 tokens
 */
async function sendBatch(tokens, { title, body, deepLink, soundFile, channelId, type, customSound = true }) {
  if (tokens.length === 0) return { success: 0, failure: 0 };

  // soundBase = filename without extension (required by Android's raw res lookup).
  // FCM will automatically add .wav/.mp3 when playing; the raw resource must be
  // named exactly <soundBase>.wav in android/app/src/main/res/raw/.
  const soundBase = soundFile && soundFile !== 'default' ? soundFile.replace(/\.[^/.]+$/, "") : 'default';

  const message = {
    tokens,

    // TOP-LEVEL notification block — REQUIRED for background/killed delivery.
    // Without this, Android's FCM SDK has nothing to render in the system tray
    // when JS is not running, and the user sees an empty/silent notification.
    notification: {
      title,
      body
    },

    android: {
      priority: 'high',        // Delivered even in Doze mode
      ttl: 86400 * 1000,       // TTL is in MILLISECONDS for admin SDK, not seconds
      notification: {
        title,                 // Override for Android-specific customization
        body,
        channelId: channelId,  // Must match a channel created on the device
        sound: soundBase,      // Raw resource name WITHOUT extension (e.g. "voice_alert")
        defaultSound: false,
        priority: 'high',
        visibility: 'public',
        notificationPriority: 'PRIORITY_MAX',
        notificationCount: 1
      }
    },

    apns: {
      headers: {
        'apns-priority': '10',      // 10 = immediate delivery (required for alert)
        'apns-push-type': 'alert'   // Required on iOS 13+ when showing an alert
      },
      payload: {
        aps: {
          alert: {
            title,
            body
          },
          sound: soundFile || 'default',   // iOS expects the full filename (with .wav)
          badge: 1,
          'mutable-content': 1             // Allow Notification Service Extension
          // NOTE: Do NOT set 'content-available: 1' together with alert.
          // That combo makes iOS treat the message as silent/background-only
          // and the banner may not appear reliably in killed state.
        }
      }
    },

    data: {
      type: String(type),
      deepLink: String(deepLink || ''),
      title: String(title || ''),   // Kept for foreground onMessage fallback
      body: String(body || ''),
      channelId: String(channelId),
      sound: String(soundBase),
      messageId: String(randomUUID())
    }
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    const invalidTokens = [];
    const retryTokens = [];

    // Analyze responses
    response.responses.forEach((res, index) => {
      if (!res.success) {
        const code = res.error?.code;
        if (code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered') {
          invalidTokens.push(tokens[index]);
        } else if (code === 'messaging/server-unavailable' || code === 'messaging/internal-error') {
          // Transient errors eligible for retry
          retryTokens.push(tokens[index]);
        }
      }
    });

    // Auto-clean invalid tokens
    if (invalidTokens.length > 0) {
      await removeInvalidTokens(invalidTokens);
    }

    let retrySuccess = 0;
    let retryFailure = 0;

    // Simple Retry Logic for transient errors (1 attempt)
    if (retryTokens.length > 0) {
      const retryRes = await retrySend(retryTokens, message);
      retrySuccess = retryRes.success;
      retryFailure = retryRes.failure;
    }

    return {
      success: response.successCount + retrySuccess,
      failure: response.failureCount - retryTokens.length + retryFailure
    };

  } catch (error) {

    return { success: 0, failure: tokens.length };
  }
}

/**
 * Retry helper for transient errors (recursion or loop could be added for MAX_RETRIES)
 * Currently implementing 1-hop retry for simplicity and safety.
 */
async function retrySend(tokens, originalMessage) {
  if (tokens.length === 0) return { success: 0, failure: 0 };

  // Wait 1000ms before retry
  await new Promise((r) => setTimeout(r, 1000));

  const retryMsg = { ...originalMessage, tokens };
  try {
    const response = await admin.messaging().sendEachForMulticast(retryMsg);
    return { success: response.successCount, failure: response.failureCount };
  } catch (err) {

    return { success: 0, failure: tokens.length };
  }
}

// Helpers

async function isKillSwitchActive(type) {
  const now = Date.now();

  // Fix 5: Use cached kill switch status if fresh
  if (killSwitchCache && now - lastKillSwitchCheck < CACHE_TTL) {
    return checkCache(type);
  }

  try {
    const [row] = await sql`SELECT value FROM notification_config WHERE key = 'kill_switch' LIMIT 1`;
    killSwitchCache = row?.value || null;
    lastKillSwitchCheck = now;
    return checkCache(type);
  } catch (err) {
    return false; // Fail open
  }
}

function checkCache(type) {
  if (!killSwitchCache) return false;
  if (killSwitchCache.global) {

    return true;
  }
  if (killSwitchCache.types && killSwitchCache.types[type]) {

    return true;
  }
  return false;
}

async function fetchTokens(userIds) {
  try {
    const devices = await sql`
            SELECT ud.fcm_token, COALESCE(ud.language_code, 'en') AS language_code
            FROM user_devices ud
            WHERE ud.user_id = ANY(${userIds})
            AND ud.is_active = TRUE
        `;
    return devices;
  } catch (err) {

    return [];
  }
}

async function removeInvalidTokens(tokens) {
  try {
    await sql`
            UPDATE user_devices
            SET is_active = FALSE, updated_at = NOW()
            WHERE fcm_token = ANY(${tokens})
        `;
  } catch (err) {

  }
}

async function logNotificationSummary({
  type,
  tokensTargeted = 0,
  tokensSent = 0,
  tokensFailed = 0,
  channelId = null,
  senderId = null,
  batchId = null,
  role = null,
  errorMessage = null,
  providerResponse = null
}) {
  try {
    const status = tokensFailed === 0 ? 'success' : tokensSent === 0 ? 'failed' : 'partial';
    await sql`
            INSERT INTO notification_logs (
                user_id, batch_id, notification_type, role, channel_id,
                push_provider, tokens_targeted, tokens_sent, tokens_failed,
                error_message, provider_response, status
            ) VALUES (
                ${senderId}, ${batchId}, ${type}, ${role}, ${channelId},
                'fcm', ${tokensTargeted}, ${tokensSent}, ${tokensFailed},
                ${errorMessage}, ${providerResponse ? JSON.stringify(providerResponse) : null}, ${status}
            )
        `;
  } catch (err) {

  }
}