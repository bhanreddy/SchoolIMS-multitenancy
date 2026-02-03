
import 'dotenv/config';
import sql from '../db.js';

async function listUserRoles() {
    console.log('👥 Listing All Users and Roles...\n');
    try {
        const users = await sql`
            SELECT 
                u.id,
                (SELECT contact_value FROM person_contacts pc WHERE pc.person_id = u.person_id AND pc.contact_type = 'email' LIMIT 1) as email,
                array_agg(r.code) as roles, 
                u.account_status
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            GROUP BY u.id, u.person_id, u.account_status
        `;
        console.table(users);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

listUserRoles();
