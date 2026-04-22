
import express from 'express';
import sql from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendNotificationToUsers } from '../services/notificationService.js';

const router = express.Router();

/**
 * POST /
 * Create a new expense claim/record
 */
router.post('/', requirePermission('expenses.create'), asyncHandler(async (req, res) => {
  const { title, description, amount, expense_date, category } = req.body;
  const userId = req.user.id;

  if (!amount || !expense_date) {
    return res.status(400).json({ error: 'Amount and Date are required' });
  }

  // E1 FIX: Add school_id to expenses INSERT
  const [expense] = await sql`
    INSERT INTO expenses (
      school_id, title, description, amount, expense_date, category,
      status, created_by
    ) VALUES (
      ${req.schoolId},
      ${title || 'Untitled Expense'},
      ${description || ''},
      ${amount},
      ${expense_date},
      ${category || 'general'},
      'pending',
      ${userId}
    )
    RETURNING *
  `;

  // E3 FIX: Add school_id filters to admin notification query
  (async () => {
    try {
      const recipients = await sql`
        SELECT DISTINCT ur.user_id
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        JOIN users u ON ur.user_id = u.id
        WHERE r.code = 'admin'
          AND u.account_status = 'active'
          AND u.school_id = ${req.schoolId}
          AND ur.school_id = ${req.schoolId}
          AND r.school_id = ${req.schoolId}
      `;

      if (recipients.length > 0) {
        const userIds = recipients.map((r) => r.user_id);
        const uniqueIds = [...new Set(userIds)];

        const finalIds = uniqueIds.filter((id) => id !== userId);

        if (finalIds.length > 0) {
          await sendNotificationToUsers(
            finalIds,
            'EXPENSE_CREATED',
            { message: 'New expense submitted for approval.' }
          );
        }
      }
    } catch (err) {

    }
  })();

  return sendSuccess(res, req.schoolId, { message: 'Expense created successfully', expense }, 201);
}));

/**
 * PUT /:id/status
 * Approve or Reject an expense
 */
router.put('/:id/status', requirePermission('expenses.approve'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, remarks } = req.body; // status: 'approved' | 'rejected' | 'paid'

  if (!['approved', 'rejected', 'paid'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Use approved, rejected, or paid.' });
  }

  // E2 FIX: Ownership check first
  const [existing] = await sql`SELECT id FROM expenses WHERE id = ${id} AND school_id = ${req.schoolId}`;
  if (!existing) {
    return res.status(404).json({ error: 'Expense not found' });
  }

  const [updated] = await sql`
    UPDATE expenses
    SET
      status = ${status},
      approved_by = ${req.user.id},
      updated_at = now()
    WHERE id = ${id} AND school_id = ${req.schoolId}
    RETURNING *
  `;

  if (!updated) {
    return res.status(404).json({ error: 'Expense not found' });
  }

  // 2. Notification: EXPENSE_APPROVED or EXPENSE_REJECTED (Creator)
  (async () => {
    try {
      if (updated.created_by) {
        // Verify user is active
        const [user] = await sql`SELECT id FROM users WHERE id = ${updated.created_by} AND account_status = 'active'`;
        if (user) {
          const eventType = status === 'approved' ? 'EXPENSE_APPROVED' : 
                            status === 'paid' ? 'EXPENSE_PAID' : 'EXPENSE_REJECTED';
          const message = status === 'approved' ? 'Your expense has been approved.' :
                          status === 'paid' ? 'Your expense has been paid.' :
                          'Your expense has been rejected.';

          await sendNotificationToUsers(
            [updated.created_by],
            eventType,
            { message }
          );
        }
      }
    } catch (err) {

    }
  })();

  return sendSuccess(res, req.schoolId, { message: `Expense ${status}`, expense: updated });
}));

export default router;