import sql from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runMigration = async () => {
    try {
        const sqlPath = path.join(__dirname, 'timetable_schema.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration...');

        // Split by semicolon to run statements? postgres.js might handle it or simple query
        // Usually postgres.js `sql.file(path)` exists or `sql(content)`
        // Let's try simple sql`...` but for multi-statement it might be tricky if not supported directly.
        // Better to use `sql.unsafe(content)` allows multiple statements?

        // Use unsafe for multi-statement script 
        await sql.unsafe(sqlContent);

        console.log('Migration successful!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        console.error('Error Details:', JSON.stringify(error, null, 2));
        process.exit(1);
    }
};

runMigration();
