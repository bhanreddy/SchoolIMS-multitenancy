import sql, { supabaseAdmin } from '../db.js';

async function debugLinkage() {
  try {

    const email = 'kiran@gmail.com';

    // 1. Get Supabase User ID
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = users.find((u) => u.email === email);

    if (!authUser) {

      return;
    }

    // 2. Check Local User
    const localUser = await sql`SELECT * FROM users WHERE id = ${authUser.id}`;
    if (localUser.length === 0) {

    } else {

      // 3. Check Linked Person
      const personId = localUser[0].person_id;
      const person = await sql`SELECT * FROM persons WHERE id = ${personId}`;
      if (person.length === 0) {

      } else {

      }

      // 4. Check Student link from this Person
      const student = await sql`SELECT * FROM students WHERE person_id = ${personId}`;
      if (student.length === 0) {

      } else {

      }
    }

    // 5. Look for ANY student with this name to see the mismatched person_id
    const anyStudent = await sql`
            SELECT s.*, p.first_name, p.last_name, p.id as real_person_id
            FROM students s 
            JOIN persons p ON s.person_id = p.id 
            WHERE p.first_name = 'Kiran'
        `;

  } catch (error) {

  } finally {
    process.exit();
  }
}

debugLinkage();