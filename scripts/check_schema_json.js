import sql from '../db.js';

async function checkSchemaJson() {
    try {
        const columns = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'diary_entries'
    `;
        console.log(JSON.stringify(columns.map(c => c.column_name), null, 2));
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkSchemaJson();
