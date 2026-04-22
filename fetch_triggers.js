import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function checkTriggers() {
  await client.connect();
  const tables = ['money_science_modules', 'life_values_modules', 'science_projects'];
  for (const table of tables) {
    const res = await client.query(`
      SELECT trigger_name, action_statement
      FROM information_schema.triggers
      WHERE event_object_table = $1;
    `, [table]);
    console.log(`Triggers for ${table}:`, res.rows);
  }
  await client.end();
}
checkTriggers().catch(console.error);
