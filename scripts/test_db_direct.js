import sql from '../db.js';

async function test() {

  try {
    const result = await sql`SELECT 1 as connected`;

  } catch (err) {

  } finally {
    process.exit(0);
  }
}

test();