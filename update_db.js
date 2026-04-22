import postgres from 'postgres';
import 'dotenv/config';

const sql = postgres(process.env.DATABASE_URL);

async function run() {
  try {
    await sql`ALTER TABLE exams ADD COLUMN IF NOT EXISTS name_te TEXT;`;
    console.log('Added name_te to exams');
    await sql`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS name_te TEXT;`;
    console.log('Added name_te to subjects');
    await sql`ALTER TABLE fee_types ADD COLUMN IF NOT EXISTS name_te TEXT;`;
    console.log('Added name_te to fee_types');
    await sql`ALTER TABLE fee_types ADD COLUMN IF NOT EXISTS description_te TEXT;`;
    console.log('Added description_te to fee_types');
    await sql`ALTER TABLE transport_routes ADD COLUMN IF NOT EXISTS name_te TEXT;`;
    console.log('Added name_te to transport_routes');
    await sql`ALTER TABLE transport_stops ADD COLUMN IF NOT EXISTS name_te TEXT;`;
    console.log('Added name_te to transport_stops');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
