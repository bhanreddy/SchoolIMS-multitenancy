export const NotificationEventConfig = Object.freeze({

    // ===== ATTENDANCE =====
    ATTENDANCE_ABSENT: {
        sound: 'attendance_absent_alert.wav'
    },
    ATTENDANCE_PRESENT: {
        sound: 'voice_alert.wav'
    },

    // ===== DIARY =====
    DIARY_UPDATED: {
        sound: 'voice_alert.wav'
    },

    // ===== RESULTS =====
    RESULT_RELEASED: {
        sound: 'voice_alert.wav'
    },

    // ===== COMPLAINTS =====
    COMPLAINT_CREATED: {   // Staff → Parent (student login)
        sound: 'emergency.wav'
    },

    COMPLAINT_RESPONSE: {  // If admin replies later
        sound: 'emergency.wav'
    },

    // ===== LMS =====
    LMS_CONTENT: {
        sound: 'voice_alert.wav'
    },

    // ===== TIMETABLE =====
    TIMETABLE_UPDATED: {
        sound: 'voice_alert.wav'
    },

    // ===== NOTICES =====
    NOTICE_ADMIN_STUDENT: {
        sound: 'voice_alert.wav'
    },

    // ===== FEES =====
    FEE_REMINDER: {   // Manual trigger only
        sound: 'fee_reminder.wav'
    },

    FEE_COLLECTED: {
        sound: 'voice_alert.wav'
    },

    // ===== LEAVES =====
    LEAVE_SUBMITTED: {   // Notify admin only
        sound: 'exam.wav'
    },

    LEAVE_APPROVED: {    // Notify applicant only
        sound: 'exam.wav'
    },

    LEAVE_REJECTED: {    // Notify applicant only
        sound: 'exam.wav'
    },

    // ===== EXPENSES =====
    EXPENSE_CREATED: {
        sound: 'exam.wav'
    },
    EXPENSE_APPROVED: {
        sound: 'exam.wav'
    },
    EXPENSE_REJECTED: {
        sound: 'exam.wav'
    },

    // ===== PAYROLL =====
    PAYROLL_SUCCESS: {
        sound: 'exam.wav'
    }

});
