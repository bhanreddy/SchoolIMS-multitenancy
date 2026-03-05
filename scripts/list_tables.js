import 'dotenv/config';
import sql from '../db.js';

async function listTables() {
  try {
    const tables = await sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `;

    process.exit(0);
  } catch (error) {

    process.exit(1);
  }
}

listTables();