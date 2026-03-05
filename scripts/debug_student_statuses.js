
import sql from '../db.js';

async function listStatuses() {
  try {

    const statuses = await sql`SELECT * FROM student_statuses`;

  } catch (error) {

  } finally {
    process.exit();
  }
}

listStatuses();