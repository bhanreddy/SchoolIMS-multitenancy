
import sql from '../db.js';

async function grantLMSPermissions() {
    try {
        console.log('Starting LMS permission grant...');

        // 1. Ensure permissions exist
        // Schema: id, code, name
        const permissions = ['lms.create', 'lms.view', 'lms.edit', 'lms.delete'];

        for (const permCode of permissions) {
            const name = 'LMS ' + permCode.split('.')[1].charAt(0).toUpperCase() + permCode.split('.')[1].slice(1);

            await sql`
        INSERT INTO permissions (code, name)
        VALUES (${permCode}, ${name})
        ON CONFLICT (code) DO NOTHING
      `;
            console.log(`Ensured permission: ${permCode}`);
        }

        // 2. Get Role IDs
        // Schema: id, code, name
        // We look for roles with code 'staff', 'admin', 'teacher'
        const roles = await sql`SELECT id, code, name FROM roles WHERE code IN ('staff', 'admin', 'teacher')`;
        console.log('Found roles:', roles.map(r => r.code));

        // 3. Assign permissions to roles
        for (const role of roles) {
            if (role.code === 'admin') {
                // Admin gets all
                for (const permCode of permissions) {
                    const [p] = await sql`SELECT id FROM permissions WHERE code = ${permCode}`;
                    if (p) {
                        await sql`
                 INSERT INTO role_permissions (role_id, permission_id)
                 VALUES (${role.id}, ${p.id})
                 ON CONFLICT DO NOTHING
               `;
                    }
                }
                console.log(`Granted all LMS permissions to ${role.code}`);
            } else if (role.code === 'staff' || role.code === 'teacher') {
                // Staff/Teacher gets all for now
                for (const permCode of permissions) {
                    const [p] = await sql`SELECT id FROM permissions WHERE code = ${permCode}`;
                    if (p) {
                        await sql`
                  INSERT INTO role_permissions (role_id, permission_id)
                  VALUES (${role.id}, ${p.id})
                  ON CONFLICT DO NOTHING
                `;
                    }
                }
                console.log(`Granted LMS permissions to ${role.code}`);
            }
        }

        console.log('LMS permissions granted successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Failed to grant permissions:', error);
        process.exit(1);
    }
}

grantLMSPermissions();
