import fs from 'fs';
import sql from './db.js';

async function applyFix() {
    try {
        console.log("Reading fix_analytics_rpc.sql...");
        const query = fs.readFileSync('./fix_analytics_rpc.sql', 'utf8');

        console.log("Executing SQL fix...");
        await sql.unsafe(query);

        console.log("Fix applied successfully!");
        process.exit(0);
    } catch (err) {
        console.error("Error applying fix:", err);
        process.exit(1);
    }
}

applyFix();
