import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  const sql = fs.readFileSync('migrations/create_founder_tables_and_views.sql', 'utf8');
  try {
    await client.query(sql);
    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
  }
  await client.end();
}

run().catch(console.error);
