
import sql from '../db.js';

async function fixFeeLedger() {

  // 1. Get all student fees that have transactions
  const feesToFix = await sql`
    SELECT sf.id, sf.student_id, sf.amount_due, sf.amount_paid, sf.discount, sf.status,
           COALESCE(SUM(t.amount), 0) as calculated_paid
    FROM student_fees sf
    LEFT JOIN fee_transactions t ON sf.id = t.student_fee_id
    GROUP BY sf.id
    HAVING sf.amount_paid != COALESCE(SUM(t.amount), 0)
  `;

  for (const fee of feesToFix) {

    // Determine new status
    let newStatus = 'pending';
    const remaining = Number(fee.amount_due) - Number(fee.discount) - Number(fee.calculated_paid);

    if (remaining <= 0) {
      newStatus = 'paid';
    } else if (Number(fee.calculated_paid) > 0) {
      newStatus = 'partial';
    } else {
      // If due date passed, it might be overdue, but let's stick to basic logic or keep existing if appropriate
      // For simplicity, we re-evaluate 'overdue' if pending and past due date
      // But here we will trust the simple logic: if 0 paid -> pending (trigger will update to overdue if needed on next update or cron)
      // Actually, let's keep it simple.
      newStatus = fee.status === 'overdue' && Number(fee.calculated_paid) === 0 ? 'overdue' : 'pending';
    }

    // Update the record
    await sql`
      UPDATE student_fees
      SET 
        amount_paid = ${fee.calculated_paid},
        status = ${newStatus}::fee_status_enum,
        updated_at = NOW()
      WHERE id = ${fee.id}
    `;
  }

  process.exit(0);
}

fixFeeLedger().catch((err) => {

  process.exit(1);
});