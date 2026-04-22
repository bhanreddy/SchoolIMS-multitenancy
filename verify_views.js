import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  const views = await client.query(`
    SELECT table_name 
    FROM information_schema.views 
    WHERE table_schema = 'public'
  `);
  console.log('Views:', views.rows.map(r => r.table_name));

  // Test each view
  const viewNames = [
    'monthly_expense_summary_v2',
    'monthly_income_summary',
    'monthly_enquiry_summary',
    'monthly_closed_deals',
    'conversion_rate',
    'cost_per_lead',
    'pending_metrics_summary'
  ];
  for (const v of viewNames) {
    try {
      const res = await client.query(`SELECT * FROM public.${v} LIMIT 1`);
      console.log(`✓ ${v} — ${res.rows.length} rows`);
    } catch (err) {
      console.log(`✗ ${v} — ${err.message}`);
    }
  }
  await client.end();
}

run().catch(console.error);
