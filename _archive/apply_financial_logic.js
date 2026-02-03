import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sql from './db.js';

async function applyFinancialPolicyLogic() {
    console.log('🔄 Applying Financial Policy Logic...');

    const schemaPath = path.join(process.cwd(), 'financial_policy_logic.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    try {
        await sql.unsafe(schemaSql);
        console.log('✅ Financial Policy Logic applied successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error applying logic:', error);
        process.exit(1);
    }
}

applyFinancialPolicyLogic();
