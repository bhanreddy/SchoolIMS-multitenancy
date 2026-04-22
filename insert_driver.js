import sql from './db.js';

(async () => {
    try {
        const schools = await sql`SELECT id FROM schools`;
        for (const school of schools) {
            const [exists] = await sql`SELECT 1 FROM staff_designations WHERE school_id = ${school.id} AND name = 'Driver'`;
            if (!exists) {
                await sql`
                    INSERT INTO staff_designations (id, school_id, name) 
                    VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM staff_designations), ${school.id}, 'Driver')
                `;
            }
        }
        console.log('Driver designation added successfully to all existing schools!');
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
})();
