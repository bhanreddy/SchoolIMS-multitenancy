import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function apply() {
    try {
        console.log("Reading update_nexsyrus_content.sql...");
        const sqlPath = path.join(__dirname, 'update_nexsyrus_content.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log("Applying schema updates...");
        await pool.query(sql);
        console.log("✅ Successfully applied update_nexsyrus_content.sql");
    } catch (e) {
        console.error("❌ Error applying schema:", e);
    } finally {
        await pool.end();
    }
}

apply();
