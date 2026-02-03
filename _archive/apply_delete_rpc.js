import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sql from './db.js';

async function applyDeleteRPC() {
    console.log('🔄 Applying Delete RPC...');

    const schemaPath = path.join(process.cwd(), 'delete_rpc.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    try {
        await sql.unsafe(schemaSql);
        console.log('✅ Delete RPC applied successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error applying RPC:', error);
        process.exit(1);
    }
}

applyDeleteRPC();
