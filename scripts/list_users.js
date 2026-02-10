import sql from './db.js';

async function listUsers() {
    try {
        const users = await sql`SELECT u.id, u.email, array_agg(r.code) as roles 
                                FROM users u 
                                JOIN user_roles ur ON u.id = ur.user_id 
                                JOIN roles r ON ur.role_id = r.id 
                                GROUP BY u.id, u.email 
                                LIMIT 10`;
        console.log(JSON.stringify(users, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

listUsers();
