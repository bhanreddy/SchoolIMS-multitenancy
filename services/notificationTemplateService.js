/**
 * Notification Template Service
 * 
 * Centralized template rendering for all notification types.
 * Uses NotificationEventConfig as the source of truth.
 */
import { NotificationEventConfig } from './notificationEventConfig.js';

export const NotificationTemplateService = {
    /**
     * Renders a notification template.
     * @param {string} type - One of the template keys from NotificationEventConfig
     * @param {object} params - Dynamic parameters
     * @returns {object} { title, body, deepLink, android: { channelId } }
     * @throws {Error} If type is invalid or params are missing
     */
    render(type, params) {
        const config = NotificationEventConfig[type];
        if (!config) {
            throw new Error(`Invalid notification type: ${type}`);
        }

        // Validate required parameters
        const requiredParams = config.requiredParams || [];
        const missingParams = requiredParams.filter(p => !params[p]);
        if (missingParams.length > 0) {
            throw new Error(`Missing required parameters for ${type}: ${missingParams.join(', ')}`);
        }

        // Render templates
        let title = config.titleTemplate;
        let body = config.bodyTemplate;

        // Replace placeholders
        Object.keys(params).forEach(key => {
            const value = params[key];
            const regex = new RegExp(`{{${key}}}`, 'g');
            title = title.replace(regex, value);
            body = body.replace(regex, value);
        });

        // Final check for unplaced variables (sanity check)
        if (body.includes('{{') || title.includes('{{')) {
            throw new Error(`Template rendering failed. Unreplaced placeholders in ${type}`);
        }

        return {
            title,
            body,
            deepLink: config.deepLink,
            android: {
                channelId: config.channelId
            }
        };
    }
};
