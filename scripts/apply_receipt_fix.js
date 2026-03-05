
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyFix() {
  try {
    const sqlPath = path.join(__dirname, 'fix_missing_receipts.sql');
    const migrationSql = fs.readFileSync(sqlPath, 'utf8');

    // Execute the SQL
    // Using unsafe because it contains multiple statements and DO blocks
    await sql.unsafe(migrationSql);

    process.exit(0);
  } catch (error) {

    process.exit(1);
  }
}

applyFix();