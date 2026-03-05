/**
 * Fix Admin Permissions Script
 * Ensures admin user has all necessary permissions
 */

import 'dotenv/config';
import sql from '../db.js';

async function fixAdminPermissions() {

  try {
    // 1. Find all admin users
    const adminUsers = await sql`
            SELECT u.id, p.display_name
            FROM users u
            JOIN persons p ON u.person_id = p.id
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            WHERE r.code = 'admin'
        `;

    if (adminUsers.length === 0) {

      process.exit(1);
    }

    adminUsers.forEach((u) => {});

    // 2. Get admin role
    const [adminRole] = await sql`SELECT id FROM roles WHERE code = 'admin'`;

    if (!adminRole) {

      process.exit(1);
    }

    // 3. Get ALL permissions
    const allPermissions = await sql`SELECT id, code FROM permissions ORDER BY code`;

    // 4. Assign ALL permissions to admin role

    let assigned = 0;
    for (const perm of allPermissions) {
      await sql`
                INSERT INTO role_permissions (role_id, permission_id)
                VALUES (${adminRole.id}, ${perm.id})
                ON CONFLICT (role_id, permission_id) DO NOTHING
            `;
      assigned++;
    }

    // 5. Verify
    const [verification] = await sql`
            SELECT COUNT(*) as count
            FROM role_permissions rp
            JOIN roles r ON rp.role_id = r.id
            WHERE r.code = 'admin'
        `;

  } catch (error) {

    process.exit(1);
  }

  process.exit(0);
}

fixAdminPermissions();