/**
 * Check Admin User Script
 * Checks if admin user exists in both Supabase Auth and local database
 * and fixes any inconsistencies
 */

import 'dotenv/config';
import sql, { supabaseAdmin } from '../db.js';

const ADMIN_EMAIL = 'admin@school.com';

async function checkAndFixAdmin() {

  try {
    // 1. Check Supabase Auth

    const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();

    if (listError) {

      return;
    }

    const authUser = authUsers.users.find((u) => u.email === ADMIN_EMAIL);

    if (!authUser) {

      return;
    }

    // 2. Check local database

    const [localUser] = await sql`
            SELECT u.id, p.display_name
            FROM users u
            JOIN persons p ON u.person_id = p.id
            WHERE u.id = ${authUser.id}
        `;

    if (!localUser) {

      // Get gender ID
      const [gender] = await sql`SELECT id FROM genders WHERE name = 'Male'`;

      // Create person and user in transaction
      await sql.begin(async (sql) => {
        // Create Person
        const [person] = await sql`
                    INSERT INTO persons (first_name, last_name, gender_id)
                    VALUES ('Admin', 'User', ${gender.id})
                    RETURNING id
                `;

        // Create User (with Supabase ID)
        await sql`
                    INSERT INTO users (id, person_id, account_status)
                    VALUES (${authUser.id}, ${person.id}, 'active')
                `;

        // Get Admin Role
        const [adminRole] = await sql`SELECT id FROM roles WHERE code = 'admin'`;

        // Assign Admin Role
        await sql`
                    INSERT INTO user_roles (user_id, role_id)
                    VALUES (${authUser.id}, ${adminRole.id})
                `;

        // Add email contact
        await sql`
                    INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary)
                    VALUES (${person.id}, 'email', ${ADMIN_EMAIL}, true)
                `;

      });

    } else {

      // 3. Check role assignment

      const [roleCheck] = await sql`
                SELECT r.code
                FROM user_roles ur
                JOIN roles r ON ur.role_id = r.id
                WHERE ur.user_id = ${authUser.id} AND r.code = 'admin'
            `;

      if (!roleCheck) {

        const [adminRole] = await sql`SELECT id FROM roles WHERE code = 'admin'`;
        await sql`
                    INSERT INTO user_roles (user_id, role_id)
                    VALUES (${authUser.id}, ${adminRole.id})
                    ON CONFLICT DO NOTHING
                `;

      } else {

      }
    }

  } catch (error) {

    process.exit(1);
  }

  process.exit(0);
}

checkAndFixAdmin();