import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sql from './db.js';

async function applyFinancialPolicySchema() {
    console.log('🔄 Applying Financial Policy Schema...');

    const schemaPath = path.join(process.cwd(), 'financial_policy_schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    try {
        await sql.unsafe(schemaSql);
        console.log('✅ Financial Policy Schema applied successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error applying schema:', error);
        process.exit(1);
    }
}

applyFinancialPolicySchema();
