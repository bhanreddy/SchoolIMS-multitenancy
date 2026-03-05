import sql from '../db.js';

async function check() {
  const personId = '29459ec7-b755-4b26-a32d-0b14d6651633';
  try {
    const perms = await sql`
            SELECT p.code
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            JOIN role_permissions rp ON r.id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE u.person_id = ${personId}
              AND p.code = 'students.view'
        `;

    if (perms.length === 0) {

      const all = await sql`
                SELECT p.code
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON ur.role_id = r.id
                JOIN role_permissions rp ON r.id = rp.role_id
                JOIN permissions p ON rp.permission_id = p.id
                WHERE u.person_id = ${personId}
            `;

    }
  } catch (err) {

  } finally {
    process.exit(0);
  }
}

check();