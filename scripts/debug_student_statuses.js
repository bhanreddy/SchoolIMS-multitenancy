
import sql from '../db.js';

async function listStatuses() {
    try {
        console.log('--- STUDENT STATUSES ---');
        const statuses = await sql`SELECT * FROM student_statuses`;
        console.log(JSON.stringify(statuses, null, 2));
    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

listStatuses();
