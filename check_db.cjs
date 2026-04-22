const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  await client.connect();
  console.log("Connected to Supabase Postgres.");

  const pConst = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'permissions' AND c.contype = 'u';
  `);
  console.log("Permissions Unique Constraints:", pConst.rows);

  const rConst = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'roles' AND c.contype = 'u';
  `);
  console.log("Roles Unique Constraints:", rConst.rows);

  const rpConst = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'role_permissions' AND c.contype = 'p';
  `);
  console.log("Role_Permissions PK Constraints:", rpConst.rows);

  await client.end();
}

check().catch(console.error);
