
import sql from '../db.js';
import { sendNotificationToUsers } from '../services/notificationService.js';
import { NotificationEventConfig } from '../services/notificationEventConfig.js';

const args = process.argv.slice(2);
const typeArgIndex = args.indexOf('--type');
const userIdArgIndex = args.indexOf('--userId');

const type = typeArgIndex !== -1 ? args[typeArgIndex + 1] : null;
const userId = userIdArgIndex !== -1 ? args[userIdArgIndex + 1] : null;

async function main() {


    if (!type || !userId) {
        console.log(`
Usage: node scripts/testNotificationTrigger.js --type <EVENT_TYPE> --userId <USER_ID>

Available Types:
${Object.keys(NotificationEventConfig).join('\n')}
        `);
        process.exit(1);
    }

    if (!NotificationEventConfig[type]) {
        console.error(`Error: Invalid event type '${type}'`);
        process.exit(1);
    }

    console.log(`[Test] Triggering ${type} for User ID: ${userId}...`);

    // Mock Params based on type
    let params = {};
    const dateStr = new Date().toISOString().split('T')[0];

    switch (type) {
        case 'ATTENDANCE_ABSENT':
            params = { date: dateStr };
            break;
        case 'ATTENDANCE_PRESENT':
            params = { message: `Your attendance is marked present for ${dateStr}` };
            break;
        case 'DIARY_UPDATED':
            params = { message: 'Test Homework: Complete Chapter 5' };
            break;
        case 'FEE_COLLECTED':
            params = { message: 'We received your payment of $500.' };
            break;
        case 'FEE_REMINDER':
            params = { message: 'Reminder: Term 2 Fees are due tomorrow.' };
            break;
        case 'LEAVE_SUBMITTED':
            params = { message: 'New leave application from John Doe.' };
            break;
        case 'LEAVE_APPROVED':
            params = { message: 'Your leave for 2 days has been approved.' };
            break;
        case 'LEAVE_REJECTED':
            params = { message: 'Your leave request was rejected.' };
            break;
        case 'EXPENSE_CREATED':
            params = { message: 'New expense claim: Office Supplies ($50)' };
            break;
        case 'EXPENSE_APPROVED':
            params = { message: 'Your expense claim #123 has been approved.' };
            break;
        case 'EXPENSE_REJECTED':
            params = { message: 'Your expense claim #123 has been rejected.' };
            break;
        default:
            params = { message: 'This is a test notification.' };
    }

    try {
        const result = await sendNotificationToUsers([userId], type, params);
        console.log('[Test] Result:', result);
    } catch (err) {
        console.error('[Test] Failed:', err);
    } finally {
        process.exit(0);
    }
}

main();
