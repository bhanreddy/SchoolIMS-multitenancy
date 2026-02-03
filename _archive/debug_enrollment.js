import postgres from 'postgres';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false }
});

async function debug() {
    console.log("Searching for 'Kiran'...");
    try {
        const students = await sql`
        SELECT
        s.id, p.display_name, s.admission_no,
        se.id as enrollment_id, 
        se.status as enrollment_status,
        c.code as class_code,
        sec.name as section_name,
        se.roll_number
        FROM students s
        JOIN persons p ON s.person_id = p.id
        LEFT JOIN student_enrollments se ON s.id = se.student_id
        LEFT JOIN class_sections cs ON se.class_section_id = cs.id
        LEFT JOIN classes c ON cs.class_id = c.id
        LEFT JOIN sections sec ON cs.section_id = sec.id
        WHERE p.display_name ILIKE '%Kiran%'
    `;
        fs.writeFileSync('debug_output.json', JSON.stringify(students, null, 2));
        console.log("Written to debug_output.json");
    } catch (err) {
        console.error(err);
    } finally {
        await sql.end();
    }
}

debug();
