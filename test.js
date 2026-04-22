import postgres from 'postgres';
import 'dotenv/config';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres');

async function test() {
  try {
    await sql`INSERT INTO expenses (title, description, amount, category, status, created_by_founder_id) VALUES ('test', 'test', 10, 'MISC', 'PENDING', null)`;
    console.log('Success!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}
test();
