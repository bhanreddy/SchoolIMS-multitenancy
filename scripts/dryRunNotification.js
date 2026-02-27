import { NotificationTemplateService } from '../services/notificationTemplateService.js';
import { NotificationEventConfig } from '../services/notificationEventConfig.js';

console.log('--- [DRY RUN] Testing NotificationTemplateService ---');

const testCases = [
    { type: 'FEE_REMINDER', params: { message: '₹1000 due.' } },
    { type: 'ATTENDANCE_ABSENT', params: { date: '2023-10-27' } },
    { type: 'TIMETABLE_UPDATED', params: { message: 'Period 1 changed.' } }
];

let errors = 0;

testCases.forEach(({ type, params }) => {
    try {
        console.log(`\nTesting ${type}...`);
        const result = NotificationTemplateService.render(type, params);

        const config = NotificationEventConfig[type];

        // precise template check is hard without regex matching, but we check if placeholders are gone
        if (result.body.includes('{{')) {
            console.error(`❌ [${type}] Unreplaced placeholders in body: ${result.body}`);
            errors++;
        } else {
            console.log(`✅ [${type}] Rendered Body: "${result.body}"`);
        }

        // Check Channel ID
        if (result.android.channelId !== config.channelId) {
            console.error(`❌ [${type}] Channel ID mismatch. Expected ${config.channelId}, got ${result.android.channelId}`);
            errors++;
        } else {
            console.log(`✅ [${type}] Channel ID: ${result.android.channelId}`);
        }

        // Check Sound (indirectly via channelId logic in service, but here just consistency)
        // config.sound should exist
        if (!config.sound) {
            console.error(`❌ [${type}] Missing sound in config.`);
            errors++;
        } else {
            console.log(`✅ [${type}] Config Sound: ${config.sound}`);
        }

    } catch (err) {
        console.error(`❌ [${type}] Render failed:`, err.message);
        errors++;
    }
});

if (errors === 0) {
    console.log('\n✅ All dry run tests passed.');
    process.exit(0);
} else {
    console.error(`\n❌ ${errors} tests failed.`);
    process.exit(1);
}
