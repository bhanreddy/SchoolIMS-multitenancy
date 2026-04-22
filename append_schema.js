import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.join(__dirname, 'schema.sql');
const mig1 = path.join(__dirname, 'migrations', 'create_founder_tables_and_views.sql');
const mig2 = path.join(__dirname, 'migrations', 'create_remaining_views.sql');

const content1 = fs.readFileSync(mig1, 'utf8');
const content2 = fs.readFileSync(mig2, 'utf8');

fs.appendFileSync(schemaPath, '\n\n' + content1 + '\n\n' + content2 + '\n');
console.log('Successfully appended the new schema definitions to schema.sql');
