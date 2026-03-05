import sql from '../db.js';

async function verifyTimetableLogic() {

  try {
    // 1. Setup Test Data
    // Get Active Academic Year
    const [year] = await sql`SELECT id FROM academic_years WHERE start_date <= current_date AND end_date >= current_date LIMIT 1`;
    if (!year) throw new Error('No active academic year found');
    const yearId = year.id;

    // Get a Subject
    const [subject] = await sql`SELECT id FROM subjects LIMIT 1`;
    if (!subject) throw new Error('No subjects found');

    // Get a Teacher who is FREE on Monday Period 1
    const [teacher1] = await sql`
            SELECT id FROM staff 
            WHERE id NOT IN (
                SELECT teacher_id FROM timetable_slots 
                WHERE day_of_week = 'monday' AND period_number = 1 AND academic_year_id = ${yearId} AND teacher_id IS NOT NULL
            )
            LIMIT 1
        `;
    if (!teacher1) throw new Error('No free staff found for Monday Period 1');

    // Get another Teacher who is also FREE (and different)
    const [teacher2] = await sql`
            SELECT id FROM staff 
            WHERE id != ${teacher1.id}
              AND id NOT IN (
                SELECT teacher_id FROM timetable_slots 
                WHERE day_of_week = 'monday' AND period_number = 1 AND academic_year_id = ${yearId} AND teacher_id IS NOT NULL
            )
            LIMIT 1
        `;
    // If only 1 free teacher, we can't fully test swap, but let's see.
    const t2Id = teacher2 ? teacher2.id : teacher1.id;

    // Create Test Class & Section
    const testClassName = 'TestClass_' + Date.now();
    const testSectionName = 'TestSec_' + Date.now();

    const [cls] = await sql`INSERT INTO classes (name) VALUES (${testClassName}) RETURNING id`;
    const [sec] = await sql`INSERT INTO sections (name) VALUES (${testSectionName}) RETURNING id`;

    const [classSection] = await sql`
            INSERT INTO class_sections (class_id, section_id, academic_year_id) 
            VALUES (${cls.id}, ${sec.id}, ${yearId}) 
            RETURNING id, class_teacher_id
        `;

    // Debug: Check for conflicts manually
    const conflicts = await sql`
            SELECT id, day_of_week, period_number, academic_year_id 
            FROM timetable_slots 
            WHERE teacher_id = ${teacher1.id}
        `;

    // Force Cleanup of specific conflicts for Monday Period 1
    await sql`
            DELETE FROM timetable_slots 
            WHERE teacher_id = ${teacher1.id} 
              AND day_of_week = 'monday' 
              AND period_number = 1
              AND academic_year_id = ${yearId}
        `;

    // 2. Test Trigger: Insert Monday Period 1

    await sql`
            INSERT INTO timetable_slots (
                academic_year_id, class_section_id, day_of_week, period_number, 
                subject_id, teacher_id, start_time, end_time
            ) VALUES (
                ${yearId}, ${classSection.id}, 'monday', 1, 
                ${subject.id}, ${teacher1.id}, '08:00', '08:45'
            )
        `;

    // Check Update
    const [updatedCS1] = await sql`SELECT class_teacher_id FROM class_sections WHERE id = ${classSection.id}`;

    if (updatedCS1.class_teacher_id !== teacher1.id) {

    } else {

    }

    // 3. Test Trigger: Update Teacher

    await sql`
            UPDATE timetable_slots 
            SET teacher_id = ${t2Id}
            WHERE class_section_id = ${classSection.id} 
              AND day_of_week = 'monday' 
              AND period_number = 1
        `;

    const [updatedCS2] = await sql`SELECT class_teacher_id FROM class_sections WHERE id = ${classSection.id}`;

    if (updatedCS2.class_teacher_id !== t2Id) {

    } else {

    }

    // 4. Test Trigger: Delete Slot

    await sql`
            DELETE FROM timetable_slots 
            WHERE class_section_id = ${classSection.id} 
              AND day_of_week = 'monday' 
              AND period_number = 1
        `;

    const [updatedCS3] = await sql`SELECT class_teacher_id FROM class_sections WHERE id = ${classSection.id}`;

    if (updatedCS3.class_teacher_id !== null) {

    } else {

    }

    // Cleanup

    await sql`DELETE FROM class_sections WHERE id = ${classSection.id}`;
    await sql`DELETE FROM sections WHERE id = ${sec.id}`;
    await sql`DELETE FROM classes WHERE id = ${cls.id}`;

  } catch (err) {

  } finally {
    process.exit();
  }
}

verifyTimetableLogic();