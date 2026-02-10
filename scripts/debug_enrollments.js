
import sql from '../db.js';

async function debugEnrollments() {
    try {
        console.log('--- DEBUGGING ENROLLMENTS ---');

        // 1. Get all active students
        const students = await sql`
            SELECT s.id, s.admission_no, p.display_name
            FROM students s
            JOIN persons p ON s.person_id = p.id
            WHERE s.deleted_at IS NULL AND s.status_id = 1
        `;
        console.log(`Total Active Students: ${students.length}`);

        // 2. Check enrollments for each student
        for (const student of students) {
            const enrollments = await sql`
                SELECT se.id, se.status, c.name as class_name, ay.code as year
                FROM student_enrollments se
                JOIN class_sections cs ON se.class_section_id = cs.id
                JOIN classes c ON cs.class_id = c.id
                JOIN academic_years ay ON se.academic_year_id = ay.id
                WHERE se.student_id = ${student.id}
            `;

            console.log(`\nStudent: ${student.display_name} (${student.admission_no})`);
            if (enrollments.length === 0) {
                console.log('  ❌ NO ENROLLMENTS FOUND');
            } else {
                enrollments.forEach(e => {
                    const icon = e.status === 'active' ? '✅' : '⚠️';
                    console.log(`  ${icon} [${e.year}] ${e.class_name} - ${e.status}`);
                });
            }
        }

    } catch (error) {
        console.error('Error debugging enrollments:', error);
    } finally {
        process.exit();
    }
}

debugEnrollments();
