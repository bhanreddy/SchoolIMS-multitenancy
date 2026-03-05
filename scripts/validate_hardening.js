import sql from '../db.js';

async function validate() {

  let passed = true;

  try {
    // 1. Check notification_logs table
    const logsTable = await sql`
            SELECT table_name FROM information_schema.tables 
            WHERE table_name = 'notification_logs'
        `;
    if (logsTable.length) {} else
    {passed = false;}

    // 2. Check notification_config table
    const configTable = await sql`
            SELECT table_name FROM information_schema.tables 
            WHERE table_name = 'notification_config'
        `;
    if (configTable.length) {} else
    {passed = false;}

    // 3. Check Kill Switch Config
    const killSwitch = await sql`
            SELECT value FROM notification_config WHERE key = 'kill_switch'
        `;
    if (killSwitch.length && killSwitch[0].value.global === false) {} else
    {passed = false;}

    // 4. Check Indexes
    const indexes = await sql`
            SELECT indexname FROM pg_indexes WHERE tablename = 'notification_logs'
        `;
    const hasIndex = indexes.some((i) => i.indexname.includes('idx_notification_logs_user_type_date'));
    if (hasIndex) {} else
    {passed = false;}

    if (passed) {

      process.exit(0);
    } else {

      process.exit(1);
    }

  } catch (error) {

    process.exit(1);
  }
}

validate();