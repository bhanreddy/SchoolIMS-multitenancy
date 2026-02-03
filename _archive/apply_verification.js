import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyVerification() {
    try {
        const sqlPath = path.join(__dirname, 'verification_queries.sql');

        console.log('🧪 Loading Verification Functions...');
        await sql.file(sqlPath);

        console.log('✅ Verification functions loaded.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed to load verification functions:', err);
        process.exit(1);
    }
}

applyVerification();
