import sql from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Usage: node scripts/run_audit.js <path/to/script.sql>
const scriptRelativePath = process.argv[2];

if (!scriptRelativePath) {

  process.exit(1);
}

// Resolve path relative to where script is run, or absolute
const fullPath = path.resolve(process.cwd(), scriptRelativePath);

async function runScript() {
  try {

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }
    const sqlContent = fs.readFileSync(fullPath, 'utf8');

    // Execute the script
    // Execute the script within a transaction
    const results = await sql.begin(async (sql) => {
      // Remove BEGIN and COMMIT if present in the file to avoid conflicts
      // consistently, but better to just rely on sql.begin
      // However, postgres.js might still complain if it sees BEGIN in the string.
      // Let's rely on the user (us) removing BEGIN/COMMIT from the file.
      return await sql.unsafe(sqlContent);
    });

    // Write results to file
    const outputPath = path.resolve(process.cwd(), 'audit_results.json');

    let outputData = [];
    if (results && results.length > 0) {
      outputData = results;
    } else if (Array.isArray(results)) {
      outputData = results;
    }

    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));

    process.exit(0);
  } catch (err) {

    process.exit(1);
  }
}

runScript();