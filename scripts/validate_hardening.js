import sql from '../db.js';

async function validate() {
    console.log('🔍 Validating Notification Hardening...');
    let passed = true;

    try {
        // 1. Check notification_logs table
        const logsTable = await sql`
            SELECT table_name FROM information_schema.tables 
            WHERE table_name = 'notification_logs'
        `;
        if (logsTable.length) console.log('✅ notification_logs table exists');
        else { console.error('❌ notification_logs table MISSING'); passed = false; }

        // 2. Check notification_config table
        const configTable = await sql`
            SELECT table_name FROM information_schema.tables 
            WHERE table_name = 'notification_config'
        `;
        if (configTable.length) console.log('✅ notification_config table exists');
        else { console.error('❌ notification_config table MISSING'); passed = false; }

        // 3. Check Kill Switch Config
        const killSwitch = await sql`
            SELECT value FROM notification_config WHERE key = 'kill_switch'
        `;
        if (killSwitch.length && killSwitch[0].value.global === false) console.log('✅ Kill switch configured and inactive');
        else { console.error('❌ Kill switch configuration invalid'); passed = false; }

        // 4. Check Indexes
        const indexes = await sql`
            SELECT indexname FROM pg_indexes WHERE tablename = 'notification_logs'
        `;
        const hasIndex = indexes.some(i => i.indexname.includes('idx_notification_logs_user_type_date'));
        if (hasIndex) console.log('✅ Rate limiting index exists');
        else { console.error('❌ Rate limiting index MISSING'); passed = false; }

        if (passed) {
            console.log('\n✨ ALL CHECKS PASSED. System is hardened.');
            process.exit(0);
        } else {
            console.log('\n⚠️ SOME CHECKS FAILED.');
            process.exit(1);
        }

    } catch (error) {
        console.error('Validation failed with error:', error);
        process.exit(1);
    }
}

validate();
