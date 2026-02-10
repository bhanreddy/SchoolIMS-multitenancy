
import sql from '../db.js';

async function verifyStudentCount() {
    try {
        console.log('--- VERIFYING STUDENT COUNT ---');

        // 1. Count from View
        const viewResult = await sql`SELECT COUNT(*) FROM active_students`;
        const viewCount = parseInt(viewResult[0].count);
        console.log(`Active Students View Count: ${viewCount}`);

        // 2. Count from Table (Raw)
        const tableResult = await sql`
            SELECT COUNT(*) FROM students 
            WHERE deleted_at IS NULL AND status_id = 1
        `;
        const tableCount = parseInt(tableResult[0].count);
        console.log(`Raw Table Count (status_id=1): ${tableCount}`);

        // 3. Count Total (Including inactive)
        const totalResult = await sql`SELECT COUNT(*) FROM students WHERE deleted_at IS NULL`;
        const totalCount = parseInt(totalResult[0].count);
        console.log(`Total Students (All Statuses): ${totalCount}`);

        if (viewCount === tableCount) {
            console.log('✅ SUCCESS: View matches raw active student count.');
        } else {
            console.error('❌ FAILURE: View count does NOT match raw active student count.');
        }

    } catch (error) {
        console.error('Error verifying count:', error);
    } finally {
        process.exit();
    }
}

verifyStudentCount();
