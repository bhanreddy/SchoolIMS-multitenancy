import sql from '../db.js';
import fs from 'fs';
import path from 'path';

const migrationPath = path.join(process.cwd(), 'migrations', '20260212_timetable_refactor.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

console.log('Running migration...');


try {
    // Remove BEGIN and COMMIT to avoid nesting errors with sql.begin
    const cleanSql = migrationSql
        .replace(/^BEGIN;/m, '')
        .replace(/^COMMIT;/m, '')
        .trim();

    await sql.begin(async (sql) => {
        await sql.unsafe(cleanSql);
    });
    console.log('Migration completed successfully.');
} catch (error) {
    console.error('Migration failed:', error);
}

process.exit();
