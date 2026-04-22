import sql from './db.js';

async function alterExpenses() {
  try {
    const res = await sql`ALTER TABLE expenses ALTER COLUMN school_id DROP NOT NULL;`;
    console.log("Fixed NOT NULL constraint:", res);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
alterExpenses();
