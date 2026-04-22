import sql from './db.js';

async function run() {
  try {
    const users = await sql`
      SELECT u.id, u.school_id, r.code as role_code, u.account_status, u.deleted_at
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE r.code = 'staff'
    `;
    console.log('Staff users:', users);
    
    // Also check if they are in auth.users
    if (users.length > 0) {
      const authUser = await sql`SELECT id, email FROM auth.users WHERE id = ${users[0].id}`;
      console.log('Auth user:', authUser);
    }
  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
}
run();
