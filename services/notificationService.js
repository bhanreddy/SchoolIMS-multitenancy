// services/notificationService.js

import admin from '../config/firebase.js';
import sql from '../db.js';
import { NotificationEventConfig } from './notificationEventConfig.js';
import { NotificationTemplateService } from './notificationTemplateService.js';

// Constants
const BATCH_SIZE = 500;
const MAX_RETRIES = 3;

/**
 * Send notification by resolving tokens internally from user IDs
 * Includes batching (500 limit) and retry logic.
 * @param {number[]} userIds
 * @param {string} type
 * @param {object} params
 */
export async function sendNotificationToUsers(userIds = [], type, params = {}) {
    if (!userIds || userIds.length === 0) return { successCount: 0, failureCount: 0 };

    // 1️⃣ Validate Event Mapping & Render
    let renderResult;
    try {
        renderResult = NotificationTemplateService.render(type, params);
    } catch (err) {
        console.error(`[Notification] Template error for ${type}:`, err.message);
        return { successCount: 0, failureCount: 0 };
    }

    const { title, body, deepLink, android } = renderResult;
    const soundFile = NotificationEventConfig[type].sound;
    const channelId = android.channelId;

    // 2️⃣ Kill Switch Check
    if (await isKillSwitchActive(type)) {
        return { successCount: 0, failureCount: 0 };
    }

    // 3️⃣ Fetch Tokens & Preferences
    let userTokensAndPrefs = await fetchTokens(userIds);
    if (!userTokensAndPrefs || userTokensAndPrefs.length === 0) return { successCount: 0, failureCount: 0 };

    // Group by preference
    const customSoundTokens = userTokensAndPrefs.filter(d => d.notification_sound === 'custom').map(d => d.fcm_token);
    const defaultSoundTokens = userTokensAndPrefs.filter(d => d.notification_sound === 'default').map(d => d.fcm_token);

    // 4️⃣ Chunk and Send (Sequential batches to avoid exploding memory/connections)
    let totalSuccess = 0;
    let totalFailure = 0;

    // Send Custom Sound Batches
    if (customSoundTokens.length > 0) {
        for (let i = 0; i < customSoundTokens.length; i += BATCH_SIZE) {
            const tokenChunk = customSoundTokens.slice(i, i + BATCH_SIZE);
            const { success, failure } = await sendBatch(tokenChunk, { title, body, deepLink, soundFile, channelId: `${channelId}_custom`, type, customSound: true });
            totalSuccess += success;
            totalFailure += failure;
        }
    }

    // Send Default Sound Batches
    if (defaultSoundTokens.length > 0) {
        for (let i = 0; i < defaultSoundTokens.length; i += BATCH_SIZE) {
            const tokenChunk = defaultSoundTokens.slice(i, i + BATCH_SIZE);
            const { success, failure } = await sendBatch(tokenChunk, { title, body, deepLink, soundFile: 'default', channelId: `${channelId}_default`, type, customSound: false });
            totalSuccess += success;
            totalFailure += failure;
        }
    }

    // 5️⃣ Log Final Summary
    await logNotificationSummary(type, totalSuccess, totalFailure);

    console.log(`[Notification] ${type} sent: ${totalSuccess} ok, ${totalFailure} failed`);
    return { successCount: totalSuccess, failureCount: totalFailure };
}

/**
 * Process a single batch of up to 500 tokens
 */
async function sendBatch(tokens, { title, body, deepLink, soundFile, channelId, type, customSound = true }) {
    if (tokens.length === 0) return { success: 0, failure: 0 };

    const message = {
        tokens,
        notification: { title, body },
        android: {
            notification: {
                sound: soundFile && soundFile !== 'default' ? soundFile.replace(/\.[^/.]+$/, "") : 'default',
                channelId: channelId
            }
        },
        apns: {
            payload: {
                aps: { sound: soundFile }
            }
        },
        data: {
            type,
            deepLink: deepLink || ''
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
            failure: (response.failureCount - retryTokens.length) + retryFailure
        };

    } catch (error) {
        console.error('[Notification] Batch Send Failed:', error);
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
    await new Promise(r => setTimeout(r, 1000));

    const retryMsg = { ...originalMessage, tokens };
    try {
        const response = await admin.messaging().sendEachForMulticast(retryMsg);
        return { success: response.successCount, failure: response.failureCount };
    } catch (err) {
        console.warn('[Notification] Retry failed:', err.message);
        return { success: 0, failure: tokens.length };
    }
}

// Helpers

async function isKillSwitchActive(type) {
    try {
        const [row] = await sql`SELECT value FROM notification_config WHERE key = 'kill_switch' LIMIT 1`;
        if (row && row.value) {
            if (row.value.global) {
                console.warn(`[Notification] Global kill switch active. Skipping ${type}`);
                return true;
            }
            if (row.value.types && row.value.types[type]) {
                console.warn(`[Notification] Kill switch active for ${type}`);
                return true;
            }
        }
        return false;
    } catch (err) {
        return false; // Fail open
    }
}

async function fetchTokens(userIds) {
    try {
        const devices = await sql`
            SELECT ud.fcm_token, COALESCE(us.notification_sound, 'custom') as notification_sound
            FROM user_devices ud
            LEFT JOIN user_settings us ON ud.user_id = us.user_id
            WHERE ud.user_id IN ${sql(userIds)}
        `;
        return devices;
    } catch (err) {
        console.error('[Notification] Token fetch failed:', err.message);
        return [];
    }
}

async function removeInvalidTokens(tokens) {
    try {
        await sql`DELETE FROM user_devices WHERE fcm_token IN ${sql(tokens)}`;
    } catch (err) {
        console.warn('[Notification] Failed to clean tokens:', err.message);
    }
}

async function logNotificationSummary(type, success, failure) {
    try {
        const status = failure === 0 ? 'success' : (success === 0 ? 'failed' : 'partial');
        await sql`
            INSERT INTO notification_logs (notification_type, status, provider_response, created_at)
            VALUES (${type}, ${status}, ${JSON.stringify({ success, failure })}, NOW())
        `;
    } catch (err) {
        console.warn('[Notification] Log failed:', err.message);
    }
}
