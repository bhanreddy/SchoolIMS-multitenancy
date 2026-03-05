import sql, { supabaseAdmin } from '../db.js';

async function debugPermissions() {
  try {

    const email = 'kiran@gmail.com';

    // 1. Get User ID
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = users.find((u) => u.email === email);

    if (!authUser) {

      return;
    }
    const userId = authUser.id;

    // 2. Fetch User Record
    const userRecord = await sql`SELECT * FROM users WHERE id = ${userId}`;

    // 3. Run the "isOwner" Query exactly as in the route

    const ownerCheck = await sql`
            SELECT s.id, s.admission_no, s.person_id as student_person_id, u.person_id as user_person_id
            FROM students s
            JOIN users u ON s.person_id = u.person_id
            WHERE u.id = ${userId}
        `;

    if (ownerCheck.length === 0) {

      // Debug why join failed

      const studentForPerson = await sql`SELECT * FROM students WHERE person_id = ${userRecord[0].person_id}`;

    } else {

    }

  } catch (error) {

  } finally {
    process.exit();
  }
}

debugPermissions();