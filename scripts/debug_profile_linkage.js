import sql, { supabaseAdmin } from '../db.js';

async function debugLinkage() {
    try {
        console.log('--- DEBUG LINKAGE ---');
        const email = 'kiran@gmail.com';

        // 1. Get Supabase User ID
        const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
        const authUser = users.find(u => u.email === email);

        if (!authUser) {
            console.log('Auth User NOT FOUND');
            return;
        }
        console.log('Auth User ID:', authUser.id);
        console.log('Auth Metadata person_id:', authUser.user_metadata.person_id);

        // 2. Check Local User
        const localUser = await sql`SELECT * FROM users WHERE id = ${authUser.id}`;
        if (localUser.length === 0) {
            console.log('Local User NOT FOUND');
        } else {
            console.log('Local User Found:', localUser[0]);

            // 3. Check Linked Person
            const personId = localUser[0].person_id;
            const person = await sql`SELECT * FROM persons WHERE id = ${personId}`;
            if (person.length === 0) {
                console.log(`❌ CRITICAL: Local User points to DELETED person_id: ${personId}`);
            } else {
                console.log('Linked Person Found:', person[0]);
            }

            // 4. Check Student link from this Person
            const student = await sql`SELECT * FROM students WHERE person_id = ${personId}`;
            if (student.length === 0) {
                console.log(`❌ CRITICAL: No student found for person_id: ${personId}`);
            } else {
                console.log('Linked Student Found:', student[0]);
            }
        }

        // 5. Look for ANY student with this name to see the mismatched person_id
        const anyStudent = await sql`
            SELECT s.*, p.first_name, p.last_name, p.id as real_person_id
            FROM students s 
            JOIN persons p ON s.person_id = p.id 
            WHERE p.first_name = 'Kiran'
        `;
        console.log('\n--- ACTUAL STUDENT RECORDS ---');
        console.log(JSON.stringify(anyStudent, null, 2));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

debugLinkage();
