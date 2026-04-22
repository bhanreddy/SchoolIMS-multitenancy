import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function getDefinitions() {
  await client.connect();
  const tables = ['money_science_modules', 'life_values_modules', 'science_projects'];
  const result = {};

  for (const table of tables) {
    const cols = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position;
    `, [table]);
    
    const policies = await client.query(`
      SELECT polname, polcmd, polroles, polqual, polwithcheck
      FROM pg_policy
      WHERE polrelid = $1::regclass;
    `, [table]);
    
    const rls = await client.query(`SELECT relrowsecurity FROM pg_class WHERE relname = $1;`, [table]);

    result[table] = {
      columns: cols.rows,
      policies: policies.rows,
      rls: rls.rows[0]?.relrowsecurity
    };
  }
  fs.writeFileSync('schema_dump.json', JSON.stringify(result, null, 2));
  await client.end();
}

getDefinitions().catch(console.error);
