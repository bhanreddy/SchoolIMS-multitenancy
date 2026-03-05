
import 'dotenv/config';
import sql from '../db.js';

async function checkStaffPermissions() {

  try {
    const permissions = await sql`
            SELECT p.code 
            FROM role_permissions rp 
            JOIN permissions p ON rp.permission_id = p.id 
            JOIN roles r ON rp.role_id = r.id 
            WHERE r.code = 'staff'
        `;

  } catch (e) {

  }
  process.exit(0);
}

checkStaffPermissions();