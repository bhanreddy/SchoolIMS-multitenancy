import sql from '../db.js';
import fs from 'fs';

async function verifyClasses() {
  try {
    let output = '--- START VERIFICATION ---\n';

    output += '1. Checking classes table...\n';
    const classes = await sql`SELECT * FROM classes`;
    output += `Found ${classes.length} classes.\n`;
    if (classes.length > 0) {
      output += JSON.stringify(classes, null, 2) + '\n';
    } else {
      output += 'CLASSES TABLE IS EMPTY!\n';
    }

    output += '\n2. Checking permissions for role "admin"...\n';
    const adminPermissions = await sql`
            SELECT p.code 
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id
            JOIN roles r ON rp.role_id = r.id
            WHERE r.code = 'admin'
        `;
    const permissionsList = adminPermissions.map((p) => p.code);
    output += 'Admin Permissions: ' + JSON.stringify(permissionsList, null, 2) + '\n';

    const hasView = permissionsList.includes('academics.view');
    output += `Has 'academics.view' permission? ${hasView}\n`;

    output += '--- END VERIFICATION ---\n';

    fs.writeFileSync('verification_output.txt', output);

  } catch (error) {

    fs.writeFileSync('verification_output.txt', 'Error: ' + error.message);
  } finally {
    process.exit();
  }
}

verifyClasses();