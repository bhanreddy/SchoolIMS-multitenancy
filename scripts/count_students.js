import sql from '../db.js';

async function check() {
    const csId = 'b4d2e7fe-1169-410d-8289-d841c9c5aeaa';
    try {
        const students = await sql`
            SELECT count(*) 
            FROM student_enrollments 
            WHERE class_section_id = ${csId} 
              AND status = 'active' 
              AND deleted_at IS NULL
        `;
        console.log('Students in Section:', students[0].count);

        const details = await sql`
            SELECT s.id, p.display_name 
            FROM students s 
            JOIN persons p ON s.person_id = p.id 
            JOIN student_enrollments se ON s.id = se.student_id 
            WHERE se.class_section_id = ${csId} 
              AND se.status = 'active'
              AND se.deleted_at IS NULL
        `;
        console.log('Student details:', details);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit(0);
    }
}

check();
