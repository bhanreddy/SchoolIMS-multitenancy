export const NotificationEventConfig = Object.freeze({

    // ===== ATTENDANCE =====
    ATTENDANCE_ABSENT: {
        channelId: 'attendance_absent_alert',
        sound: 'attendance_absent_alert.wav',
        titleTemplate: 'Attendance Alert',
        bodyTemplate: 'Absent on {{date}}.',
        titleTemplate_te: 'హాజరు హెచ్చరిక',
        bodyTemplate_te: '{{date}} న గైర్హాజరు.',
        deepLink: '/Screen/attendance',
        requiredParams: ['date']
    },
    ATTENDANCE_PRESENT: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Attendance Update',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'హాజరు నవీకరణ',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/attendance',
        requiredParams: ['message']
    },

    // ===== DIARY =====
    DIARY_UPDATED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Diary Update',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'డైరీ నవీకరణ',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/diary',
        requiredParams: ['message']
    },

    // ===== RESULTS =====
    RESULT_RELEASED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Results Announced',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'ఫలితాలు ప్రకటించబడ్డాయి',
        bodyTemplate_te: '{{message}}',
        deepLink: '/results',
        requiredParams: ['message']
    },

    // ===== COMPLAINTS =====
    COMPLAINT_CREATED: {   // Staff → Parent (student login)
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: 'New Complaint',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'కొత్త ఫిర్యాదు',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/complaints',
        requiredParams: ['message']
    },
    COMPLAINT_RESPONSE: {  // If admin replies later
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: 'Complaint Update',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'ఫిర్యాదు నవీకరణ',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/complaints',
        requiredParams: ['message']
    },

    // ===== LMS =====
    LMS_CONTENT: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'New Study Material',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'కొత్త అధ్యయన సామగ్రి',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/lms',
        requiredParams: ['message']
    },

    // ===== TIMETABLE =====
    TIMETABLE_UPDATED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Timetable Update',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'టైమ్‌టేబుల్ నవీకరణ',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/timetable',
        requiredParams: ['message']
    },

    // ===== NOTICES =====
    NOTICE_ADMIN_STUDENT: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Admin Notice',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'అడ్మిన్ నోటీసు',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/announcements',
        requiredParams: ['message']
    },

    // ===== FEES =====
    FEE_REMINDER: {   // Manual trigger only
        channelId: 'fee_reminder',
        sound: 'fee_reminder.wav',
        titleTemplate: 'Fee Reminder',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'ఫీజు రిమైండర్',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/fees',
        requiredParams: ['message']
    },
    FEE_COLLECTED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Fee Received',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'ఫీజు అందుకున్నారు',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/fees',
        requiredParams: ['message']
    },

    // ===== LEAVES =====
    LEAVE_SUBMITTED: {   // Notify admin only
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: 'Leave Request',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'సెలవు అభ్యర్థన',
        bodyTemplate_te: '{{message}}',
        deepLink: '/admin/leaves',
        requiredParams: ['message']
    },
    LEAVE_APPROVED: {    // Notify applicant only
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: 'Leave Approved',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'సెలవు ఆమోదించబడింది',
        bodyTemplate_te: '{{message}}',
        deepLink: '/staff/leaves',
        requiredParams: ['message']
    },
    LEAVE_REJECTED: {    // Notify applicant only
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: 'Leave Rejected',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'సెలవు తిరస్కరించబడింది',
        bodyTemplate_te: '{{message}}',
        deepLink: '/staff/leaves',
        requiredParams: ['message']
    },

    // ===== EXPENSES =====
    EXPENSE_CREATED: {
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: 'Expense Submitted',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'ఖర్చు సమర్పించబడింది',
        bodyTemplate_te: '{{message}}',
        deepLink: '/admin/expenses',
        requiredParams: ['message']
    },
    EXPENSE_APPROVED: {
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: 'Expense Approved',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'ఖర్చు ఆమోదించబడింది',
        bodyTemplate_te: '{{message}}',
        deepLink: '/accounts/expenses',
        requiredParams: ['message']
    },
    EXPENSE_REJECTED: {
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: 'Expense Rejected',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'ఖర్చు తిరస్కరించబడింది',
        bodyTemplate_te: '{{message}}',
        deepLink: '/accounts/expenses',
        requiredParams: ['message']
    },

    // ===== PAYROLL =====
    PAYROLL_SUCCESS: {
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: 'Salary Credited',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'జీతం జమ అయింది',
        bodyTemplate_te: '{{message}}',
        deepLink: '/staff/payslip',
        requiredParams: ['message']
    },

    // ===== ACCESS CONTROL =====
    ACCESS_RESPONSE: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Access Request Update',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'యాక్సెస్ అభ్యర్థన నవీకరణ',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/access',
        requiredParams: ['message']
    },

    // ===== GIRL SAFETY =====
    GIRL_SAFETY_RECEIVED: {
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: 'Safety Alert',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'భద్రతా హెచ్చరిక',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/girl-safety',
        requiredParams: ['message']
    },
    GIRL_SAFETY_UPDATE: {
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: 'Safety Update',
        bodyTemplate: '{{message}}',
        titleTemplate_te: 'భద్రతా నవీకరణ',
        bodyTemplate_te: '{{message}}',
        deepLink: '/Screen/girl-safety',
        requiredParams: ['message']
    }

});
