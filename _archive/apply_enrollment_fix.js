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
        console.log("Reading fix_enrollment_rpc.sql...");
        const sqlPath = path.join(__dirname, 'fix_enrollment_rpc.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log("Applying RPC fix...");
        await pool.query(sql);
        console.log("✅ Successfully applied fix_enrollment_rpc.sql");
    } catch (e) {
        console.error("❌ Error applying fix:", e);
    } finally {
        await pool.end();
    }
}

apply();
