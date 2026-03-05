
import sql from '../db.js';

const debugStats = async () => {
  try {

    // 1. Check raw table counts
    const feesCount = await sql`SELECT count(*) FROM student_fees`;

    const pendingFeesCount = await sql`
            SELECT count(*) FROM student_fees 
            WHERE status IN ('pending', 'partial', 'overdue')
        `;

    // 2. Run the exact query from feesRoutes.js
    const pendingStats = await sql`
            SELECT COALESCE(SUM(amount_due - amount_paid - discount), 0) as total
            FROM student_fees
            WHERE status IN ('pending', 'partial', 'overdue')
        `;

    // 3. Check for any NULLs or weird data
    const weirdData = await sql`
            SELECT id, amount_due, amount_paid, discount, status
            FROM student_fees
            WHERE status IN ('pending', 'partial', 'overdue')
            LIMIT 5
        `;

    process.exit(0);
  } catch (err) {

    process.exit(1);
  }
};

debugStats();