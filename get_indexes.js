import sql from './db.js';
import fs from 'fs';

async function checkIndexes() {
  try {
    const indexes = await sql`
      SELECT
        i.relname as index_name,
        a.attname as column_name
      FROM
        pg_class t,
        pg_class i,
        pg_index ix,
        pg_attribute a
      WHERE
        t.oid = ix.indrelid
        AND i.oid = ix.indexrelid
        AND a.attrelid = t.oid
        AND a.attnum = ANY(ix.indkey)
        AND t.relkind = 'r'
        AND t.relname = 'timetable_slots'
        AND i.relname = 'uq_timetable_slots_active'
      ORDER BY
        a.attnum;
    `;
    fs.writeFileSync('out.json', JSON.stringify(indexes, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
checkIndexes();
