import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  
  const tables = res.rows.map(r => r.table_name);
  const out = { tables: tables };
  
  for (const table of tables) {
    const cols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [table]);
    out[table] = cols.rows;
  }
  
  const views = await client.query(`
    SELECT table_name 
    FROM information_schema.views 
    WHERE table_schema = 'public'
  `);
  out['views'] = views.rows.map(r => r.table_name);

  fs.writeFileSync('schema_out.json', JSON.stringify(out, null, 2));
  await client.end();
}

run().catch(console.error);
