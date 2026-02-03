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
        console.log("Reading nexsyrus_tabs.sql...");
        const sqlPath = path.join(__dirname, 'nexsyrus_tabs.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log("Applying schema changes...");
        await pool.query(sql);
        console.log("✅ Successfully applied nexsyrus_tabs.sql");
    } catch (e) {
        console.error("❌ Error applying schema:", e);
    } finally {
        await pool.end();
    }
}

apply();
