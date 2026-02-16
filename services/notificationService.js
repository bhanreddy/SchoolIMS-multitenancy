// services/notificationService.js

import admin from 'firebase-admin';
import sql from '../db.js';
import { NotificationEventConfig } from './notificationEventConfig.js';
import { NotificationTemplateService } from './notificationTemplateService.js';

/**
 * Send notification by resolving tokens internally from user IDs
 * @param {number[]} userIds
 * @param {string} type
 * @param {object} params
 */
export async function sendNotificationToUsers(userIds = [], type, params = {}) {
    if (!userIds || userIds.length === 0) return { successCount: 0, failureCount: 0 };

    // 1️⃣ Validate Event Mapping
    const eventConfig = NotificationEventConfig[type];
    if (!eventConfig) {
        throw new Error(`NotificationEventConfig missing mapping for type: ${type}`);
    }

    const soundFile = eventConfig.sound;
    const androidSound = soundFile.replace('.wav', '');

    // 2️⃣ Kill Switch Check
    const [config] = await sql`
    SELECT enabled FROM notification_config
    WHERE type = ${type}
    LIMIT 1
  `;

    if (config && config.enabled === false) {
        console.warn(`[Notification] Kill switch active for type: ${type}`);
        return { successCount: 0, failureCount: 0 };
    }

    // 3️⃣ Fetch Tokens (single query, batched)
    const devices = await sql`
    SELECT fcm_token
    FROM user_devices
    WHERE user_id IN ${sql(userIds)}
  `;

    if (!devices || devices.length === 0) return { successCount: 0, failureCount: 0 };

    const tokens = devices.map(d => d.fcm_token);

    // 4️⃣ Render Template
    const { title, body, deepLink } = NotificationTemplateService.render(type, params);

    const message = {
        tokens,
        notification: {
            title,
            body
        },
        android: {
            notification: {
                sound: androidSound,
                channelId: androidSound
            }
        },
        apns: {
            payload: {
                aps: {
                    sound: soundFile
                }
            }
        },
        data: {
            type,
            deepLink: deepLink || ''
        }
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);

        // 5️⃣ Log Summary
        await sql`
      INSERT INTO notification_logs (type, success_count, failure_count, created_at)
      VALUES (${type}, ${response.successCount}, ${response.failureCount}, NOW())
    `;

        // 6️⃣ Remove Invalid Tokens
        const invalidTokens = [];

        response.responses.forEach((res, index) => {
            if (!res.success) {
                const errorCode = res.error?.code;
                if (
                    errorCode === 'messaging/invalid-registration-token' ||
                    errorCode === 'messaging/registration-token-not-registered'
                ) {
                    invalidTokens.push(tokens[index]);
                }
            }
        });

        if (invalidTokens.length > 0) {
            await sql`
        DELETE FROM user_devices
        WHERE fcm_token IN ${sql(invalidTokens)}
      `;
        }

        return { successCount: response.successCount, failureCount: response.failureCount };

    } catch (error) {
        console.error('[Notification] Send failed:', error);
        // Do NOT throw — never break business flow
        return { successCount: 0, failureCount: 0 };
    }

}
