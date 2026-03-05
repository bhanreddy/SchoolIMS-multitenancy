import sql from '../db.js';

async function listStudents() {
  try {

    const students = await sql`SELECT id, admission_no, person_id FROM students`;

    const persons = await sql`SELECT id, first_name, last_name, display_name FROM persons WHERE first_name ILIKE 'Kiran'`;

  } catch (error) {

  } finally {
    process.exit();
  }
}

listStudents();