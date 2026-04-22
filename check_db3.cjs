const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  await client.connect();

  const sdDef = await client.query(`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_name = 'staff_designations' AND column_name = 'id';
  `);
  console.log("staff_designations.id default:", sdDef.rows);

  const dpDef = await client.query(`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_name = 'staff_departments' AND column_name = 'id';
  `);
  console.log("staff_departments.id default:", dpDef.rows);

  await client.end();
}

check().catch(console.error);
