import sql from '../db.js';

async function diagnoseDiary() {
  try {

    const [now] = await sql`SELECT now()`;

    const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'diary_entries'
      AND column_name IN ('entry_date', 'class_section_id', 'updated_at')
    `;
    console.table(columns);

    // Select columns explicitly to avoid any "missing column" ambiguity if schema has ghosts
    const entries = await sql`
      SELECT id, title, entry_date, class_section_id, updated_at
      FROM diary_entries 
      ORDER BY created_at DESC 
      LIMIT 3
    `;

    if (entries.length === 0) {

    } else {
      console.table(entries);

      const classId = entries[0].class_section_id;

      const students = await sql`
        SELECT count(*) as student_count
        FROM student_enrollments
        WHERE class_section_id = ${classId} AND status = 'active'
      `;

    }

    process.exit(0);
  } catch (err) {

    process.exit(1);
  }
}

diagnoseDiary();