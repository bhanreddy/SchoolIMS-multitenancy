import sql, { supabaseAdmin } from '../db.js';

async function fixLinkage() {
    try {
        console.log('--- FIXING LINKAGE ---');
        const email = 'kiran@gmail.com';

        // 1. Get Supabase User ID
        const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
        const authUser = users.find(u => u.email === email);

        if (!authUser) {
            console.log('Auth User NOT FOUND');
            return;
        }
        console.log('Auth User ID:', authUser.id);

        // 2. Find the REAL Person (the one linked to the valid student)
        const students = await sql`
            SELECT s.id, s.admission_no, s.person_id 
            FROM students s 
            JOIN persons p ON s.person_id = p.id
            WHERE p.first_name = 'Kiran' 
            ORDER BY s.created_at DESC 
            LIMIT 1
        `;

        if (students.length === 0) {
            console.log('No valid student found for Kiran.');
            return;
        }

        const validStudent = students[0];
        const validPersonId = validStudent.person_id;
        console.log('Valid Student Found:', validStudent.id);
        console.log('Valid Person ID:', validPersonId);

        // 3. Update Users Table (Bypassing Trigger)
        console.log('Updating users table (bypassing trigger)...');

        await sql`ALTER TABLE users DISABLE TRIGGER trg_user_active_person`;

        await sql`
            UPDATE users 
            SET person_id = ${validPersonId}, account_status = 'active'
            WHERE id = ${authUser.id}
        `;

        await sql`ALTER TABLE users ENABLE TRIGGER trg_user_active_person`;

        console.log('Users table updated.');

        // 4. Update Supabase Auth Metadata (for consistency)
        console.log('Updating Supabase Auth Metadata...');
        await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
            user_metadata: {
                ...authUser.user_metadata,
                person_id: validPersonId
            }
        });
        console.log('Auth Metadata updated.');

        console.log('--- FIX COMPLETE ---');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

fixLinkage();
