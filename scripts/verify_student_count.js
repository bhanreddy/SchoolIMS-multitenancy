
import sql from '../db.js';

async function verifyStudentCount() {
  try {

    // 1. Count from View
    const viewResult = await sql`SELECT COUNT(*) FROM active_students`;
    const viewCount = parseInt(viewResult[0].count);

    // 2. Count from Table (Raw)
    const tableResult = await sql`
            SELECT COUNT(*) FROM students 
            WHERE deleted_at IS NULL AND status_id = 1
        `;
    const tableCount = parseInt(tableResult[0].count);

    // 3. Count Total (Including inactive)
    const totalResult = await sql`SELECT COUNT(*) FROM students WHERE deleted_at IS NULL`;
    const totalCount = parseInt(totalResult[0].count);

    if (viewCount === tableCount) {

    } else {

    }

  } catch (error) {

  } finally {
    process.exit();
  }
}

verifyStudentCount();