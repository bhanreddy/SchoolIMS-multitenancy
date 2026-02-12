
import sql from './db.js';

async function findTeacherAndSubject() {
    try {
        console.log('--- Finding IDs ---');

        const arun = await sql`SELECT s.id, p.display_name FROM staff s JOIN persons p ON s.person_id = p.id WHERE p.display_name ILIKE '%Arun%'`;
        console.log('Teacher Arun:', JSON.stringify(arun, null, 2));

        const hindi = await sql`SELECT id, name FROM subjects WHERE name ILIKE '%Hindi%'`;
        console.log('Subject Hindi:', JSON.stringify(hindi, null, 2));

        const bhanu = await sql`SELECT s.id, p.display_name FROM staff s JOIN persons p ON s.person_id = p.id WHERE p.display_name ILIKE '%Bhanu%'`;
        const fs = await import('fs');
        const result = {
            arun,
            hindi,
            bhanu
        };
        fs.writeFileSync('ids.json', JSON.stringify(result, null, 2));
        console.log('IDs written to ids.json');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit();
    }
}

findTeacherAndSubject();
