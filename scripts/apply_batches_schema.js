import sql from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applySchema() {

  try {
    const schemaPath = path.join(__dirname, 'notification_batches_schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    await sql.unsafe(schemaSql);

    process.exit(0);
  } catch (error) {

    process.exit(1);
  }
}

applySchema();