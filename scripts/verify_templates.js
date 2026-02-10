import { NotificationTemplateService, NotificationTypes } from '../services/notificationTemplateService.js';

console.log('Running Notification Template Verification...');

const tests = [
    {
        name: 'General Template',
        type: NotificationTypes.GENERAL,
        params: { message: 'Hello System' },
        expectedTitle: 'Notification',
        expectedBody: 'Hello System',
        expectedChannel: 'default_voice'
    },
    {
        name: 'Emergency Template',
        type: NotificationTypes.EMERGENCY,
        params: { message: 'Fire Drill' },
        expectedTitle: 'EMERGENCY ALERT',
        expectedBody: 'Fire Drill',
        expectedChannel: 'emergency'
    },
    {
        name: 'Fees Template',
        type: NotificationTypes.FEES,
        params: { amount: '500', month: 'October' },
        expectedTitle: 'Fee Reminder',
        expectedBody: '₹500 due for October.',
        expectedChannel: 'fees'
    },
    {
        name: 'Exam Template',
        type: NotificationTypes.EXAM,
        params: { examName: 'Maths Final', date: '2023-10-10' },
        expectedTitle: 'Exam: Maths Final',
        expectedBody: 'Scheduled on 2023-10-10.',
        expectedChannel: 'exam'
    },
    {
        name: 'Attendance Absent Template',
        type: NotificationTypes.ATTENDANCE_ABSENT,
        params: { date: '2023-10-01' },
        expectedTitle: 'Attendance Alert',
        expectedBody: 'Absent on 2023-10-01.',
        expectedChannel: 'attendance'
    }
];

let errors = 0;

tests.forEach(test => {
    try {
        const result = NotificationTemplateService.render(test.type, test.params);
        if (result.title !== test.expectedTitle) throw new Error(`Title mismatch. Got: ${result.title}, Expected: ${test.expectedTitle}`);
        if (result.body !== test.expectedBody) throw new Error(`Body mismatch. Got: ${result.body}, Expected: ${test.expectedBody}`);
        if (result.android.channelId !== test.expectedChannel) throw new Error(`Channel mismatch. Got: ${result.android.channelId}, Expected: ${test.expectedChannel}`);
        console.log(`[PASS] ${test.name}`);
    } catch (e) {
        console.error(`[FAIL] ${test.name}:`, e.message);
        errors++;
    }
});

// Test Missing Params
try {
    console.log('Testing Missing Params...');
    NotificationTemplateService.render(NotificationTypes.FEES, { amount: '500' });
    console.error('[FAIL] Missing Params Check: Should have thrown error');
    errors++;
} catch (e) {
    if (e.message.includes('Missing required parameters')) {
        console.log('[PASS] Missing Params Check');
    } else {
        console.error('[FAIL] Missing Params Check: Wrong error message', e.message);
        errors++;
    }
}

// Test Invalid Type
try {
    console.log('Testing Invalid Type...');
    NotificationTemplateService.render('INVALID_TYPE', {});
    console.error('[FAIL] Invalid Type Check: Should have thrown error');
    errors++;
} catch (e) {
    if (e.message.includes('Invalid notification type')) {
        console.log('[PASS] Invalid Type Check');
    } else {
        console.error('[FAIL] Invalid Type Check: Wrong error message', e.message);
        errors++;
    }
}

if (errors === 0) {
    console.log('\nAll tests passed successfully.');
    process.exit(0);
} else {
    console.error(`\n${errors} tests failed.`);
    process.exit(1);
}
