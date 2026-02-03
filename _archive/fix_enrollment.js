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

async function run() {
    try {
        // Enroll Kiran Goud
        const studentId = '810d70c2-f7c0-4dba-af93-6643a727bfea';
        const classSectionId = 'd60ffbd6-f99a-45b1-bca9-097ed83e0956';
        const academicYearId = '3cb48372-2f39-48ff-b54d-7827a67455a9'; // 2025-2026

        console.log(`Enrolling Student: ${studentId}`);
        console.log(`Class Section: ${classSectionId}`);
        console.log(`Academic Year: ${academicYearId}`);

        // Check if already exists (just in case)
        const existing = await sql`
        SELECT id FROM student_enrollments
        WHERE student_id = ${studentId} AND academic_year_id = ${academicYearId}
      `;

        if (existing.length > 0) {
            console.log("Enrollment already exists, updating status to active...");
            await sql`
            UPDATE student_enrollments SET status = 'active', deleted_at = NULL, roll_number = 1, class_section_id = ${classSectionId}
            WHERE id = ${existing[0].id}
          `;
        } else {
            console.log("Creating new enrollment...");
            await sql`
            INSERT INTO student_enrollments (student_id, class_section_id, academic_year_id, status, start_date, roll_number)
            VALUES (${studentId}, ${classSectionId}, ${academicYearId}, 'active', '2025-06-01', 1)
        `;
        }
        console.log("Success.");
    } catch (err) {
        console.error(err);
    } finally {
        await sql.end();
    }
}

run();
