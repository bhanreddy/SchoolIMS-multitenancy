const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  await client.connect();

  try {
    await client.query(`BEGIN`);
    await client.query(`ALTER TABLE roles DISABLE TRIGGER ALL;`);
    await client.query(`DELETE FROM schools WHERE id = 4;`);
    await client.query(`ALTER TABLE roles ENABLE TRIGGER ALL;`);
    await client.query(`COMMIT`);
    console.log("Deleted successfully!");
  } catch (err) {
    await client.query(`ROLLBACK`);
    console.error("PG Error:", err);
  }

  await client.end();
}

check().catch(console.error);
