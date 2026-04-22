
import express from 'express';
import sql from '../db.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendNotificationToUsers } from '../services/notificationService.js';

const router = express.Router();

/**
 * Accounts / principal / admin can process payroll even if DB seed missed payroll.process
 * (accounts always has fees.manage). Also allows principal without enumerating every new permission.
 */
function requirePayrollIssuer(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: No user logged in' });
  }
  const roles = req.user.roles || [];
  if (roles.includes('admin') || roles.includes('accounts') || roles.includes('principal')) {
    return next();
  }
  const perms = req.user.permissions || [];
  if (perms.includes('payroll.process') || perms.includes('fees.manage')) {
    return next();
  }
  return res.status(403).json({
    error: 'Forbidden: You do not have permission to process payroll.',
    code: 'PAYROLL_FORBIDDEN'
  });
}

/**
 * POST /process
 * Process payroll for a specific staff member
 */
router.post('/process', requirePayrollIssuer, asyncHandler(async (req, res) => {
  const { staff_id, month, year, payment_date } = req.body;

  if (!staff_id || !month || !year) {
    return res.status(400).json({ error: 'staff_id, month, and year are required' });
  }

  // P1 FIX: Verify staff belongs to this school before processing payroll
  const [staffCheck] = await sql`SELECT id FROM staff WHERE id = ${staff_id} AND school_id = ${req.schoolId}`;
  if (!staffCheck) {
    return res.status(404).json({ error: 'Staff not found' });
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
      AND staff_id IN (SELECT id FROM staff WHERE school_id = ${req.schoolId})
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

  return sendSuccess(res, req.schoolId, { message: 'Payroll processed successfully', payroll });
}));

/**
 * PUT /:id/pay
 * Mark a specific payroll record as paid by ID
 */
router.put('/:id/pay', requirePayrollIssuer, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payment_date = new Date();

  // P2 FIX: Ownership check via staff.school_id
  const [payrollCheck] = await sql`
    SELECT sp.id FROM staff_payroll sp
    JOIN staff s ON sp.staff_id = s.id
    WHERE sp.id = ${id} AND s.school_id = ${req.schoolId}
  `;
  if (!payrollCheck) {
    return res.status(404).json({ error: 'Payroll record not found' });
  }

  const [payroll] = await sql`
    UPDATE staff_payroll
    SET 
      status = 'paid',
      payment_date = ${payment_date},
      updated_at = now()
    WHERE id = ${id} AND staff_id IN (SELECT id FROM staff WHERE school_id = ${req.schoolId})
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

  return sendSuccess(res, req.schoolId, { message: 'Payroll marked as paid', payroll });
}));

export default router;