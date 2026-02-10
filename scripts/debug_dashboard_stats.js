
import sql from '../db.js';

const debugStats = async () => {
    try {
        console.log('Debugging Dashboard Stats...');

        // 1. Check raw table counts
        const feesCount = await sql`SELECT count(*) FROM student_fees`;
        console.log('Total student_fees rows:', feesCount[0].count);

        const pendingFeesCount = await sql`
            SELECT count(*) FROM student_fees 
            WHERE status IN ('pending', 'partial', 'overdue')
        `;
        console.log('Pending/Partial/Overdue rows:', pendingFeesCount[0].count);

        // 2. Run the exact query from feesRoutes.js
        const pendingStats = await sql`
            SELECT COALESCE(SUM(amount_due - amount_paid - discount), 0) as total
            FROM student_fees
            WHERE status IN ('pending', 'partial', 'overdue')
        `;
        console.log('Query Result (Pending Dues):', pendingStats[0]);

        // 3. Check for any NULLs or weird data
        const weirdData = await sql`
            SELECT id, amount_due, amount_paid, discount, status
            FROM student_fees
            WHERE status IN ('pending', 'partial', 'overdue')
            LIMIT 5
        `;
        console.log('Sample Pending Data:', weirdData);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

debugStats();
