import sql from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyAuditFixes() {
    try {
        const migrationPath = path.join(__dirname, '../migrations/20260211_audit_fixes.sql');
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');

        console.log('Applying migration:', migrationPath);

        await sql.begin(async sql => {
            await sql.unsafe(migrationSql);
        });

        console.log('Migration applied successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Failed to apply migration:', err);
        process.exit(1);
    }
}

applyAuditFixes();
