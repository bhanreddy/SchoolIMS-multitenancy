import sql from './db.js';

async function run() {
  try {
    const staffId = '813e8c06-b799-4039-916c-f51d541a1e33'; // From previous debug
    const userInfo = await sql`
      SELECT 
        u.id as user_id, u.school_id, u.account_status,
        p.display_name, p.photo_url,
        r.code as role_code, r.name as role_name
      FROM users u
      JOIN persons p ON u.person_id = p.id
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON ur.role_id = r.id
      WHERE u.id = ${staffId}
        AND u.deleted_at IS NULL
      LIMIT 1
    `;
    console.log('validate-school-user query length:', userInfo.length);
    if (userInfo.length > 0) {
      console.log('User found:', userInfo[0]);
    } else {
      console.log('User NOT found with this specific joined query!');
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
