import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to run query.js');
}

const client = new Client({
  connectionString,
});

async function main() {
  await client.connect();
  const res = await client.query('SELECT * FROM staff_designations;');
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
main();
