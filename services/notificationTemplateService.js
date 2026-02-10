export const NotificationTypes = {
    GENERAL: 'GENERAL',
    EMERGENCY: 'EMERGENCY',
    EXAM: 'EXAM',
    FEES: 'FEES',
    ATTENDANCE_ABSENT: 'ATTENDANCE_ABSENT'
};

const TEMPLATES = {
    [NotificationTypes.GENERAL]: {
        channelId: 'default_voice',
        titleTemplate: 'Notification',
        bodyTemplate: '{{message}}',
        deepLink: '/(tabs)/home',
        requiredParams: ['message']
    },
    [NotificationTypes.EMERGENCY]: {
        channelId: 'emergency',
        titleTemplate: 'EMERGENCY ALERT',
        bodyTemplate: '{{message}}',
        deepLink: '/announcements',
        requiredParams: ['message']
    },
    [NotificationTypes.EXAM]: {
        channelId: 'exam',
        titleTemplate: 'Exam: {{examName}}',
        bodyTemplate: 'Scheduled on {{date}}.', // Kept simple as per "No full sentences" preference, but needed grammar.
        deepLink: '/student/exams',
        requiredParams: ['examName', 'date']
    },
    [NotificationTypes.FEES]: {
        channelId: 'fees',
        titleTemplate: 'Fee Reminder',
        bodyTemplate: '₹{{amount}} due for {{month}}.',
        deepLink: '/student/fees',
        requiredParams: ['amount', 'month']
    },
    [NotificationTypes.ATTENDANCE_ABSENT]: {
        channelId: 'attendance',
        titleTemplate: 'Attendance Alert',
        bodyTemplate: 'Absent on {{date}}.',
        deepLink: '/student/attendance',
        requiredParams: ['date']
    }
};

export const NotificationTemplateService = {
    /**
     * Renders a notification template.
     * @param {string} type - One of NotificationTypes
     * @param {object} params - Dynamic parameters
     * @returns {object} { title, body, android: { channelId } }
     * @throws {Error} If type is invalid or params are missing
     */
    render(type, params) {
        const template = TEMPLATES[type];
        if (!template) {
            throw new Error(`Invalid notification type: ${type}`);
        }

        // Validate required parameters
        const missingParams = template.requiredParams.filter(p => !params[p]);
        if (missingParams.length > 0) {
            throw new Error(`Missing required parameters for ${type}: ${missingParams.join(', ')}`);
        }

        // Render templates
        let title = template.titleTemplate;
        let body = template.bodyTemplate;

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
            deepLink: template.deepLink,
            android: {
                channelId: template.channelId
            }
        };
    }
};
