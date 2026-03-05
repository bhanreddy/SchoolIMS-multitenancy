
import 'dotenv/config';
import sql, { supabase } from '../db.js';

const ADMIN_EMAIL = 'admin@school.com';
const ADMIN_PASSWORD = 'Admin@123';

async function debugLogin() {

  // 1. Supabase Auth Login

  const { data, error } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  });

  if (error) {

    process.exit(1);
  }

  const userId = data.user.id;

  // 2. Test "authRoutes.js" Login Query

  try {
    const userInfo = await sql`
            SELECT 
            u.id, u.account_status,
            p.first_name, p.last_name, p.display_name, p.photo_url,
            array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL) as roles,
            array_agg(DISTINCT perm.code) FILTER (WHERE perm.code IS NOT NULL) as permissions
            FROM users u
            JOIN persons p ON u.person_id = p.id
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            LEFT JOIN role_permissions rp ON r.id = rp.role_id
            LEFT JOIN permissions perm ON rp.permission_id = perm.id
            WHERE u.id = ${userId}
            GROUP BY u.id, p.first_name, p.last_name, p.display_name, p.photo_url
        `;

    if (userInfo.length === 0) {

    } else {

      if (userInfo[0].account_status !== 'active') {

      }
    }
  } catch (err) {

  }

  // 3. Test "middleware/auth.js" identifyUser Query

  try {
    const middlewareInfo = await sql`
            SELECT 
                u.id, 
                u.account_status,
                array_agg(DISTINCT r.code) as roles,
                array_agg(DISTINCT p.code) as permissions
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            LEFT JOIN role_permissions rp ON r.id = rp.role_id
            LEFT JOIN permissions p ON rp.permission_id = p.id
            WHERE u.id = ${userId}
            GROUP BY u.id
        `;

    if (middlewareInfo.length === 0) {

    } else {

    }

  } catch (err) {

  }

  // 4. Check explicit Tables

  const personCheck = await sql`SELECT * FROM users WHERE id = ${userId}`;

  const roleCheck = await sql`
        SELECT r.code FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = ${userId}
    `;

  process.exit(0);
}

debugLogin();