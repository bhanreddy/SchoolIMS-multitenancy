
import sql from '../db.js';

const testStats = async () => {
    try {
        // 1. Today's Collection
        const todayStats = await sql`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM fee_transactions
            WHERE paid_at::date = CURRENT_DATE
        `;

        // 2. Monthly Collection
        const monthlyStats = await sql`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM fee_transactions
            WHERE date_trunc('month', paid_at) = date_trunc('month', CURRENT_DATE)
        `;

        // 3. Pending Dues (Total Outstanding)
        const pendingStats = await sql`
            SELECT COALESCE(SUM(amount_due - amount_paid - discount), 0) as total
            FROM student_fees
            WHERE status IN ('pending', 'partial', 'overdue')
        `;

        const response = {
            today_collection: Number(todayStats[0].total),
            monthly_collection: Number(monthlyStats[0].total),
            pending_dues: Number(pendingStats[0].total)
        };

        console.log('Backend Logic Response:', JSON.stringify(response, null, 2));
        process.exit(0);
    } catch (err) {
        console.error('Logic Error:', err);
        process.exit(1);
    }
};

testStats();
