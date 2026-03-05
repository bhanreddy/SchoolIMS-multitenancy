import 'dotenv/config';
import sql from '../db.js';

async function debug() {
  try {

    const [version] = await sql`SELECT version()`;

    try {
      const [u1] = await sql`SELECT gen_random_uuid() as uuid`;

    } catch (e) {

    }

    try {
      await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`; // Try enabling
      const [u2] = await sql`SELECT uuid_generate_v4() as uuid`;

    } catch (e) {

    }

    process.exit(0);
  } catch (e) {

    process.exit(1);
  }
}

debug();