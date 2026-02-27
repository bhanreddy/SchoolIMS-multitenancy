import sql from '../db.js';

async function checkSchema() {
    try {
        console.log('--- Checking Columns for diary_entries ---');
        const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'diary_entries'
    `;
        console.table(columns);
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkSchema();
