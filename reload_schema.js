import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  try {
    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log('PostgREST schema cache reloaded!');
  } catch (err) {
    console.error('Error reloading schema cache:', err.message);
  }
  await client.end();
}

run().catch(console.error);
