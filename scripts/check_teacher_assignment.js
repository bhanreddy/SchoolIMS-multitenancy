import sql from '../db.js';

async function check() {
    const personId = '29459ec7-b755-4b26-a32d-0b14d6651633';
    console.log('Checking for Person:', personId);

    try {
        const staff = await sql`SELECT id FROM staff WHERE person_id = ${personId} AND deleted_at IS NULL`;
        console.log('Staff records found:', staff.length);

        if (staff.length > 0) {
            const staffId = staff[0].id;
            console.log('Staff ID:', staffId);

            const [currentYear] = await sql`SELECT id FROM academic_years WHERE now() BETWEEN start_date AND end_date LIMIT 1`;
            console.log('Current Academic Year:', currentYear?.id);

            if (currentYear) {
                const tt = await sql`
                    SELECT ts.id, ts.class_section_id, c.name as class_name, s.name as section_name
                    FROM timetable_slots ts
                    JOIN class_sections cs ON ts.class_section_id = cs.id
                    JOIN classes c ON cs.class_id = c.id
                    JOIN sections s ON cs.section_id = s.id
                    WHERE ts.teacher_id = ${staffId} 
                      AND ts.period_number = 1
                      AND ts.academic_year_id = ${currentYear.id}
                `;
                console.log('Timetable Period 1 Slots:', tt);

                const staticCS = await sql`
                    SELECT cs.id, c.name as class_name, s.name as section_name
                    FROM class_sections cs
                    JOIN classes c ON cs.class_id = c.id
                    JOIN sections s ON cs.section_id = s.id
                    WHERE cs.class_teacher_id = ${staffId}
                      AND cs.academic_year_id = ${currentYear.id}
                `;
                console.log('Static Class Teacher Assignments:', staticCS);
            }
        } else {
            console.log('No active staff record found for this person.');
        }
    } catch (err) {
        console.error('Error during check:', err);
    } finally {
        process.exit(0);
    }
}

check();
