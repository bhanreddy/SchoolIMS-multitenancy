const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  await client.connect();

  const res = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname IN ('permissions', 'roles', 'role_permissions');
  `);
  console.log("All constraints:", res.rows);

  await client.end();
}

check().catch(console.error);
