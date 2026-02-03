import postgres from 'postgres';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false }
});

async function verify() {
    const testName = `AutoTest_${Date.now()}`;
    console.log(`Starting Auto-Enrollment Verification for ${testName}...`);

    try {
        const result = await sql.begin(async sql => {
            // 1. Create Person
            const [person] = await sql`
            INSERT INTO persons (first_name, last_name, gender_id, display_name)
            VALUES (${testName}, 'User', 1, ${testName + ' User'})
            RETURNING id
        `;

            // 2. Create Student
            const admissionNo = 'TEST-' + Date.now();
            const [student] = await sql`
            INSERT INTO students (person_id, admission_no, admission_date, status_id)
            VALUES (${person.id}::uuid, ${admissionNo}::varchar, '2026-01-01'::date, 1::smallint)
            RETURNING *
        `;

            // --- ENROLLMENT LOGIC UNDER TEST ---
            let targetClassSectionId = null;
            let targetAcademicYearId = null;

            // 5a. Resolve Academic Year
            const [ay] = await sql`SELECT id FROM academic_years WHERE now() BETWEEN start_date AND end_date LIMIT 1`;
            if (ay) targetAcademicYearId = ay.id;

            // 5b. Resolve Class Section (Default)
            const [cs] = await sql`
            SELECT cs.id FROM class_sections cs 
            JOIN classes c ON cs.class_id = c.id 
            JOIN sections s ON cs.section_id = s.id
            ORDER BY c.name ASC, s.name ASC
            LIMIT 1
         `;
            if (cs) targetClassSectionId = cs.id;

            console.log(`Resolved Context -> ClassSection: ${targetClassSectionId}, AY: ${targetAcademicYearId}`);

            // 5c. Insert Enrollment with Roll Number
            if (targetClassSectionId && targetAcademicYearId) {
                // Calculate Next Roll Number
                const [rollData] = await sql`
                SELECT COALESCE(MAX(roll_number), 0) + 1 as next_roll 
                FROM student_enrollments 
                WHERE class_section_id = ${targetClassSectionId} 
                AND academic_year_id = ${targetAcademicYearId}
                AND deleted_at IS NULL
             `;

                const nextRoll = rollData ? rollData.next_roll : 1;
                console.log(`Calculated Roll Number: ${nextRoll}`);

                await sql`
                INSERT INTO student_enrollments (student_id, class_section_id, academic_year_id, status, start_date, roll_number)
                VALUES (${student.id}, ${targetClassSectionId}, ${targetAcademicYearId}, 'active', '2026-01-01', ${nextRoll})
             `;
                return { student, nextRoll, targetClassSectionId };
            }
            return { student, error: "Failed to resolve context" };
        });

        console.log("Transaction Committed.");
        console.log("Result:", result);

        if (result.nextRoll) {
            console.log("SUCCESS: Student enrolled automatically.");
        } else {
            console.error("FAILURE: Student NOT enrolled.");
        }

    } catch (err) {
        console.error("Verification Failed:", err);
    } finally {
        await sql.end();
    }
}

verify();
