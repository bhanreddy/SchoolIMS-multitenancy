import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigration() {
  try {
    const migrationPath = path.join(__dirname, 'migrations', '20260418_transport_service_phase1.sql');
    let sqlContent = fs.readFileSync(migrationPath, 'utf8');
    
    // Remove BEGIN; and COMMIT; 
    sqlContent = sqlContent.replace(/BEGIN;/gi, '').replace(/COMMIT;/gi, '');

    await sql.unsafe(sqlContent);
    console.log('Migration executed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}
runMigration();
