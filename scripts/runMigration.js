
import sql from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationFile = path.join(__dirname, '../migrations/20240217_notification_tables.sql');

async function runMigration() {
    try {
        console.log('Reading migration file...');
        const sqlContent = fs.readFileSync(migrationFile, 'utf8');

        console.log('Applying migration...');
        // Split by semicolon? No, `postgres.js` `sql.file` or just passing the string should work if simple.
        // `postgres.js` typically takes a template literal.
        // Let's try passing the raw string. `postgres.js` might not support multiple statements in one call depending on config.
        // Best approach is strictly simple `sql(string)` or `sql.file(path)`.

        await sql.file(migrationFile);

        console.log('✅ Migration applied successfully.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
