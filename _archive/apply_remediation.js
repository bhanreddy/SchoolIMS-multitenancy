import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log('Starting remediation migration...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'remediation.sql');
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Migration file not found at ${sqlPath}`);
    }
    
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split into statements or run as one block?
    // postgres.js can run a block if it's valid SQL.
    // The script is wrapped in BEGIN/COMMIT, so it should be run as a simple query or file.
    // postgres.js `sql.file` is best.
    
    console.log('Executing SQL...');
    await sql.file(sqlPath);
    
    console.log('✅ Remediation applied successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration Failed:', err);
    process.exit(1);
  }
}

runMigration();
