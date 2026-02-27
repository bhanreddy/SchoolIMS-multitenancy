export const NotificationEventConfig = Object.freeze({

    // ===== ATTENDANCE =====
    ATTENDANCE_ABSENT: {
        channelId: 'attendance_absent_alert',
        sound: 'attendance_absent_alert.wav',
        titleTemplate: 'Attendance Alert',
        bodyTemplate: 'Absent on {{date}}.',
        deepLink: '/student/attendance',
        requiredParams: ['date']
    },
    ATTENDANCE_PRESENT: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Attendance Update',
        bodyTemplate: '{{message}}',
        deepLink: '/student/attendance',
        requiredParams: ['message']
    },

    // ===== DIARY =====
    DIARY_UPDATED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Diary Update',
        bodyTemplate: '{{message}}',
        deepLink: '/student/diary',
        requiredParams: ['message']
    },

    // ===== RESULTS =====
    RESULT_RELEASED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Results Announced',
        bodyTemplate: '{{message}}',
        deepLink: '/student/results',
        requiredParams: ['message']
    },

    // ===== COMPLAINTS =====
    COMPLAINT_CREATED: {   // Staff → Parent (student login)
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: 'New Complaint',
        bodyTemplate: '{{message}}',
        deepLink: '/student/complaints',
        requiredParams: ['message']
    },
    COMPLAINT_RESPONSE: {  // If admin replies later
        channelId: 'emergency',
        sound: 'emergency.wav',
        titleTemplate: 'Complaint Update',
        bodyTemplate: '{{message}}',
        deepLink: '/student/complaints',
        requiredParams: ['message']
    },

    // ===== LMS =====
    LMS_CONTENT: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'New Study Material',
        bodyTemplate: '{{message}}',
        deepLink: '/student/lms',
        requiredParams: ['message']
    },

    // ===== TIMETABLE =====
    TIMETABLE_UPDATED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Timetable Update',
        bodyTemplate: '{{message}}',
        deepLink: '/student/timetable',
        requiredParams: ['message']
    },

    // ===== NOTICES =====
    NOTICE_ADMIN_STUDENT: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Admin Notice',
        bodyTemplate: '{{message}}',
        deepLink: '/student/notices',
        requiredParams: ['message']
    },

    // ===== FEES =====
    FEE_REMINDER: {   // Manual trigger only
        channelId: 'fee_reminder',
        sound: 'fee_reminder.wav',
        titleTemplate: 'Fee Reminder',
        bodyTemplate: '{{message}}',
        deepLink: '/student/fees',
        requiredParams: ['message']
    },
    FEE_COLLECTED: {
        channelId: 'voice_alert',
        sound: 'voice_alert.wav',
        titleTemplate: 'Fee Received',
        bodyTemplate: '{{message}}',
        deepLink: '/student/fees',
        requiredParams: ['message']
    },

    // ===== LEAVES =====
    LEAVE_SUBMITTED: {   // Notify admin only
        channelId: 'exam',
        sound: 'exam.wav',
        titleTemplate: 'Leave Request',
        bodyTemplate: '{{message}}',
        deepLink: '/admin/leaves',
        requiredParams: ['message']
    },
    LEAVE_APPROVED: {    // Notify applicant only
        channelId: 'exam',
        sound: 'exam.wav',
        titleTemplate: 'Leave Approved',
        bodyTemplate: '{{message}}',
        deepLink: '/staff/leaves',
        requiredParams: ['message']
    },
    LEAVE_REJECTED: {    // Notify applicant only
        channelId: 'exam',
        sound: 'exam.wav',
        titleTemplate: 'Leave Rejected',
        bodyTemplate: '{{message}}',
        deepLink: '/staff/leaves',
        requiredParams: ['message']
    },

    // ===== EXPENSES =====
    EXPENSE_CREATED: {
        channelId: 'exam',
        sound: 'exam.wav',
        titleTemplate: 'Expense Submitted',
        bodyTemplate: '{{message}}',
        deepLink: '/admin/expenses',
        requiredParams: ['message']
    },
    EXPENSE_APPROVED: {
        channelId: 'exam',
        sound: 'exam.wav',
        titleTemplate: 'Expense Approved',
        bodyTemplate: '{{message}}',
        deepLink: '/accounts/expenses',
        requiredParams: ['message']
    },
    EXPENSE_REJECTED: {
        channelId: 'exam',
        sound: 'exam.wav',
        titleTemplate: 'Expense Rejected',
        bodyTemplate: '{{message}}',
        deepLink: '/accounts/expenses',
        requiredParams: ['message']
    },

    // ===== PAYROLL =====
    PAYROLL_SUCCESS: {
        channelId: 'exam',
        sound: 'exam.wav',
        titleTemplate: 'Salary Credited',
        bodyTemplate: '{{message}}',
        deepLink: '/staff/payroll',
        requiredParams: ['message']
    }

});
