import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from './db.js';

async function updateSchoolIds() {
    try {
        console.log('Starting school_id update...');
        
        await sql`UPDATE timetable_slots SET school_id = 1 WHERE school_id IS NULL`;
        console.log('Updated timetable_slots');

        await sql`UPDATE class_subjects SET school_id = 1 WHERE school_id IS NULL`;
        console.log('Updated class_subjects');

        await sql`UPDATE subjects SET school_id = 1 WHERE school_id IS NULL`;
        console.log('Updated subjects');

        await sql`UPDATE class_sections SET school_id = 1 WHERE school_id IS NULL`;
        console.log('Updated class_sections');

        await sql`UPDATE classes SET school_id = 1 WHERE school_id IS NULL`;
        console.log('Updated classes');

        await sql`UPDATE sections SET school_id = 1 WHERE school_id IS NULL`;
        console.log('Updated sections');

        console.log('All updates completed successfully.');
    } catch (err) {
        console.error('Error updating school_ids:', err);
    } finally {
        process.exit();
    }
}

updateSchoolIds();
