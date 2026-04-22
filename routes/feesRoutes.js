import express from 'express';
import sql from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendNotificationToUsers } from '../services/notificationService.js';
import { translateFields } from '../services/geminiTranslator.js';

const router = express.Router();

// ============== FEE TYPES ==============

/**
 * GET /fees/types
 * List all fee types
 */
router.get('/types', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const types = await sql`
    SELECT id, name, name_te, code, description, description_te, is_recurring, is_optional
    FROM fee_types
    WHERE school_id = ${req.schoolId}
    ORDER BY name
  `;
  return sendSuccess(res, req.schoolId, types);
}));

/**
 * POST /fees/types
 * Create a new fee type
 */
router.post('/types', requirePermission('fees.manage'), asyncHandler(async (req, res) => {
  const { name, name_te, code, description, description_te, is_recurring, is_optional } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  // Check uniqueness within this school
  const [existing] = await sql`
    SELECT id FROM fee_types WHERE LOWER(name) = ${name.toLowerCase()} AND school_id = ${req.schoolId}
  `;
  if (existing) {
    return res.status(409).json({ error: `Fee type "${name}" already exists` });
  }

  const feeCode = code || name.toUpperCase().replace(/\s+/g, '_').slice(0, 20);

  // Auto-translate if not provided
  let finalNameTe = name_te ?? null;
  let finalDescTe = description_te ?? null;
  if (!finalNameTe || (!finalDescTe && description)) {
    try {
      const fields = {};
      if (!finalNameTe && name) fields.name = name;
      if (!finalDescTe && description) fields.description = description;
      const te = await translateFields(fields);
      if (!finalNameTe) finalNameTe = te.name || null;
      if (!finalDescTe) finalDescTe = te.description || null;
    } catch (e) {}
  }

  const [feeType] = await sql`
    INSERT INTO fee_types (school_id, name, name_te, code, description, description_te, is_recurring, is_optional)
    VALUES (${req.schoolId}, ${name}, ${finalNameTe}, ${feeCode}, ${description || null}, ${finalDescTe}, ${is_recurring || false}, ${is_optional || false})
    RETURNING id, name, name_te, code, description, description_te, is_recurring, is_optional
  `;

  return sendSuccess(res, req.schoolId, feeType, 201);
}));

// ============== FEE STRUCTURE ==============

/**
 * GET /fees/structure
 * Get fee structure (filter by class_id, academic_year_id)
 */
router.get('/structure', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { class_id, academic_year_id } = req.query;

  let structures;
  if (class_id && academic_year_id) {
    structures = await sql`
      SELECT 
        fs.id, fs.amount, fs.due_date, fs.frequency,
        ft.name as fee_type, ft.name_te as fee_type_te, ft.code as fee_code, ft.is_optional,
        c.name as class_name, ay.code as academic_year
      FROM fee_structures fs
      JOIN fee_types ft ON fs.fee_type_id = ft.id
      JOIN classes c ON fs.class_id = c.id
      JOIN academic_years ay ON fs.academic_year_id = ay.id
      WHERE fs.class_id = ${class_id} AND fs.academic_year_id = ${academic_year_id}
        AND fs.school_id = ${req.schoolId}
      ORDER BY ft.name
    `;
  } else if (academic_year_id) {
    structures = await sql`
      SELECT 
        fs.id, fs.amount, fs.due_date, fs.frequency,
        ft.name as fee_type, ft.name_te as fee_type_te, ft.code as fee_code,
        c.name as class_name, c.id as class_id
      FROM fee_structures fs
      JOIN fee_types ft ON fs.fee_type_id = ft.id
      JOIN classes c ON fs.class_id = c.id
      WHERE fs.academic_year_id = ${academic_year_id}
        AND fs.school_id = ${req.schoolId}
      ORDER BY c.name, ft.name
    `;
  } else {
    // F1 FIX: Add school_id filter to unfiltered fee structure query
    structures = await sql`
      SELECT
        fs.id, fs.amount, fs.due_date, fs.frequency,
        ft.name as fee_type, ft.name_te as fee_type_te, c.name as class_name,
        ay.code as academic_year
      FROM fee_structures fs
      JOIN fee_types ft ON fs.fee_type_id = ft.id
      JOIN classes c ON fs.class_id = c.id
      JOIN academic_years ay ON fs.academic_year_id = ay.id
      WHERE fs.school_id = ${req.schoolId}
      ORDER BY ay.start_date DESC, c.name, ft.name
      LIMIT 100
    `;
  }

  return sendSuccess(res, req.schoolId, structures);
}));

/**
 * POST /fees/structure
 * Create fee structure for a class
 */
router.post('/structure', requirePermission('fees.manage'), asyncHandler(async (req, res) => {
  const { academic_year_id, class_id, fee_type_id, amount, due_date, frequency } = req.body;

  if (!academic_year_id || !class_id || !fee_type_id || !amount) {
    return res.status(400).json({ error: 'academic_year_id, class_id, fee_type_id, and amount are required' });
  }

  // Fix 6: Validate positive amount server-side (DB also has CHECK constraint)
  if (Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const [structure] = await sql`
    INSERT INTO fee_structures (school_id, academic_year_id, class_id, fee_type_id, amount, due_date, frequency)
    VALUES (${req.schoolId}, ${academic_year_id}, ${class_id}, ${fee_type_id}, ${amount}, ${due_date}, ${frequency || 'monthly'})
    RETURNING *
  `;

  return sendSuccess(res, req.schoolId, { message: 'Fee structure created', structure }, 201);
}));

/**
 * PUT /fees/structure/:id
 * Update fee structure
 */
router.put('/structure/:id', requirePermission('fees.manage'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, due_date, frequency } = req.body;

  // F2 FIX: Ownership check first
  const [existing] = await sql`SELECT id FROM fee_structures WHERE id = ${id} AND school_id = ${req.schoolId}`;
  if (!existing) {
    return res.status(404).json({ error: 'Fee structure not found' });
  }

  const [updated] = await sql`
    UPDATE fee_structures
    SET
      amount = COALESCE(${amount ?? null}, amount),
      due_date = COALESCE(${due_date ?? null}, due_date),
      frequency = COALESCE(${frequency ?? null}, frequency)
    WHERE id = ${id} AND school_id = ${req.schoolId}
    RETURNING *
  `;

  if (!updated) {
    return res.status(404).json({ error: 'Fee structure not found' });
  }

  return sendSuccess(res, req.schoolId, { message: 'Fee structure updated', structure: updated });
}));

// ============== STUDENT FEES ==============

/**
 * GET /fees/students/:studentId
 * Get fee details for a student
 */
router.get('/students/:studentId', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { academic_year_id, lastSyncedAt } = req.query;

  // Get student info
  const [student] = await sql`
    SELECT s.id, s.admission_no, p.display_name
    FROM students s
    JOIN persons p ON s.person_id = p.id
    WHERE s.id = ${studentId} AND s.deleted_at IS NULL AND s.school_id = ${req.schoolId}
  `;

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  // Get fees
  let fees;
  if (academic_year_id) {
    fees = await sql`
      SELECT 
        sf.id, sf.amount_due, sf.amount_paid, sf.discount, sf.status,
        sf.due_date, sf.period_month, sf.period_year,
        ft.name as fee_type, ft.name_te as fee_type_te, ft.code as fee_code
      FROM student_fees sf
      JOIN fee_structures fs ON sf.fee_structure_id = fs.id
      JOIN fee_types ft ON fs.fee_type_id = ft.id
      WHERE sf.student_id = ${studentId}
        AND fs.academic_year_id = ${academic_year_id}
        ${lastSyncedAt ? sql`AND (sf.updated_at >= ${lastSyncedAt} OR sf.created_at >= ${lastSyncedAt})` : sql``}
      ORDER BY sf.due_date DESC
    `;
  } else {
    fees = await sql`
      SELECT 
        sf.id, sf.amount_due, sf.amount_paid, sf.discount, sf.status,
        sf.due_date, sf.period_month, sf.period_year,
        ft.name as fee_type, ft.name_te as fee_type_te, ay.code as academic_year
      FROM student_fees sf
      JOIN fee_structures fs ON sf.fee_structure_id = fs.id
      JOIN fee_types ft ON fs.fee_type_id = ft.id
      JOIN academic_years ay ON fs.academic_year_id = ay.id
      WHERE sf.student_id = ${studentId}
        ${lastSyncedAt ? sql`AND (sf.updated_at >= ${lastSyncedAt} OR sf.created_at >= ${lastSyncedAt})` : sql``}
      ORDER BY sf.due_date DESC
      LIMIT 50
    `;
  }

  // Calculate summary (Fix 5: filter deleted_at IS NULL for deterministic analytics)
  const summary = await sql`
    SELECT 
      COALESCE(SUM(amount_due - discount), 0) as total_due,
      COALESCE(SUM(amount_paid), 0) as total_paid,
      COALESCE(SUM(amount_due - discount - amount_paid), 0) as balance
    FROM student_fees
    WHERE student_id = ${studentId}
      AND deleted_at IS NULL
  `;

  return sendSuccess(res, req.schoolId, {
    student,
    summary: summary[0],
    fees
  });
}));

/**
 * POST /fees/collect
 * Collect fee payment
 */
/**
 * POST /fees/collect
 * Collect fee payment
 */
router.post('/collect', requirePermission('fees.collect'), asyncHandler(async (req, res) => {
  const { student_fee_id, amount, payment_method, transaction_ref, remarks } = req.body;

  if (!student_fee_id || !amount || !payment_method) {
    return res.status(400).json({ error: 'student_fee_id, amount, and payment_method are required' });
  }

  const validMethods = ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'online'];
  if (!validMethods.includes(payment_method)) {
    return res.status(400).json({ error: `payment_method must be one of: ${validMethods.join(', ')}` });
  }

  try {
    const transaction = await processFeeTransaction({
      student_fee_id,
      amount,
      payment_method,
      transaction_ref,
      remarks,
      user: req.user,
      schoolId: req.schoolId
    });
    return sendSuccess(res, req.schoolId, { message: 'Payment collected successfully', transaction }, 201);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
}));

// ... [Skipping other routes] ...

/**
 * POST /transactions
 * Record a transaction (alternative to /collect)
 */
router.post('/transactions', requirePermission('fees.collect'), asyncHandler(async (req, res) => {
  const { student_fee_id, amount, payment_method, transaction_ref, remarks } = req.body;

  if (!student_fee_id || !amount || !payment_method) {
    return res.status(400).json({ error: 'student_fee_id, amount, and payment_method are required' });
  }

  const validMethods = ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'online'];
  if (!validMethods.includes(payment_method)) {
    return res.status(400).json({ error: `payment_method must be one of: ${validMethods.join(', ')}` });
  }

  try {
    const transaction = await processFeeTransaction({
      student_fee_id,
      amount,
      payment_method,
      transaction_ref,
      remarks,
      user: req.user,
      schoolId: req.schoolId
    });
    return sendSuccess(res, req.schoolId, { message: 'Transaction recorded', transaction }, 201);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
}));

// ... [Skipping to end] ... 

/**
 * Shared helper to process fee transactions
 */
async function processFeeTransaction({ student_fee_id, amount, payment_method, transaction_ref, remarks, user, schoolId }) {
  // Validate Amount
  const parsedAmount = Number(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    const err = new Error('Amount must be a positive number');
    err.status = 400;
    throw err;
  }

  // Fix 3: Mandatory idempotency key
  if (!transaction_ref) {
    const err = new Error('transaction_ref is required. Generate a UUID for cash payments.');
    err.status = 400;
    throw err;
  }

  // Execute in a transaction to prevent race conditions
  const { transaction, fee } = await sql.begin(async (tx) => {
    // Idempotency Check: Prevent duplicate transaction refs
    if (transaction_ref) {
      const [existing] = await tx`
        SELECT id FROM fee_transactions WHERE transaction_ref = ${transaction_ref}
      `;
      if (existing) {
        const err = new Error(`Transaction reference '${transaction_ref}' already exists`);
        err.status = 409;
        throw err;
      }
    }

    // F3 FIX: Add school_id filter to student_fees SELECT
    // LOCK the row to prevent concurrent updates
    const [fee] = await tx`
      SELECT id, amount_due, amount_paid, discount, student_id
      FROM student_fees
      WHERE id = ${student_fee_id}
        AND school_id = ${schoolId}
      FOR UPDATE
    `;

    if (!fee) {
      const err = new Error('Student fee not found');
      err.status = 404;
      throw err;
    }

    const remaining = fee.amount_due - fee.discount - fee.amount_paid;
    if (parsedAmount > remaining) {
      const err = new Error(`Amount exceeds remaining balance of ${remaining}`);
      err.status = 400;
      throw err;
    }

    const [transaction] = await tx`
      INSERT INTO fee_transactions (student_fee_id, amount, payment_method, transaction_ref, received_by, remarks, school_id)
      VALUES (
        ${student_fee_id}, 
        ${parsedAmount}, 
        ${payment_method}, 
        ${transaction_ref || null}, 
        ${user?.internal_id || null}, 
        ${remarks || null},
        ${schoolId}
      )
      RETURNING *
    `;

    const [updatedFee] = await tx`
      UPDATE student_fees
      SET updated_at = NOW()
      WHERE id = ${student_fee_id}
        AND school_id = ${schoolId}
      RETURNING *
    `;

    if (!updatedFee) {
      const err = new Error('Student fee not found');
      err.status = 404;
      throw err;
    }

    return { transaction, fee: updatedFee };
  });

  // Send Notification to Student + Parents (Async) - Outside transaction
  (async () => {
    try {
      const recipients = await sql`
        SELECT u.id as user_id FROM users u
        JOIN students s ON u.person_id = s.person_id
        WHERE s.id = ${fee.student_id}
          AND s.school_id = ${schoolId}
          AND u.school_id = ${schoolId}
          AND u.account_status = 'active'
        UNION
        SELECT u.id as user_id FROM users u
        JOIN parents p ON u.person_id = p.person_id AND p.school_id = ${schoolId}
        JOIN student_parents sp ON p.id = sp.parent_id AND sp.school_id = ${schoolId}
        WHERE sp.student_id = ${fee.student_id}
          AND u.school_id = ${schoolId}
          AND u.account_status = 'active'
      `;

      if (recipients.length > 0) {
        await sendNotificationToUsers(
          recipients.map((r) => r.user_id),
          'FEE_COLLECTED',
          { message: 'Your fee payment has been successfully recorded.' }
        );
      }
    } catch (err) {

    }
  })();

  // Return enriched transaction
  const [enrichedTransaction] = await sql`
    SELECT 
      t.*,
      p.display_name as student_name,
      s.admission_no,
      ft.name as fee_type, ft.name_te as fee_type_te,
      ay.code as academic_year
    FROM fee_transactions t
    JOIN student_fees sf ON t.student_fee_id = sf.id
    JOIN students s ON sf.student_id = s.id
    JOIN persons p ON s.person_id = p.id
    JOIN fee_structures fs ON sf.fee_structure_id = fs.id
    JOIN fee_types ft ON fs.fee_type_id = ft.id
    JOIN academic_years ay ON fs.academic_year_id = ay.id
    WHERE t.id = ${transaction.id}
      AND s.school_id = ${schoolId}
  `;

  return enrichedTransaction;
}

/**
 * GET /fees/summaries
 * Get comprehensive fee summary for all students (or filtered)
 */
router.get('/summaries', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { class_id, academic_year_id, search, page = 1, limit = 50 } = req.query;
  const safeLimit = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const offset = (pageNum - 1) * safeLimit;

  const baseWhere = sql`s.deleted_at IS NULL AND s.school_id = ${req.schoolId}`;
  const classFilter = class_id ? sql`AND c.id = ${class_id}` : sql``;
  const searchFilter = search
    ? sql`AND (p.display_name ILIKE ${'%' + search + '%'} OR s.admission_no ILIKE ${'%' + search + '%'})`
    : sql``;
  const ayFilter = academic_year_id
    ? sql`AND sf.fee_structure_id IN (SELECT id FROM fee_structures WHERE academic_year_id = ${academic_year_id})`
    : sql``;

  const [summaries, [countResult]] = await Promise.all([
    sql`
    SELECT 
      s.id as student_id, 
      s.admission_no,
      p.display_name as student_name,
      c.name as class_name,
      COALESCE(SUM(sf.amount_due), 0) as total_amount,
      COALESCE(SUM(sf.amount_paid), 0) as paid_amount,
      COALESCE(SUM(sf.amount_due - sf.amount_paid - sf.discount), 0) as due_amount,
      CASE 
        WHEN SUM(sf.amount_due - sf.amount_paid - sf.discount) <= 0 THEN 'Paid'
        WHEN SUM(sf.amount_paid) > 0 THEN 'Partial'
        ELSE 'Pending'
      END as status
    FROM students s
    JOIN persons p ON s.person_id = p.id
    JOIN student_enrollments se ON s.id = se.student_id AND se.status = 'active'
    JOIN class_sections cs ON se.class_section_id = cs.id
    JOIN classes c ON cs.class_id = c.id
    LEFT JOIN student_fees sf ON s.id = sf.student_id 
      ${ayFilter}
    WHERE ${baseWhere}
    ${classFilter}
    ${searchFilter}
    GROUP BY s.id, s.admission_no, p.display_name, c.name
    ORDER BY p.display_name
    LIMIT ${safeLimit} OFFSET ${offset}
  `,
    sql`
    SELECT COUNT(*)::int as total FROM (
      SELECT s.id
      FROM students s
      JOIN persons p ON s.person_id = p.id
      JOIN student_enrollments se ON s.id = se.student_id AND se.status = 'active'
      JOIN class_sections cs ON se.class_section_id = cs.id
      JOIN classes c ON cs.class_id = c.id
      LEFT JOIN student_fees sf ON s.id = sf.student_id 
        ${ayFilter}
      WHERE ${baseWhere}
      ${classFilter}
      ${searchFilter}
      GROUP BY s.id, s.admission_no, p.display_name, c.name
    ) t
  `,
  ]);

  return sendSuccess(res, req.schoolId, {
    data: summaries,
    meta: {
      total: countResult.total,
      page: pageNum,
      limit: safeLimit,
      total_pages: Math.ceil(countResult.total / safeLimit) || 1,
    },
  });
}));

/**
 * GET /fees/defaulters
 * Get list of fee defaulters
 */
router.get('/defaulters', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { class_id, academic_year_id, min_days_overdue = 0, page = 1, limit = 100 } = req.query;
  const safePage = Math.max(1, parseInt(String(page), 10) || 1);
  const safeLimit = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 100));
  const offset = (safePage - 1) * safeLimit;

  let defaulters = await sql`
    SELECT 
      s.id as student_id, s.admission_no,
      p.display_name as student_name,
      c.name as class_name, sec.name as section_name,
      SUM(sf.amount_due - sf.discount - sf.amount_paid) as total_due,
      MIN(sf.due_date) as oldest_due_date,
      CURRENT_DATE - MIN(sf.due_date) as days_overdue
    FROM student_fees sf
    JOIN students s ON sf.student_id = s.id
    JOIN persons p ON s.person_id = p.id
    JOIN fee_structures fs ON sf.fee_structure_id = fs.id
    JOIN student_enrollments se ON s.id = se.student_id AND se.status = 'active'
    JOIN class_sections cs ON se.class_section_id = cs.id
    JOIN classes c ON cs.class_id = c.id
    JOIN sections sec ON cs.section_id = sec.id
    WHERE sf.status IN ('pending', 'partial', 'overdue')
      AND sf.due_date < CURRENT_DATE
      AND s.deleted_at IS NULL
      AND s.school_id = ${req.schoolId}
      ${academic_year_id ? sql`AND fs.academic_year_id = ${academic_year_id}` : sql``}
      ${class_id ? sql`AND c.id = ${class_id}` : sql``}
    GROUP BY s.id, s.admission_no, p.display_name, c.name, sec.name
    HAVING CURRENT_DATE - MIN(sf.due_date) >= ${min_days_overdue}
    ORDER BY total_due DESC
    LIMIT ${safeLimit} OFFSET ${offset}
  `;

  return sendSuccess(res, req.schoolId, defaulters);
}));

/**
 * GET /fees/receipts
 * List receipts
 */
router.get('/receipts', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { student_id, from_date, to_date, page = 1, limit = 50 } = req.query;
  const safeLimit = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const offset = (pageNum - 1) * safeLimit;

  let receipts;
  if (student_id) {
    receipts = await sql`
      SELECT 
        r.id, r.receipt_no, r.total_amount, r.issued_at, r.remarks,
        s.admission_no, p.display_name as student_name,
        issuer.display_name as issued_by_name
      FROM receipts r
      JOIN students s ON r.student_id = s.id AND s.school_id = ${req.schoolId}
      JOIN persons p ON s.person_id = p.id
      LEFT JOIN users u ON r.issued_by = u.id
      LEFT JOIN persons issuer ON u.person_id = issuer.id
      WHERE r.student_id = ${student_id}
        AND r.school_id = ${req.schoolId}
      ORDER BY r.issued_at DESC
      LIMIT ${safeLimit} OFFSET ${offset}
    `;
  } else {
    receipts = await sql`
      SELECT 
        r.id, r.receipt_no, r.total_amount, r.issued_at,
        s.admission_no, p.display_name as student_name,
        x.payment_method,
        x.fee_type
      FROM receipts r
      JOIN students s ON r.student_id = s.id AND s.school_id = ${req.schoolId}
      JOIN persons p ON s.person_id = p.id
      LEFT JOIN LATERAL (
        SELECT t.payment_method, ft.name as fee_type
        FROM receipt_items ri
        JOIN fee_transactions t ON ri.fee_transaction_id = t.id
        JOIN student_fees sf ON t.student_fee_id = sf.id AND sf.school_id = ${req.schoolId}
        JOIN fee_structures fs ON sf.fee_structure_id = fs.id
        JOIN fee_types ft ON fs.fee_type_id = ft.id
        WHERE ri.receipt_id = r.id
        ORDER BY t.paid_at DESC NULLS LAST
        LIMIT 1
      ) x ON true
      WHERE r.school_id = ${req.schoolId}
        ${from_date ? sql`AND r.issued_at >= ${from_date}` : sql``}
        ${to_date ? sql`AND r.issued_at <= ${to_date}` : sql``}
      ORDER BY r.issued_at DESC
      LIMIT ${safeLimit} OFFSET ${offset}
    `;
  }

  return sendSuccess(res, req.schoolId, receipts);
}));

/**
 * GET /fees/receipts/:id
 * Get receipt details
 */
router.get('/receipts/:id', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [receipt] = await sql`
    SELECT 
      r.id, r.receipt_no, r.student_id, r.total_amount,
      r.issued_at, r.issued_by, r.remarks, r.created_at,
      s.admission_no, p.display_name as student_name,
      issuer.display_name as issued_by_name
    FROM receipts r
    JOIN students s ON r.student_id = s.id
    JOIN persons p ON s.person_id = p.id
    LEFT JOIN users u ON r.issued_by = u.id
    LEFT JOIN persons issuer ON u.person_id = issuer.id
    WHERE r.id = ${id} AND r.school_id = ${req.schoolId}
  `;

  if (!receipt) {
    return res.status(404).json({ error: 'Receipt not found' });
  }

  // Get receipt items
  const items = await sql`
    SELECT 
      ri.amount,
      ft.name as fee_type,
      t.payment_method, t.transaction_ref, t.paid_at
    FROM receipt_items ri
    JOIN fee_transactions t ON ri.fee_transaction_id = t.id
    JOIN student_fees sf ON t.student_fee_id = sf.id
    JOIN fee_structures fs ON sf.fee_structure_id = fs.id
    JOIN fee_types ft ON fs.fee_type_id = ft.id
    WHERE ri.receipt_id = ${id}
  `;

  return sendSuccess(res, req.schoolId, { ...receipt, items });
}));

/**
 * GET /fees/transactions
 * List fee transactions
 */
router.get('/transactions', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { from_date, to_date, payment_method, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  const transactions = await sql`
    SELECT 
      t.id, t.amount, t.payment_method, t.transaction_ref, t.paid_at, t.remarks,
      s.admission_no, p.display_name as student_name,
      ft.name as fee_type, ft.name_te as fee_type_te, ay.code as academic_year,
      receiver.display_name as received_by
    FROM fee_transactions t
    JOIN student_fees sf ON t.student_fee_id = sf.id
    JOIN students s ON sf.student_id = s.id
    JOIN persons p ON s.person_id = p.id
    JOIN fee_structures fs ON sf.fee_structure_id = fs.id
    JOIN fee_types ft ON fs.fee_type_id = ft.id
    LEFT JOIN academic_years ay ON fs.academic_year_id = ay.id
    LEFT JOIN users u ON t.received_by = u.id
    LEFT JOIN persons receiver ON u.person_id = receiver.id
    WHERE s.school_id = ${req.schoolId}
      ${from_date ? sql`AND t.paid_at >= ${from_date}` : sql``}
      ${to_date ? sql`AND t.paid_at <= ${to_date}` : sql``}
      ${payment_method ? sql`AND t.payment_method = ${payment_method}` : sql``}
    ORDER BY t.paid_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return sendSuccess(res, req.schoolId, transactions);
}));

// (Fix 7: Duplicate POST /transactions route removed — single handler at L236)

/**
 * GET /fees/collection-summary
 * Get daily/monthly collection summary
 */
router.get('/collection-summary', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { date, from_date, to_date, group_by = 'day' } = req.query;

  if (date) {
    // Single day summary — F7 FIX: Add school_id filter
    const summary = await sql`
      SELECT
        payment_method,
        COUNT(*) as transaction_count,
        SUM(amount) as total_amount
      FROM fee_transactions
      WHERE DATE(paid_at) = ${date}
        AND school_id = ${req.schoolId}
      GROUP BY payment_method
    `;

    const total = await sql`
      SELECT
        COUNT(*) as total_transactions,
        COALESCE(SUM(amount), 0) as total_collected
      FROM fee_transactions
      WHERE DATE(paid_at) = ${date}
        AND school_id = ${req.schoolId}
    `;

    return sendSuccess(res, req.schoolId, {
      date,
      by_payment_method: summary,
      ...total[0]
    });
  } else if (from_date && to_date) {
    // Range summary
    let summary;
    if (group_by === 'month') {
      summary = await sql`
        SELECT
          DATE_TRUNC('month', paid_at) as period,
          COUNT(*) as transaction_count,
          SUM(amount) as total_amount
        FROM fee_transactions
        WHERE paid_at BETWEEN ${from_date} AND ${to_date}
          AND school_id = ${req.schoolId}
        GROUP BY DATE_TRUNC('month', paid_at)
        ORDER BY period
      `;
    } else {
      summary = await sql`
        SELECT
          DATE(paid_at) as period,
          COUNT(*) as transaction_count,
          SUM(amount) as total_amount
        FROM fee_transactions
        WHERE paid_at BETWEEN ${from_date} AND ${to_date}
          AND school_id = ${req.schoolId}
        GROUP BY DATE(paid_at)
        ORDER BY period
      `;
    }

    return sendSuccess(res, req.schoolId, summary);
  } else {
    // Today's summary by default — F7 FIX: Add school_id filter
    const today = new Date().toISOString().split('T')[0];
    const summary = await sql`
      SELECT
        COUNT(*) as total_transactions,
        COALESCE(SUM(amount), 0) as total_collected
      FROM fee_transactions
      WHERE DATE(paid_at) = ${today}
        AND school_id = ${req.schoolId}
    `;

    return sendSuccess(res, req.schoolId, { date: today, ...summary[0] });
  }
}));

/**
 * GET /fees/dashboard-stats
 * Get consolidated stats for dashboard
 */
// Fix 4: Protected with requirePermission
router.get('/dashboard-stats', requirePermission('fees.view'), asyncHandler(async (req, res) => {

  const [
    todayStats,
    monthlyStats,
    pendingStats,
    defaulterCount,
    totalCollected,
    recentTransactions,
  ] = await Promise.all([
    sql`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM fee_transactions
      WHERE paid_at::date = CURRENT_DATE
        AND school_id = ${req.schoolId}
  `,
    sql`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM fee_transactions
      WHERE date_trunc('month', paid_at) = date_trunc('month', CURRENT_DATE)
        AND school_id = ${req.schoolId}
  `,
    sql`
      SELECT COALESCE(SUM(amount_due - amount_paid - discount), 0) as total
      FROM student_fees
      WHERE status IN ('pending', 'partial', 'overdue')
        AND deleted_at IS NULL
        AND school_id = ${req.schoolId}
  `,
    sql`
      SELECT COUNT(DISTINCT student_id) as count
      FROM student_fees
      WHERE status IN ('pending', 'partial', 'overdue')
        AND due_date < CURRENT_DATE
        AND deleted_at IS NULL
        AND school_id = ${req.schoolId}
  `,
    sql`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM fee_transactions
      WHERE school_id = ${req.schoolId}
  `,
    sql`
      SELECT
          ft.id,
          ft.amount,
          ft.paid_at as collected_at,
          ft.payment_method,
          p.display_name as student_name,
          c.name as class_name,
          ftype.name as fee_type, ftype.name_te as fee_type_te
      FROM fee_transactions ft
      JOIN student_fees sf ON ft.student_fee_id = sf.id
      JOIN students s ON sf.student_id = s.id
      JOIN persons p ON s.person_id = p.id
      LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
      LEFT JOIN classes c ON fs.class_id = c.id
      LEFT JOIN fee_types ftype ON fs.fee_type_id = ftype.id
      WHERE ft.school_id = ${req.schoolId}
      ORDER BY ft.paid_at DESC
      LIMIT 5
  `,
  ]);

  const result = {
    today_collection: Number(todayStats[0]?.total || 0),
    monthly_collection: Number(monthlyStats[0]?.total || 0),
    collected_total: Number(totalCollected[0]?.total || 0),
    pending_dues: Number(pendingStats[0]?.total || 0),
    defaulter_count: Number(defaulterCount[0]?.count || 0),
    recent_transactions: recentTransactions || []
  };

  return sendSuccess(res, req.schoolId, result);
}));

/**
 * POST /fees/adjust
 * Apply an adjustment (waiver/discount) to a student fee
 */
// Fix 1: Atomic /adjust with transaction + row lock
router.post('/adjust', requirePermission('fees.manage'), asyncHandler(async (req, res) => {
  const { student_fee_id, amount, reason } = req.body;

  if (!student_fee_id || amount === undefined || !reason) {
    return res.status(400).json({ error: 'student_fee_id, amount, and reason are required' });
  }

  const parsedAmount = Number(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const updated = await sql.begin(async (tx) => {
    // F9 FIX: Add school_id filter to student_fees lock query
    const [fee] = await tx`
      SELECT id, amount_due, amount_paid, discount
      FROM student_fees
      WHERE id = ${student_fee_id}
        AND school_id = ${req.schoolId}
      FOR UPDATE
    `;

    if (!fee) {
      const err = new Error('Student fee not found');
      err.status = 404;
      throw err;
    }

    // Validate using locked (fresh) values
    const newTotalDiscount = Number(fee.discount) + parsedAmount;
    if (newTotalDiscount > Number(fee.amount_due)) {
      const err = new Error(`Total discount (${newTotalDiscount}) cannot exceed amount due (${fee.amount_due})`);
      err.status = 422;
      throw err;
    }

    // F9 FIX: Add school_id filter to student_fees UPDATE
    const [result] = await tx`
      UPDATE student_fees
      SET discount = discount + ${parsedAmount},
          updated_at = NOW()
      WHERE id = ${student_fee_id}
        AND school_id = ${req.schoolId}
      RETURNING id, amount_due, amount_paid, discount, status, updated_at
    `;

    return result;
  });

  return sendSuccess(res, req.schoolId, { message: 'Adjustment applied successfully', fee: updated });
}));

// ============== FEE REMINDERS ==============

/**
 * POST /fees/remind
 * Send fee reminders to students with pending fees
 */
router.post('/remind', requirePermission('fees.manage'), asyncHandler(async (req, res) => {
  const { target_group, class_id, message } = req.body;

  if (!target_group || target_group === 'class' && !class_id) {
    return res.status(400).json({ error: 'Valid target_group and class_id (if target is class) are required' });
  }

  // 1. Find students with pending fees
  let students;
  if (target_group === 'class') {
    students = await sql`
      SELECT DISTINCT s.id, s.person_id, p.display_name, u.id as user_id
      FROM student_fees sf
      JOIN students s ON sf.student_id = s.id
      JOIN persons p ON s.person_id = p.id
      JOIN student_enrollments se ON s.id = se.student_id AND se.status = 'active' AND se.school_id = ${req.schoolId}
      JOIN class_sections cs ON se.class_section_id = cs.id
      JOIN users u ON u.person_id = p.id AND u.school_id = ${req.schoolId}
      WHERE sf.status IN ('pending', 'partial', 'overdue')
        AND cs.class_id = ${class_id}
        AND s.deleted_at IS NULL
        AND s.school_id = ${req.schoolId}
    `;
  } else {
    // All Pending
    students = await sql`
      SELECT DISTINCT s.id, s.person_id, p.display_name, u.id as user_id
      FROM student_fees sf
      JOIN students s ON sf.student_id = s.id
      JOIN persons p ON s.person_id = p.id
      JOIN users u ON u.person_id = p.id AND u.school_id = ${req.schoolId}
      WHERE sf.status IN ('pending', 'partial', 'overdue')
        AND s.deleted_at IS NULL
        AND s.school_id = ${req.schoolId}
    `;
  }

  if (!students || students.length === 0) {
    return sendSuccess(res, req.schoolId, { message: 'No students found with pending fees', count: 0 });
  }

  // 2. Also fetch parent user IDs for the same students
  const studentIds = [...new Set(students.map((s) => s.id))];
  let parentUserIds = [];
  if (studentIds.length > 0) {
    const parentUsers = await sql`
      SELECT DISTINCT u.id as user_id
      FROM users u
      JOIN parents p ON u.person_id = p.person_id AND p.school_id = ${req.schoolId}
      JOIN student_parents sp ON p.id = sp.parent_id AND sp.school_id = ${req.schoolId}
      WHERE sp.student_id IN ${sql(studentIds)}
        AND u.school_id = ${req.schoolId}
        AND u.account_status = 'active'
    `;
    parentUserIds = parentUsers.map((p) => p.user_id);
  }

  // 3. Send Notifications (Students + Parents)
  try {
    const studentUserIds = students.map((s) => s.user_id);
    const userIds = [...new Set([...studentUserIds, ...parentUserIds])];
    const notificationMessage = message || "Your fee is pending. Please pay before the due date to avoid late fees.";

    if (userIds.length > 0) {
      await sendNotificationToUsers(
        userIds,
        'FEE_REMINDER',
        { message: notificationMessage }
      );
    }

    return sendSuccess(res, req.schoolId, { message: 'Fee reminders queued', student_count: students.length });

  } catch (err) {

    // Return success to client as process was initiated, but log the error
    return sendSuccess(res, req.schoolId, { message: 'Identified students but failed to send notifications', error: err.message });
  }
}));

export default router;