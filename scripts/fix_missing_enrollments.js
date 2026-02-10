
import sql from '../db.js';

async function fixMissingEnrollments() {
    try {
        console.log('--- FIXING MISSING ENROLLMENTS ---');

        // 1. Get current academic year
        const [ay] = await sql`
            SELECT id, code FROM academic_years 
            WHERE now() BETWEEN start_date AND end_date 
            LIMIT 1
        `;
        if (!ay) throw new Error('No active academic year found');
        console.log(`Academic Year: ${ay.code}`);

        // 2. Get Target Class Section (Class 1 - Section A)
        // We'll search by name to be safe
        const [cs] = await sql`
            SELECT cs.id, c.name as class_name, s.name as section_name
            FROM class_sections cs
            JOIN classes c ON cs.class_id = c.id
            JOIN sections s ON cs.section_id = s.id
            WHERE c.name = 'Class 1' AND s.name = 'Section A'
            AND cs.academic_year_id = ${ay.id}
        `;

        if (!cs) {
            // Fallback: Just grab the first available one if Class 1 - Section A doesn't exist
            console.warn('Class 1 - Section A not found for this year. Using first available.');
            const [fallback] = await sql`
                SELECT cs.id, c.name as class_name, s.name as section_name 
                FROM class_sections cs
                JOIN classes c ON cs.class_id = c.id
                JOIN sections s ON cs.section_id = s.id
                WHERE cs.academic_year_id = ${ay.id}
                LIMIT 1
             `;
            if (!fallback) throw new Error('No class sections found for current academic year');
            var targetCS = fallback;
        } else {
            var targetCS = cs;
        }
        console.log(`Target Class: ${targetCS.class_name} - ${targetCS.section_name}`);

        // 3. Find Active Students WITHOUT active enrollment
        const students = await sql`
            SELECT s.id, s.admission_no, p.display_name, s.admission_date
            FROM students s
            JOIN persons p ON s.person_id = p.id
            WHERE s.deleted_at IS NULL AND s.status_id = 1
            AND NOT EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = s.id 
                AND se.status = 'active'
                AND se.deleted_at IS NULL
            )
        `;

        console.log(`Found ${students.length} students missing enrollment.`);

        // 4. Enroll them
        for (const student of students) {
            // Get next roll number
            const [rollData] = await sql`
                SELECT COALESCE(MAX(roll_number), 0) + 1 as next_roll 
                FROM student_enrollments 
                WHERE class_section_id = ${targetCS.id} 
                AND academic_year_id = ${ay.id}
                AND deleted_at IS NULL
             `;
            const nextRoll = rollData ? rollData.next_roll : 1;

            await sql`
                INSERT INTO student_enrollments (student_id, class_section_id, academic_year_id, status, start_date, roll_number)
                VALUES (${student.id}, ${targetCS.id}, ${ay.id}, 'active', ${student.admission_date}, ${nextRoll})
             `;

            console.log(`  ✅ Enrolled ${student.display_name} (${student.admission_no}) -> Roll ${nextRoll}`);
        }

        console.log('--- FIX COMPLETE ---');

    } catch (error) {
        console.error('Error fixing enrollments:', error);
    } finally {
        process.exit();
    }
}

fixMissingEnrollments();
