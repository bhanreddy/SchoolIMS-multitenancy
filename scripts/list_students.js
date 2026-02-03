import sql from '../db.js';

async function listStudents() {
    try {
        console.log('--- LISTING STUDENTS ---');
        const students = await sql`SELECT id, admission_no, person_id FROM students`;
        console.log(JSON.stringify(students, null, 2));

        console.log('--- FINDING KIRAN ---');
        const persons = await sql`SELECT id, first_name, last_name, display_name FROM persons WHERE first_name ILIKE 'Kiran'`;
        console.log(JSON.stringify(persons, null, 2));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

listStudents();
