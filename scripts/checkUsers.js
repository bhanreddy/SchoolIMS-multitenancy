import sql from '../db.js';

async function checkUsers() {
  try {
    const users = await sql`
            SELECT u.id, p.display_name, 
                ARRAY_AGG(r.code) as roles,
                EXISTS(SELECT 1 FROM staff s WHERE s.person_id = u.person_id AND s.deleted_at IS NULL) as has_staff_profile,
                EXISTS(SELECT 1 FROM students s WHERE s.person_id = u.person_id AND s.deleted_at IS NULL) as has_student_profile
            FROM users u
            JOIN persons p ON p.id = u.person_id
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            GROUP BY u.id, p.display_name, u.person_id
        `;
    const fs = await import('fs');
    fs.writeFileSync('users_dump.json', JSON.stringify(users, null, 2), 'utf-8');
    process.exit(0);
  } catch (e) {

    process.exit(1);
  }
}
checkUsers();