import sql from '../db.js';

async function diagnoseDiaryJson() {
    try {
        const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'diary_entries'
      AND column_name IN ('entry_date', 'class_section_id', 'updated_at', 'created_at')
    `;

        const entries = await sql`
      SELECT id, title, entry_date, class_section_id, created_at, updated_at
      FROM diary_entries 
      ORDER BY created_at DESC 
      LIMIT 3
    `;

        console.log(JSON.stringify({
            columns,
            entries,
            now: new Date().toISOString()
        }, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
    }
}

diagnoseDiaryJson();
