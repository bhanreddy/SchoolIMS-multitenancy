import express from 'express';
import sql from '../db.js';
import { requirePermission, requireAuth } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { translateFields } from '../services/geminiTranslator.js';

const router = express.Router();

/**
 * GET /complaints
 * List complaints (own complaints for regular users, all for admin)
 */
router.get('/', requirePermission('complaints.view'), asyncHandler(async (req, res) => {
  const { status, category, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const isAdmin = req.user?.roles.includes('admin');

  let complaints;
  if (isAdmin) {
    complaints = await sql`
      SELECT 
        c.id, c.ticket_no, c.title, c.title_te, c.category, c.priority, c.status,
        c.created_at, c.resolved_at,
        raiser.display_name as raised_by_name,
        assignee.display_name as assigned_to_name
      FROM complaints c
      JOIN users u ON c.raised_by = u.id
      JOIN persons raiser ON u.person_id = raiser.id
      LEFT JOIN users au ON c.assigned_to = au.id
      LEFT JOIN persons assignee ON au.person_id = assignee.id
      WHERE c.school_id = ${req.schoolId}
        ${status ? sql`AND c.status = ${status}` : sql``}
        ${category ? sql`AND c.category = ${category}` : sql``}
      ORDER BY c.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    // Regular users see complaints they raised OR complaints raised FOR them (if they are a student)
    // We need to find if this user is a student
    const [studentProfile] = await sql`
            SELECT s.id 
            FROM students s 
            JOIN persons p ON s.person_id = p.id 
            JOIN users u ON p.id = u.person_id 
            WHERE u.id = ${req.user.internal_id}
        `;

    const studentId = studentProfile?.id;

    complaints = await sql`
      SELECT 
        c.id, c.ticket_no, c.title, c.title_te, c.description_te, c.category, c.priority, c.status,
        c.created_at, c.resolved_at,
        raiser.display_name as raised_by_name
      FROM complaints c
      JOIN users u ON c.raised_by = u.id
      JOIN persons raiser ON u.person_id = raiser.id
      WHERE c.school_id = ${req.schoolId}
        AND (c.raised_by = ${req.user.internal_id} ${studentId ? sql`OR c.raised_for_student_id = ${studentId}` : sql``})
        ${status ? sql`AND c.status = ${status}` : sql``}
      ORDER BY c.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return sendSuccess(res, req.schoolId, complaints);
}));

/**
 * GET /complaints/:id
 * Get complaint details
 */
router.get('/:id', requirePermission('complaints.view'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [complaint] = await sql`
    SELECT 
      c.*,
      raiser.display_name as raised_by_name,
      assignee.display_name as assigned_to_name,
      resolver.display_name as resolved_by_name,
      s.admission_no as student_admission_no,
      sp.display_name as student_name
    FROM complaints c
    JOIN users u ON c.raised_by = u.id
    JOIN persons raiser ON u.person_id = raiser.id
    LEFT JOIN users au ON c.assigned_to = au.id
    LEFT JOIN persons assignee ON au.person_id = assignee.id
    LEFT JOIN users ru ON c.resolved_by = ru.id
    LEFT JOIN persons resolver ON ru.person_id = resolver.id
    LEFT JOIN students s ON c.raised_for_student_id = s.id
    LEFT JOIN persons sp ON s.person_id = sp.id
    WHERE c.id = ${id} AND c.school_id = ${req.schoolId}
  `;

  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Check access
  const isAdmin = req.user?.roles.includes('admin');
  if (!isAdmin && complaint.raised_by !== req.user.internal_id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  return sendSuccess(res, req.schoolId, complaint);
}));

/**
 * POST /complaints
 * Create a new complaint
 */
router.post('/', requirePermission('complaints.create'), asyncHandler(async (req, res) => {
  const { title, description, category, priority, raised_for_student_id } = req.body;

  if (!title || !description || !raised_for_student_id) {
    return res.status(400).json({ error: 'Title, description, and student ID are required' });
  }

  // Strict Authorization: Only the Class Teacher of the student's ACTIVE class can raise a complaint
  const isAdmin = req.user?.roles.includes('admin');

  if (!isAdmin) {
    // 1. Get the current active class section of the student (B2: school_id scoped)
    const [enrollment] = await sql`
        SELECT cs.class_teacher_id 
        FROM student_enrollments se
        JOIN class_sections cs ON se.class_section_id = cs.id AND cs.school_id = ${req.schoolId}
        WHERE se.student_id = ${raised_for_student_id} 
          AND se.school_id = ${req.schoolId}
          AND se.status = 'active'
          AND se.deleted_at IS NULL
        LIMIT 1
    `;

    if (!enrollment) {
      return res.status(400).json({ error: 'Student is not enrolled in any active class' });
    }

    // 2. Get the current user's Staff ID (B2: school_id scoped)
    const [staff] = await sql`SELECT id FROM staff WHERE person_id = ${req.user.person_id} AND school_id = ${req.schoolId} LIMIT 1`;

    // 3. Verify Match
    if (!staff || enrollment.class_teacher_id !== staff.id) {
      return res.status(403).json({ error: 'Only the Class Teacher can raise complaints for this student' });
    }
  }

  // Translate text fields
  let title_te = null;
  let description_te = null;
  try {
    const te = await translateFields({ title, description });
    title_te = te.title || null;
    description_te = te.description || null;
  } catch (e) {

  }

  const [complaint] = await sql`
    INSERT INTO complaints (school_id, title, title_te, description, description_te, category, priority, raised_by, raised_for_student_id)
    VALUES (${req.schoolId}, ${title}, ${title_te}, ${description}, ${description_te}, ${category || 'other'}, ${priority || 'medium'}, 
            ${req.user.internal_id}, ${raised_for_student_id})
    RETURNING *
  `;

  // Send Notification to Student + Parents (Async)
  (async () => {
    try {
      const { sendNotificationToUsers } = await import('../services/notificationService.js');

      const recipients = await sql`
        SELECT u.id as user_id
        FROM users u
        JOIN parents p ON u.person_id = p.person_id
        JOIN student_parents sp ON p.id = sp.parent_id
        WHERE sp.student_id = ${raised_for_student_id}
          AND u.account_status = 'active'
        UNION
        SELECT u.id as user_id
        FROM users u
        JOIN students s ON u.person_id = s.person_id
        WHERE s.id = ${raised_for_student_id}
          AND u.account_status = 'active'
      `;

      if (recipients.length > 0) {
        const userIds = recipients.map((r) => r.user_id);

        await sendNotificationToUsers(
          userIds,
          'COMPLAINT_CREATED',
          { message: title }
        );
      }
    } catch (err) {

    }
  })();

  return sendSuccess(res, req.schoolId, { message: 'Complaint submitted', complaint }, 201);
}));

/**
 * PUT /complaints/:id
 * Update complaint (status, assignment, resolution)
 */
// C1 FIX: Add requireAuth middleware — this route had no auth at all
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, priority, assigned_to, resolution } = req.body;

  // C2 FIX: Add school_id filter to complaint ownership check
  const [existing] = await sql`SELECT raised_by, status FROM complaints WHERE id = ${id} AND school_id = ${req.schoolId}`;
  if (!existing) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  const isAdmin = req.user?.roles.includes('admin');
  const isOwner = existing.raised_by === req.user.internal_id;

  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Only admin can change status to resolved/closed or assign
  if (!isAdmin && (status === 'resolved' || status === 'closed' || assigned_to)) {
    return res.status(403).json({ error: 'Only admin can resolve or assign complaints' });
  }

  let resolved_by = null;
  let resolved_at = null;
  if (status === 'resolved' || status === 'closed') {
    resolved_by = req.user.internal_id;
    resolved_at = sql`NOW()`;
  }

  // Translate resolution if provided
  let sql_resolution_te = sql`resolution_te`;
  if (resolution) {
    try {
      const te = await translateFields({ resolution });
      if (te.resolution) sql_resolution_te = sql`${te.resolution}`;
    } catch (e) {

    }
  }

  const [updated] = await sql`
    UPDATE complaints
    SET 
      status = COALESCE(${status ?? null}, status),
      priority = COALESCE(${priority ?? null}, priority),
      assigned_to = COALESCE(${assigned_to ?? null}, assigned_to),
      resolution = COALESCE(${resolution ?? null}, resolution),
      resolution_te = ${sql_resolution_te},
      resolved_by = COALESCE(${resolved_by ?? null}, resolved_by),
      resolved_at = ${status === 'resolved' || status === 'closed' ? sql`NOW()` : sql`resolved_at`}
    WHERE id = ${id} AND school_id = ${req.schoolId}
    RETURNING *
  `;

  // Send COMPLAINT_RESPONSE notification to student + parents when resolved/closed
  if (status === 'resolved' || status === 'closed') {
    (async () => {
      try {
        const { sendNotificationToUsers } = await import('../services/notificationService.js');

        const recipients = await sql`
          SELECT u.id as user_id FROM users u
          JOIN students s ON u.person_id = s.person_id
          WHERE s.id = ${updated.raised_for_student_id}
            AND u.account_status = 'active'
          UNION
          SELECT u.id as user_id FROM users u
          JOIN parents p ON u.person_id = p.person_id
          JOIN student_parents sp ON p.id = sp.parent_id
          WHERE sp.student_id = ${updated.raised_for_student_id}
            AND u.account_status = 'active'
        `;

        if (recipients.length > 0) {
          await sendNotificationToUsers(
            recipients.map((r) => r.user_id),
            'COMPLAINT_RESPONSE',
            { message: `Complaint "${updated.title}" has been ${status}.` }
          );
        }
      } catch (err) {

      }
    })();
  }

  return sendSuccess(res, req.schoolId, { message: 'Complaint updated', complaint: updated });
}));

/**
 * DELETE /complaints/:id
 * Delete complaint (owner or admin only)
 */
// DELETE endpoint removed as per audit requirements
// router.delete('/:id', ...)

export default router;