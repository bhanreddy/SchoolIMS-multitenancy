
import sql from './db.js';

async function seedTimetable() {
    try {
        console.log('--- Seeding Timetable Smartly ---');

        // 1. Get Current Academic Year
        const [year] = await sql`SELECT id FROM academic_years WHERE now() BETWEEN start_date AND end_date LIMIT 1`;
        if (!year) throw new Error('No active academic year found');

        // 2. Get a Class Section (Targeted)
        const classSection = { id: '6f891673-8d9a-4e6f-8519-d5363df86406' };
        console.log('Class Section:', classSection.id);

        // 3. Get Subjects
        const subjects = await sql`SELECT id, name FROM subjects LIMIT 5`;
        if (subjects.length === 0) throw new Error('No subjects found');

        // 4. Get a Teacher (First one found)
        const [teacher] = await sql`SELECT id FROM staff LIMIT 1`;
        if (!teacher) throw new Error('No teachers found');
        console.log('Teacher:', teacher.id);

        // 5. Ensure Class Subjects Assignment (Required by Trigger)
        let assignedSubjects = [];

        await sql.begin(async sql => {
            for (const sub of subjects) {
                // Check if ANY teacher is assigned to this subject in this class
                const existing = await sql`
                SELECT teacher_id FROM class_subjects 
                WHERE class_section_id = ${classSection.id} 
                  AND subject_id = ${sub.id}
            `;

                // ARUN KURA ID (Real Teacher)
                const arunId = '26dfeed3-9d5d-46a4-a307-494571335f94';
                const hindiId = '0b93cd5c-428a-4089-99a9-9865be603ce9';

                if (existing.length === 0) {
                    // Assign Arun to everything for now, or specific check
                    let teacherToAssign = arunId;

                    if (sub.id === hindiId) {
                        console.log('Assigning ARUN to HINDI');
                        teacherToAssign = arunId;
                    }

                    console.log(`Assigning teacher to ${sub.name}`);
                    await sql`
                    INSERT INTO class_subjects (
                        class_section_id, subject_id, teacher_id
                    ) VALUES (
                        ${classSection.id}, ${sub.id}, ${teacherToAssign}
                    )
                    ON CONFLICT (class_section_id, subject_id) DO UPDATE 
                    SET teacher_id = EXCLUDED.teacher_id, deleted_at = NULL
                `;
                    teacherIdForSubject = teacherToAssign;
                } else {
                    // If existing, FORCE UPDATE to Arun if it's Hindi (to fix bad data)
                    if (sub.id === hindiId) {
                        console.log('Correcting HINDI assignment to ARUN');
                        await sql`
                            UPDATE class_subjects 
                            SET teacher_id = ${arunId}, deleted_at = NULL
                            WHERE class_section_id = ${classSection.id} AND subject_id = ${sub.id}
                        `;
                        teacherIdForSubject = arunId;
                    } else {
                        teacherIdForSubject = existing[0].teacher_id;
                    }
                }

                assignedSubjects.push({ subject_id: sub.id, teacher_id: teacherIdForSubject });
            }
        });

        // 6. Insert Timetable Slots
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
        const periods = [1, 2, 3, 4];

        const times = [
            { start: '09:00:00', end: '09:45:00' },
            { start: '09:45:00', end: '10:30:00' },
            { start: '10:45:00', end: '11:30:00' },
            { start: '11:30:00', end: '12:15:00' }
        ];

        let insertedCount = 0;

        await sql.begin(async sql => {
            for (const day of days) {
                for (let i = 0; i < periods.length; i++) {
                    const period = periods[i];
                    const time = times[i];

                    // Use assigned subject/teacher pair
                    const assignment = assignedSubjects[i % assignedSubjects.length];

                    const existing = await sql`
                    SELECT 1 FROM timetable_slots 
                    WHERE class_section_id = ${classSection.id}
                      AND academic_year_id = ${year.id}
                      AND day_of_week = ${day}::day_of_week_enum
                      AND period_number = ${period}
                `;

                    if (existing.length === 0) {
                        await sql`
                        INSERT INTO timetable_slots (
                            academic_year_id, class_section_id, day_of_week, period_number,
                            subject_id, teacher_id, start_time, end_time, room_no, created_at, updated_at
                        ) VALUES (
                            ${year.id}, ${classSection.id}, ${day}::day_of_week_enum, ${period},
                            ${assignment.subject_id}, ${assignment.teacher_id}, ${time.start}, ${time.end}, 'Room 101', now(), now()
                        )
                    `;
                        insertedCount++;
                    }
                }
            }
        });

        console.log(`Seeded ${insertedCount} slots.`);

    } catch (err) {
        const fs = await import('fs');
        fs.writeFileSync('seed_error.log', JSON.stringify(err, null, 2));
        console.error('Error logged to seed_error.log');
    } finally {
        process.exit();
    }
}

seedTimetable();
