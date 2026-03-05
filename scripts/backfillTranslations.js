/**
 * Backfill existing rows with Telugu translations.
 * Run ONCE after deployment: node scripts/backfillTranslations.js
 */
import sql from '../db.js';
import { translateFields } from '../services/geminiTranslator.js';

const TABLES = [
{ table: 'diary_entries', pk: 'id', fields: ['title', 'content'] },
{ table: 'notices', pk: 'id', fields: ['title', 'content'] },
{ table: 'complaints', pk: 'id', fields: ['title', 'description', 'resolution'] },
{ table: 'leave_applications', pk: 'id', fields: ['reason', 'review_remarks'] },
{ table: 'events', pk: 'id', fields: ['title', 'description'] },
{ table: 'marks', pk: 'id', fields: ['remarks'] }];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function backfill() {
  for (const { table, pk, fields } of TABLES) {

    // Build WHERE clause: any _te column IS NULL AND the English column IS NOT NULL
    const conditions = fields.map((f) => `(${f} IS NOT NULL AND ${f} != '' AND ${f}_te IS NULL)`).join(' OR ');
    const rows = await sql.unsafe(`SELECT ${pk}, ${fields.join(', ')} FROM ${table} WHERE ${conditions}`);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const toTranslate = {};
      for (const f of fields) {
        if (row[f] && row[f].trim() !== '') toTranslate[f] = row[f];
      }
      if (Object.keys(toTranslate).length === 0) continue;

      const te = await translateFields(toTranslate);
      if (Object.keys(te).length === 0) {

        continue;
      }

      // Build SET clause
      const setClauses = Object.entries(te).map(([k, v]) => `${k}_te = '${v.replace(/'/g, "''")}'`).join(', ');
      await sql.unsafe(`UPDATE ${table} SET ${setClauses} WHERE ${pk} = '${row[pk]}'`);

      await delay(200); // Rate limit: 5 req/sec
    }
  }

  process.exit(0);
}

backfill().catch((err) => {

  process.exit(1);
});