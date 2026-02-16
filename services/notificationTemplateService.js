/**
 * Notification Template Service
 * 
 * Centralized template rendering for all notification types.
 * channelId values MUST match the sound file name (without extension)
 * because notificationService.js sets channelId = soundFile.replace('.wav', '').
 */

const TEMPLATES = {
    // ===== ATTENDANCE =====
    'ATTENDANCE_ABSENT': {
        channelId: 'attendance_absent_alert',
        titleTemplate: 'Attendance Alert',
        bodyTemplate: 'Absent on {{date}}.',
        deepLink: '/student/attendance',
        requiredParams: ['date']
    },
    'ATTENDANCE_PRESENT': {
        channelId: 'voice_alert',
        titleTemplate: 'Attendance Update',
        bodyTemplate: '{{message}}',
        deepLink: '/student/attendance',
        requiredParams: ['message']
    },

    // ===== DIARY =====
    'DIARY_UPDATED': {
        channelId: 'voice_alert',
        titleTemplate: 'Diary Update',
        bodyTemplate: '{{message}}',
        deepLink: '/student/diary',
        requiredParams: ['message']
    },

    // ===== RESULTS =====
    'RESULT_RELEASED': {
        channelId: 'voice_alert',
        titleTemplate: 'Results Announced',
        bodyTemplate: '{{message}}',
        deepLink: '/student/results',
        requiredParams: ['message']
    },

    // ===== COMPLAINTS =====
    'COMPLAINT_CREATED': {
        channelId: 'emergency',
        titleTemplate: 'New Complaint',
        bodyTemplate: '{{message}}',
        deepLink: '/student/complaints',
        requiredParams: ['message']
    },
    'COMPLAINT_RESPONSE': {
        channelId: 'emergency',
        titleTemplate: 'Complaint Update',
        bodyTemplate: '{{message}}',
        deepLink: '/student/complaints',
        requiredParams: ['message']
    },

    // ===== LMS =====
    'LMS_CONTENT': {
        channelId: 'voice_alert',
        titleTemplate: 'New Study Material',
        bodyTemplate: '{{message}}',
        deepLink: '/student/lms',
        requiredParams: ['message']
    },

    // ===== TIMETABLE =====
    'TIMETABLE_UPDATED': {
        channelId: 'voice_alert',
        titleTemplate: 'Timetable Update',
        bodyTemplate: '{{message}}',
        deepLink: '/student/timetable',
        requiredParams: ['message']
    },

    // ===== NOTICES =====
    'NOTICE_ADMIN_STUDENT': {
        channelId: 'voice_alert',
        titleTemplate: 'Admin Notice',
        bodyTemplate: '{{message}}',
        deepLink: '/student/notices',
        requiredParams: ['message']
    },

    // ===== FEES =====
    'FEE_REMINDER': {
        channelId: 'fee_reminder',
        titleTemplate: 'Fee Reminder',
        bodyTemplate: '{{message}}',
        deepLink: '/student/fees',
        requiredParams: ['message']
    },
    'FEE_COLLECTED': {
        channelId: 'voice_alert',
        titleTemplate: 'Fee Received',
        bodyTemplate: '{{message}}',
        deepLink: '/student/fees',
        requiredParams: ['message']
    },

    // ===== LEAVES =====
    'LEAVE_SUBMITTED': {
        channelId: 'exam',
        titleTemplate: 'Leave Request',
        bodyTemplate: '{{message}}',
        deepLink: '/admin/leaves',
        requiredParams: ['message']
    },
    'LEAVE_APPROVED': {
        channelId: 'exam',
        titleTemplate: 'Leave Approved',
        bodyTemplate: '{{message}}',
        deepLink: '/staff/leaves',
        requiredParams: ['message']
    },
    'LEAVE_REJECTED': {
        channelId: 'exam',
        titleTemplate: 'Leave Rejected',
        bodyTemplate: '{{message}}',
        deepLink: '/staff/leaves',
        requiredParams: ['message']
    },

    // ===== EXPENSES =====
    'EXPENSE_CREATED': {
        channelId: 'exam',
        titleTemplate: 'Expense Submitted',
        bodyTemplate: '{{message}}',
        deepLink: '/admin/expenses',
        requiredParams: ['message']
    },
    'EXPENSE_APPROVED': {
        channelId: 'exam',
        titleTemplate: 'Expense Approved',
        bodyTemplate: '{{message}}',
        deepLink: '/accounts/expenses',
        requiredParams: ['message']
    },
    'EXPENSE_REJECTED': {
        channelId: 'exam',
        titleTemplate: 'Expense Rejected',
        bodyTemplate: '{{message}}',
        deepLink: '/accounts/expenses',
        requiredParams: ['message']
    },

    // ===== PAYROLL =====
    'PAYROLL_SUCCESS': {
        channelId: 'exam',
        titleTemplate: 'Salary Credited',
        bodyTemplate: '{{message}}',
        deepLink: '/staff/payroll',
        requiredParams: ['message']
    }
};

export const NotificationTemplateService = {
    /**
     * Renders a notification template.
     * @param {string} type - One of the template keys above
     * @param {object} params - Dynamic parameters
     * @returns {object} { title, body, deepLink, android: { channelId } }
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
