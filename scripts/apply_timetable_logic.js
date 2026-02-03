
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sql from '../db.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyTimetableLogic() {
    console.log('🚀 Applying Timetable & Promotion Logic...');

    try {
        const sqlPath = path.join(__dirname, '../timetable_logic.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        // Split by statement if needed, or run as a block?
        // postgres.js 'file' helper might be useful but 'sql' tag handles single string usually?
        // Actually postgres.js `sql` tag expects a template string or file.
        // But for multiple statements (CREATE FUNCTION, CREATE TRIGGER), it works if passed as a single string?
        // Sometimes safer to use `sql.file(path)`

        await sql.file(sqlPath);

        console.log('✅ Successfully applied SQL logic!');
    } catch (error) {
        console.error('❌ Error applying SQL:', error);
        process.exit(1);
    }

    process.exit(0);
}

applyTimetableLogic();
