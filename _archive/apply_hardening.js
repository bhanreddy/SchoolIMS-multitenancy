import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyHardening() {
    try {
        const sqlPath = path.join(__dirname, 'hardening.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        console.log('🛡️  Applying Hardening Triggers...');

        // Split by semicolons simple (not robust for complex plpgsql but sufficient if file is clean)
        // Actually, postgres.js requires valid statement.
        // hardening.sql usually contains function definitions which use $$ ... $$.
        // Let's use the same simple file read as before.
        await sql.file(sqlPath);

        console.log('✅ Hardening applied successfully.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed to apply hardening:', err);
        process.exit(1);
    }
}

applyHardening();
