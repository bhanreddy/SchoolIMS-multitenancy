import sql from '../db.js';

async function migrate() {

  try {
    await sql.begin(async (sql) => {
      // 1. Add new enum values if they don't exist
      // Postgres doesn't support IF NOT EXISTS for ADD VALUE in a simple way in older versions, 
      // but we can catch the error or just try it. 
      // Better approach for safe idempotency with enums:

      try {
        await sql`ALTER TYPE enrollment_status_enum ADD VALUE 'pending'`;

      } catch (e) {
        if (e.message.includes('already exists')) {

        } else {
          throw e;
        }
      }

      try {
        await sql`ALTER TYPE enrollment_status_enum ADD VALUE 'failed'`;

      } catch (e) {
        if (e.message.includes('already exists')) {

        } else {
          throw e;
        }
      }

      // 2. Make class_section_id nullable
      await sql`ALTER TABLE student_enrollments ALTER COLUMN class_section_id DROP NOT NULL`;

    });

    process.exit(0);
  } catch (error) {

    process.exit(1);
  }
}

migrate();