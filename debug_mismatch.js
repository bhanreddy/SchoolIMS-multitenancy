
import sql from './db.js';
import fs from 'fs';

async function debugDataMismatch() {
    try {
        console.log('--- Data Mismatch Analysis ---');

        const slots = await sql`SELECT DISTINCT class_section_id, academic_year_id FROM timetable_slots`;

        const enrollments = await sql`
        SELECT DISTINCT class_section_id, academic_year_id
        FROM student_enrollments
        WHERE status = 'active'
    `;

        console.log(`Timetable has slots for ${slots.length} class sections.`);
        console.log(`There are active enrollments in ${enrollments.length} class sections.`);

        let matchCount = 0;
        for (const enr of enrollments) {
            const match = slots.find(s =>
                s.class_section_id === enr.class_section_id &&
                s.academic_year_id === enr.academic_year_id
            );

            if (match) {
                matchCount++;
            } else {
                console.log(`MISMATCH: Students exist in Section ${enr.class_section_id} (Year ${enr.academic_year_id}) but NO timetable slots.`);
            }
        }

        if (matchCount === 0) {
            console.log('CRITICAL: No intersection between enrolled students and timetable slots.');
            if (enrollments.length > 0) {
                const targetId = enrollments[0].class_section_id;
                console.log(`SUGGESTION: Seed timetable for Class Section ${targetId}`);
                fs.writeFileSync('target_class.txt', targetId);
                console.log('Target ID written to target_class.txt');
            }
        } else {
            console.log(`SUCCESS: ${matchCount} class sections have both students and timetable.`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit();
    }
}

debugDataMismatch();
