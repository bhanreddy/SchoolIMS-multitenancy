import sql from '../db.js';

async function diagnoseDiary() {
    try {
        console.log('--- DB Connection Check ---');
        const [now] = await sql`SELECT now()`;
        console.log('DB Time:', now.now);

        console.log('\n--- Diary Schema Types ---');
        const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'diary_entries'
      AND column_name IN ('entry_date', 'class_section_id', 'updated_at')
    `;
        console.table(columns);

        console.log('\n--- Recent Diary Entries ---');
        // Select columns explicitly to avoid any "missing column" ambiguity if schema has ghosts
        const entries = await sql`
      SELECT id, title, entry_date, class_section_id, updated_at
      FROM diary_entries 
      ORDER BY created_at DESC 
      LIMIT 3
    `;

        if (entries.length === 0) {
            console.log('No diary entries found in the database.');
        } else {
            console.table(entries);
            console.log('Sample entry_date raw:', entries[0].entry_date);
            console.log('Sample updated_at raw:', entries[0].updated_at);

            const classId = entries[0].class_section_id;
            console.log(`\n--- Active Students in Class ${classId} ---`);
            const students = await sql`
        SELECT count(*) as student_count
        FROM student_enrollments
        WHERE class_section_id = ${classId} AND status = 'active'
      `;
            console.log('Student count:', students[0].student_count);
        }

        process.exit(0);
    } catch (err) {
        console.error('FATAL ERROR:', err);
        process.exit(1);
    }
}

diagnoseDiary();
