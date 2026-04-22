export const NotificationEventConfig = Object.freeze({

    // ===== ATTENDANCE =====
    ATTENDANCE_ABSENT: {
        channelId: 'attendance_absent_alert',
        sound: 'attendance_absent_alert.wav',
        titleTemplate: '🚨 Attendance Alert',
        bodyTemplate: '❌ Absent on {{date}}.',
        titleTemplate_te: '🚨 హాజరు హెచ్చరిక',
        bodyTemplate_te: '❌ {{date}} న గైర్హాజరు.',
        deepLink: '/Screen/attendance',
        requiredParams: ['date']
    },
    ATTENDANCE_PRESENT: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '✅ Attendance Update',
        bodyTemplate: '🙋 {{message}}',
        titleTemplate_te: '✅ హాజరు నవీకరణ',
        bodyTemplate_te: '🙋 {{message_te}}',
        deepLink: '/Screen/attendance',
        requiredParams: ['message']
    },

    // ===== DIARY / HOMEWORK =====
    DIARY_UPDATED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '📓 Diary Update',
        bodyTemplate: '✏️ {{message}}',
        titleTemplate_te: '📓 డైరీ నవీకరణ',
        bodyTemplate_te: '✏️ {{message_te}}',
        deepLink: '/Screen/diary',
        requiredParams: ['message']
    },

    // ===== RESULTS / EXAM =====
    RESULT_RELEASED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '🏆 Results Announced',
        bodyTemplate: '📊 {{message}}',
        titleTemplate_te: '🏆 ఫలితాలు ప్రకటించబడ్డాయి',
        bodyTemplate_te: '📊 {{message_te}}',
        deepLink: '/results',
        requiredParams: ['message']
    },

    // ===== COMPLAINTS (General) =====
    COMPLAINT_CREATED: {   // Staff → Parent (student login)
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: '⚠️ New Complaint',
        bodyTemplate: '📣 {{message}}',
        titleTemplate_te: '⚠️ కొత్త ఫిర్యాదు',
        bodyTemplate_te: '📣 {{message_te}}',
        deepLink: '/Screen/complaints',
        requiredParams: ['message']
    },
    COMPLAINT_RESPONSE: {  // If admin replies later
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: '💬 Complaint Update',
        bodyTemplate: '🔁 {{message}}',
        titleTemplate_te: '💬 ఫిర్యాదు నవీకరణ',
        bodyTemplate_te: '🔁 {{message_te}}',
        deepLink: '/Screen/complaints',
        requiredParams: ['message']
    },

    // ===== LMS (Homework / Assignment) =====
    LMS_CONTENT: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '🎓 New Study Material',
        bodyTemplate: '📖 {{message}}',
        titleTemplate_te: '🎓 కొత్త అధ్యయన సామగ్రి',
        bodyTemplate_te: '📖 {{message_te}}',
        deepLink: '/Screen/lms',
        requiredParams: ['message']
    },

    // ===== TIMETABLE (Event / Circular) =====
    TIMETABLE_UPDATED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '📅 Timetable Update',
        bodyTemplate: '🕐 {{message}}',
        titleTemplate_te: '📅 టైమ్‌టేబుల్ నవీకరణ',
        bodyTemplate_te: '🕐 {{message_te}}',
        deepLink: '/Screen/timetable',
        requiredParams: ['message']
    },

    // ===== NOTICES (Announcement) =====
    NOTICE_ADMIN_STUDENT: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '📢 Admin Notice',
        bodyTemplate: '🗞️ {{message}}',
        titleTemplate_te: '📢 అడ్మిన్ నోటీసు',
        bodyTemplate_te: '🗞️ {{message_te}}',
        deepLink: '/Screen/announcements',
        requiredParams: ['message']
    },

    // ===== FEES =====
    FEE_REMINDER: {   // Manual trigger only
        channelId: 'fee_reminder',
        sound: 'fee_reminder.wav',
        titleTemplate: '⏰ Fee Reminder',
        bodyTemplate: '💳 {{message}}',
        titleTemplate_te: '⏰ ఫీజు రిమైండర్',
        bodyTemplate_te: '💳 {{message_te}}',
        deepLink: '/Screen/fees',
        requiredParams: ['message']
    },
    FEE_COLLECTED: {   // Payment confirmation — General/Other
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '✅ Fee Received',
        bodyTemplate: '💰 {{message}}',
        titleTemplate_te: '✅ ఫీజు అందుకున్నారు',
        bodyTemplate_te: '💰 {{message_te}}',
        deepLink: '/Screen/fees',
        requiredParams: ['message']
    },

    // ===== LEAVES (General) =====
    LEAVE_SUBMITTED: {   // Notify admin only
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: '📨 Leave Request',
        bodyTemplate: '🏖️ {{message}}',
        titleTemplate_te: '📨 సెలవు అభ్యర్థన',
        bodyTemplate_te: '🏖️ {{message_te}}',
        deepLink: '/admin/leaves',
        requiredParams: ['message']
    },
    LEAVE_APPROVED: {    // Notify applicant only
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: '✅ Leave Approved',
        bodyTemplate: '🎉 {{message}}',
        titleTemplate_te: '✅ సెలవు ఆమోదించబడింది',
        bodyTemplate_te: '🎉 {{message_te}}',
        deepLink: '/staff/leaves',
        requiredParams: ['message']
    },
    LEAVE_REJECTED: {    // Notify applicant only
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: '❌ Leave Rejected',
        bodyTemplate: '🚫 {{message}}',
        titleTemplate_te: '❌ సెలవు తిరస్కరించబడింది',
        bodyTemplate_te: '🚫 {{message_te}}',
        deepLink: '/staff/leaves',
        requiredParams: ['message']
    },

    // ===== EXPENSES (General) =====
    EXPENSE_CREATED: {
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: '📤 Expense Submitted',
        bodyTemplate: '🧾 {{message}}',
        titleTemplate_te: '📤 ఖర్చు సమర్పించబడింది',
        bodyTemplate_te: '🧾 {{message_te}}',
        deepLink: '/admin/expenses',
        requiredParams: ['message']
    },
    EXPENSE_APPROVED: {
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: '✅ Expense Approved',
        bodyTemplate: '💹 {{message}}',
        titleTemplate_te: '✅ ఖర్చు ఆమోదించబడింది',
        bodyTemplate_te: '💹 {{message_te}}',
        deepLink: '/accounts/expenses',
        requiredParams: ['message']
    },
    EXPENSE_REJECTED: {
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: '❌ Expense Rejected',
        bodyTemplate: '🚫 {{message}}',
        titleTemplate_te: '❌ ఖర్చు తిరస్కరించబడింది',
        bodyTemplate_te: '🚫 {{message_te}}',
        deepLink: '/accounts/expenses',
        requiredParams: ['message']
    },

    // ===== PAYROLL (General) =====
    PAYROLL_SUCCESS: {
        channelId: 'notification_default',
        sound: 'notification_default.wav',
        titleTemplate: '💰 Salary Credited',
        bodyTemplate: '🏦 {{message}}',
        titleTemplate_te: '💰 జీతం జమ అయింది',
        bodyTemplate_te: '🏦 {{message_te}}',
        deepLink: '/staff/payslip',
        requiredParams: ['message']
    },

    // ===== ACCESS CONTROL (General) =====
    ACCESS_RESPONSE: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '🔐 Access Request Update',
        bodyTemplate: '🔓 {{message}}',
        titleTemplate_te: '🔐 యాక్సెస్ అభ్యర్థన నవీకరణ',
        bodyTemplate_te: '🔓 {{message_te}}',
        deepLink: '/Screen/access',
        requiredParams: ['message']
    },

    // ===== GIRL SAFETY (General) =====
    GIRL_SAFETY_RECEIVED: {
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: '🆘 Safety Alert',
        bodyTemplate: '🚨 {{message}}',
        titleTemplate_te: '🆘 భద్రతా హెచ్చరిక',
        bodyTemplate_te: '🚨 {{message_te}}',
        deepLink: '/Screen/girl-safety',
        requiredParams: ['message']
    },
    GIRL_SAFETY_UPDATE: {
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: '🛡️ Safety Update',
        bodyTemplate: '👧 {{message}}',
        titleTemplate_te: '🛡️ భద్రతా నవీకరణ',
        bodyTemplate_te: '👧 {{message_te}}',
        deepLink: '/Screen/girl-safety',
        requiredParams: ['message']
    },

    // ===== TRANSPORT (General — bus checkpoints) =====
    BUS_STOP_REACHED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '🚌 Bus Update',
        titleTemplate_te: '🚌 బస్ అప్‌డేట్',
        bodyTemplate: '📍 Bus has reached {{stopName}}',
        bodyTemplate_te: '📍 బస్ {{stopName}} చేరుకుంది',
        deepLink: '/Screen/busTracker',
        requiredParams: ['stopName']
    },

    BUS_TRIP_COMPLETED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: '🏁 Trip Completed',
        titleTemplate_te: '🏁 ప్రయాణం పూర్తయింది',
        bodyTemplate: '🚌 Trip on route "{{routeName}}" is complete',
        bodyTemplate_te: '🚌 "{{routeName}}" రూట్‌పై ప్రయాణం పూర్తయింది',
        deepLink: '/Screen/busTracker',
        requiredParams: ['routeName']
    }

});