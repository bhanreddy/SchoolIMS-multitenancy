import sql from '../db.js';

async function checkSchema() {
  try {

    const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'diary_entries'
    `;
    console.table(columns);
    process.exit(0);
  } catch (err) {

    process.exit(1);
  }
}

checkSchema();