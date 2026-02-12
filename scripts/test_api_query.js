import sql from '../db.js';

async function testQuery() {
    const class_section_id = '6f891673-8d9a-4e6f-8519-d5363df86406'; // Class 10 A
    const date = '2026-02-11';

    console.log('Testing query for class:', class_section_id);

    try {
        const students = await sql`
            SELECT 
                s.id as student_id, s.admission_no,
                p.display_name as student_name, p.photo_url,
                se.id as enrollment_id,
                da.id as attendance_id, da.status, da.marked_at
            FROM student_enrollments se
            JOIN students s ON se.student_id = s.id
            JOIN persons p ON s.person_id = p.id
            LEFT JOIN daily_attendance da ON da.student_enrollment_id = se.id 
                AND da.attendance_date = ${date}
                AND da.deleted_at IS NULL
            WHERE se.class_section_id = ${class_section_id}
                AND se.status = 'active'
                AND se.deleted_at IS NULL
                AND s.deleted_at IS NULL
            ORDER BY p.display_name
        `;

        console.log('Results count:', students.length);
        console.log('Results:', JSON.stringify(students, null, 2));

    } catch (err) {
        console.error('Query failed:', err);
    }
    process.exit(0);
}

testQuery();
