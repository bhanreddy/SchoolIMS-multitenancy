import sql from './db.js';

async function fix() {
    console.log('Adding "Manage Notices" policy...');
    try {
        await sql`
            DROP POLICY IF EXISTS "Manage Notices" ON notices;
            CREATE POLICY "Manage Notices" ON notices
            FOR ALL 
            USING (
              auth_has_role(ARRAY['admin']) OR
              EXISTS (
                SELECT 1 FROM user_roles ur
                JOIN role_permissions rp ON ur.role_id = rp.role_id
                JOIN permissions p ON rp.permission_id = p.id
                WHERE ur.user_id = auth.uid() AND (p.code = 'notices.create' OR p.code = 'notices.manage')
              )
            );
        `;
        console.log('Success! Policy added.');
    } catch (e) {
        console.error('Error:', e);
    }
    process.exit(0);
}

fix();
