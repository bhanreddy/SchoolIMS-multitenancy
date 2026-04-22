const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function fix() {
  await client.connect();
  console.log("Connected to Supabase Postgres.");

  try {
    // Add UNIQUE constraints to permissions and roles
    console.log("Adding UNIQUE constraints...");
    await client.query(`
      ALTER TABLE permissions ADD CONSTRAINT permissions_school_id_code_key UNIQUE (school_id, code);
      ALTER TABLE roles ADD CONSTRAINT roles_school_id_code_key UNIQUE (school_id, code);
    `);
    console.log("Constraints added successfully!");
  } catch (err) {
    console.error("Error adding constraints:", err.message);
  }

  await client.end();
}

fix().catch(console.error);
