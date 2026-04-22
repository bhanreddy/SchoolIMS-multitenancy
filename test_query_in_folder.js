import 'dotenv/config';
import sql from './db.js';

async function testQuery() {
    const userId = '813e8c06-b799-4039-916c-f51d541a1e33';
    const schoolId = 1;

    try {
        const [staff] = await sql`
            SELECT s.id
            FROM staff s
            JOIN persons p ON s.person_id = p.id
            JOIN users u ON u.person_id = p.id
            WHERE u.id = ${userId}
              AND s.school_id = ${schoolId}
              AND s.deleted_at IS NULL
        `;

        if (!staff) return console.log('No staff found.');

        const assignments = await sql`
            SELECT DISTINCT ON (class_section_id, subject_id)
                class_section_id, class_id, class_name, section_id, section_name, subject_id, subject_name
            FROM (
                SELECT ts.class_section_id, c.id AS class_id, c.name AS class_name, sec.id AS section_id, sec.name AS section_name, s.id AS subject_id, s.name AS subject_name
                FROM timetable_slots ts
                JOIN class_sections csec ON ts.class_section_id = csec.id AND csec.school_id = ${schoolId}
                JOIN classes c ON csec.class_id = c.id AND c.school_id = ${schoolId}
                JOIN sections sec ON csec.section_id = sec.id
                JOIN subjects s ON ts.subject_id = s.id AND s.school_id = ${schoolId}
                WHERE ts.teacher_id = ${staff.id} AND ts.school_id = ${schoolId}

                UNION

                SELECT csub.class_section_id, c.id AS class_id, c.name AS class_name, sec.id AS section_id, sec.name AS section_name, s.id AS subject_id, s.name AS subject_name
                FROM class_subjects csub
                JOIN class_sections csec ON csub.class_section_id = csec.id AND csec.school_id = ${schoolId}
                JOIN classes c ON csec.class_id = c.id AND c.school_id = ${schoolId}
                JOIN sections sec ON csec.section_id = sec.id
                JOIN subjects s ON csub.subject_id = s.id AND s.school_id = ${schoolId}
                WHERE csub.teacher_id = ${staff.id} AND csub.school_id = ${schoolId}
            ) combined
        `;

        console.log('Assignments found:', assignments.length);
        console.log('Data:', JSON.stringify(assignments, null, 2));

    } catch (err) {
        console.error('Query error:', err);
    } finally {
        process.exit();
    }
}
testQuery();
