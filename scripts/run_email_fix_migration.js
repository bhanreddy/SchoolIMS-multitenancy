/**
 * Apply migrations/20260529_fix_email_school_scoping.sql
 * Usage: node scripts/run_email_fix_migration.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import config from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = postgres(config.databaseUrl);

async function audit() {
  const corrupted = await sql`
    SELECT COUNT(*)::int AS count, school_id
    FROM person_contacts
    WHERE contact_type = 'email'
      AND deleted_at IS NULL
      AND contact_value LIKE '%+school-%'
    GROUP BY school_id
    ORDER BY school_id
  `;

  if (corrupted.length === 0) {
    console.log('No corrupted +school- emails in person_contacts.');
  } else {
    console.log('Corrupted emails by school (before fix):');
    for (const row of corrupted) {
      console.log(`  school_id=${row.school_id}: ${row.count}`);
    }
  }

  const duplicates = await sql`
    SELECT lower(contact_value) AS email, school_id, COUNT(*)::int AS cnt
    FROM person_contacts
    WHERE contact_type = 'email'
      AND is_primary = true
      AND deleted_at IS NULL
    GROUP BY lower(contact_value), school_id
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length > 0) {
    console.error('Duplicate primary emails within schools (resolve before migration):');
    console.table(duplicates);
    throw new Error('Duplicate (email, school_id) pairs found');
  }
}

async function migrate() {
  try {
    await audit();

    const migrationPath = path.join(__dirname, '..', 'migrations', '20260529_fix_email_school_scoping.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    await sql.unsafe(migrationSql);

    console.log('Email fix migration applied successfully.');
  } finally {
    await sql.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
