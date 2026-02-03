const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './testapp/.env' }); // Adjust path to .env

const connectionString = process.env.DATABASE_URL || "postgresql://postgres.tnybgqabbtefvudxkhos:SupaBase123456@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";

async function applySql() {
    const client = new Client({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log("Connected to database...");

        const sqlPath = path.join(__dirname, 'analytics_logic.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log("Applying analytics logic...");
        await client.query(sql);
        console.log("Successfully applied analytics logic!");

    } catch (err) {
        console.error("Error applying SQL:", err);
    } finally {
        await client.end();
    }
}

applySql();
