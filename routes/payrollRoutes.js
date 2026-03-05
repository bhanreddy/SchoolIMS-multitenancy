
import express from 'express';
import sql from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendNotificationToUsers } from '../services/notificationService.js';

const router = express.Router();

/**
 * POST /process
 * Process payroll for a specific staff member
 */
router.post('/process', requirePermission('payroll.process'), asyncHandler(async (req, res) => {
  const { staff_id, month, year, payment_date } = req.body;

  if (!staff_id || !month || !year) {
    return res.status(400).json({ error: 'staff_id, month, and year are required' });
  }

  // 1. Calculate/Ensure Payroll Exists
  // This RPC presumably inserts or updates the staff_payroll row
  await sql`SELECT recalculate_staff_payroll(${staff_id}, ${month}, ${year})`;

  // 2. Mark as Paid
  const payDate = payment_date || new Date();

  const [payroll] = await sql`
    UPDATE staff_payroll
    SET 
      status = 'paid',
      payment_date = ${payDate},
      updated_at = now()
    WHERE staff_id = ${staff_id}
      AND payroll_month = ${month}
      AND payroll_year = ${year}
    RETURNING *
  `;

  if (!payroll) {
    return res.status(404).json({ error: 'Payroll record could not be processed' });
  }

  // 3. Notification: PAYROLL_SUCCESS (Staff Member)
  (async () => {
    try {
      // Get User ID from Staff ID
      const [user] = await sql`
        SELECT u.id 
        FROM users u 
        JOIN staff s ON u.person_id = s.person_id 
        WHERE s.id = ${staff_id} 
          AND u.account_status = 'active'
      `;

      if (user) {
        await sendNotificationToUsers(
          [user.id],
          'PAYROLL_SUCCESS',
          { message: 'Your salary has been credited successfully.' }
        );
      }
    } catch (err) {

    }
  })();

  res.json({ message: 'Payroll processed successfully', payroll });
}));

/**
 * PUT /:id/pay
 * Mark a specific payroll record as paid by ID
 */
router.put('/:id/pay', requirePermission('payroll.process'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payment_date = new Date();

  const [payroll] = await sql`
    UPDATE staff_payroll
    SET 
      status = 'paid',
      payment_date = ${payment_date},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;

  if (!payroll) {
    return res.status(404).json({ error: 'Payroll record not found' });
  }

  // Notification: PAYROLL_SUCCESS
  (async () => {
    try {
      const [user] = await sql`
        SELECT u.id 
        FROM users u 
        JOIN staff s ON u.person_id = s.person_id 
        WHERE s.id = ${payroll.staff_id} 
          AND u.account_status = 'active'
      `;

      if (user) {
        await sendNotificationToUsers(
          [user.id],
          'PAYROLL_SUCCESS',
          { message: 'Your salary has been credited successfully.' }
        );
      }
    } catch (err) {

    }
  })();

  res.json({ message: 'Payroll marked as paid', payroll });
}));

export default router;