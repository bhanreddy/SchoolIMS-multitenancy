
import sql from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const deployTrigger = async () => {
    try {
        console.log('Deploying fee propagation trigger...');

        const sqlPath = path.join(__dirname, 'update_fees_trigger.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        console.log('Reading SQL from:', sqlPath);

        // Execute the SQL file content
        await sql.unsafe(sqlContent);

        console.log('Successfully deployed trigger: trg_propagate_fee_updates');
        process.exit(0);
    } catch (error) {
        console.error('Error deploying trigger:', error);
        process.exit(1);
    }
};

deployTrigger();
