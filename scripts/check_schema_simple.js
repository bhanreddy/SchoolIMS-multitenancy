import sql from '../db.js';

async function checkSchemaSimple() {
  try {
    const columns = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'diary_entries'
    `;

    process.exit(0);
  } catch (err) {

    process.exit(1);
  }
}

checkSchemaSimple();