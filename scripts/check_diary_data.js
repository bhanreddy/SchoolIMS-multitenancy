import sql from '../db.js';

async function checkDiaryData() {
    try {
        console.log('--- Checking Diary Entries (Last 5) ---');
        const recentEntries = await sql`
      SELECT id, title, entry_date, class_section_id, created_at, updated_at
      FROM diary_entries
      ORDER BY created_at DESC
      LIMIT 5
    `;
        console.table(recentEntries);

        if (recentEntries.length > 0) {
            const classId = recentEntries[0].class_section_id;
            console.log(`\n--- Checking Students in Class Section ${classId} ---`);

            const students = await sql`
        SELECT s.id, s.admission_no, p.display_name, u.email
        FROM student_enrollments se
        JOIN students s ON se.student_id = s.id
        JOIN persons p ON s.person_id = p.id
        JOIN users u ON p.id = u.person_id
        WHERE se.class_section_id = ${classId}
          AND se.status = 'active'
        LIMIT 5
      `;
            console.table(students);
        } else {
            console.log('No diary entries found.');
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkDiaryData();
