import sql, { supabaseAdmin } from '../db.js';

async function debugPermissions() {
    try {
        console.log('--- DEBUG PERMISSIONS ---');
        const email = 'kiran@gmail.com';

        // 1. Get User ID
        const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
        const authUser = users.find(u => u.email === email);

        if (!authUser) {
            console.log('Auth User NOT FOUND');
            return;
        }
        const userId = authUser.id;
        console.log('User ID:', userId);

        // 2. Fetch User Record
        const userRecord = await sql`SELECT * FROM users WHERE id = ${userId}`;
        console.log('User Record:', userRecord[0]);

        // 3. Run the "isOwner" Query exactly as in the route
        console.log('\nRunning isOwner Query...');
        const ownerCheck = await sql`
            SELECT s.id, s.admission_no, s.person_id as student_person_id, u.person_id as user_person_id
            FROM students s
            JOIN users u ON s.person_id = u.person_id
            WHERE u.id = ${userId}
        `;

        if (ownerCheck.length === 0) {
            console.log('❌ isOwner Query returned NO RESULTS');

            // Debug why join failed
            console.log('Debugging Join...');
            const studentForPerson = await sql`SELECT * FROM students WHERE person_id = ${userRecord[0].person_id}`;
            console.log('Student for this person_id:', studentForPerson);

        } else {
            console.log('✅ isOwner Query Result:', ownerCheck[0]);
        }

        console.log('--- FINISHED ---');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

debugPermissions();
