import sql from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyHardening() {
    console.log('🚀 Applying Notification Hardening Schema...');

    try {
        const schemaPath = path.join(__dirname, 'notification_hardening.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        // Split by semicolons to execute multiple statements if needed, 
        // but `postgres` library often handles multi-statement query if simplestring.
        // However, it is safer to use the `file` helper if available or simple query.
        // We'll just run it as a simple query since it is DDL.

        await sql.unsafe(schemaSql);

        console.log('✅ Hardening schema applied successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

applyHardening();
