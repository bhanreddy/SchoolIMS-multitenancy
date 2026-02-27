import sql from '../db.js';

async function checkSchemaSimple() {
    try {
        const columns = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'diary_entries'
    `;
        console.log('Columns:', columns.map(c => c.column_name).join(', '));
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkSchemaSimple();
