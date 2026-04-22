const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  await client.connect();

  const missingSerials = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND column_name = 'id' 
      AND data_type IN ('integer', 'smallint', 'bigint')
      AND column_default IS NULL
      AND table_name NOT IN ('schools'); -- maybe schools id is external or serial? 
  `);
  console.log("Missing serials:", missingSerials.rows);

  await client.end();
}

check().catch(console.error);
