
import sql from '../db.js';

async function updateActiveStudentsView() {
    try {
        console.log('--- UPDATING ACTIVE_STUDENTS VIEW ---');

        await sql`
            CREATE OR REPLACE VIEW active_students AS
            SELECT * FROM students 
            WHERE deleted_at IS NULL 
              AND status_id = 1;
        `;

        console.log('Successfully updated active_students view.');

        // Verification
        const count = await sql`SELECT COUNT(*) FROM active_students`;
        console.log('New Active Student Count:', count[0].count);

    } catch (error) {
        console.error('Error updating view:', error);
    } finally {
        process.exit();
    }
}

updateActiveStudentsView();
