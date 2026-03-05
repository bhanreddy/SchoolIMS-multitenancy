
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applySchema() {
  try {
    const schemaPath = path.join(__dirname, 'salary_schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Execute the SQL
    await sql.unsafe(schemaSql);

    process.exit(0);
  } catch (error) {

    process.exit(1);
  }
}

applySchema();