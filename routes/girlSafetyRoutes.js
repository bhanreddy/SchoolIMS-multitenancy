import express from 'express';
import sql from '../db.js';
import { requirePermission, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { translateFields } from '../services/geminiTranslator.js';

const router = express.Router();

/**
 * Utility: Generate a ticket number
 */
const generateTicketNumber = async () => {
  const today = new Date();
  const datePrefix = `GS-${today.getFullYear()}${(today.getMonth() + 1).toString().padStart(2, '0')}`;

  // Find the max sequence in the prefix today
  const rows = await sql`
        SELECT ticket_no 
        FROM public.girl_safety_complaints 
        WHERE ticket_no LIKE ${datePrefix + '%'} 
        ORDER BY ticket_no DESC 
        LIMIT 1
    `;

  let nextSeq = 1;
  if (rows.length > 0) {
    const lastTicket = rows[0].ticket_no;
    const lastSeq = parseInt(lastTicket.split('-')[2], 10);
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${datePrefix}-${nextSeq.toString().padStart(4, '0')}`;
};

/**
 * GET /girl-safety
 * List complaints (own complaints for student, assigned for admin)
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const isStudent = req.user?.roles.includes('student');

  let complaints;
  if (isStudent) {
    // Find the student's UUID
    const [studentProfile] = await sql`
            SELECT s.id 
            FROM students s 
            JOIN persons p ON s.person_id = p.id 
            JOIN users u ON p.id = u.person_id 
            WHERE u.id = ${req.user.internal_id}
        `;

    if (!studentProfile) {
      return res.status(403).json({ error: 'Student profile not found' });
    }

    complaints = await sql`
            SELECT 
                c.id, c.ticket_no, c.category, c.status,
                c.created_at, c.resolved_at, c.is_anonymous
            FROM public.girl_safety_complaints c
            WHERE c.student_id = ${studentProfile.id}
                ${status ? sql`AND c.status = ${status}` : sql``}
            ORDER BY c.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `;
  } else {
    // Admin or Lady Admin
    const isAdmin = req.user?.roles.includes('admin');
    if (!isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    complaints = await sql`
            SELECT 
                c.id, c.ticket_no, c.category, c.status,
                c.created_at, c.resolved_at, c.is_anonymous,
                CASE 
                    WHEN c.is_anonymous = true THEN 'Anonymous Student'
                    ELSE sp.display_name
                END as student_name
            FROM public.girl_safety_complaints c
            LEFT JOIN students s ON c.student_id = s.id
            LEFT JOIN persons sp ON s.person_id = sp.id
            WHERE c.assigned_to = ${req.user.internal_id}
                ${status ? sql`AND c.status = ${status}` : sql``}
            ORDER BY c.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `;
  }

  res.json(complaints);
}));

/**
 * POST /girl-safety
 * Create a new safety complaint
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { category, description, incident_date, attachments, is_anonymous } = req.body;

  if (!category || !description) {
    return res.status(400).json({ error: 'Category and description are required' });
  }

  // 1. Validate the user is a female student
  const [userProfile] = await sql`
        SELECT 
            u.id, s.id as student_id, g.name as gender, p.display_name
        FROM users u
        JOIN persons p ON u.person_id = p.id
        LEFT JOIN genders g ON p.gender_id = g.id
        LEFT JOIN students s ON p.id = s.person_id
        WHERE u.id = ${req.user.internal_id}
    `;

  if (!userProfile?.student_id) {
    return res.status(403).json({ error: 'Only students can access this feature' });
  }

  if (userProfile.gender !== 'Female') {
    // Silently return an error if somehow accessed
    return res.status(403).json({ error: 'Access restricted' });
  }

  // 2. Determine Assigned Admin (Routing Logic)
  // Priority 1: Lady Admin (role = admin, gender = Female, active)
  const activeLadyAdmins = await sql`
        SELECT u.id
        FROM users u
        JOIN persons p ON u.person_id = p.id
        JOIN genders g ON p.gender_id = g.id
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN roles r ON ur.role_id = r.id
        WHERE r.code = 'admin' 
          AND g.name = 'Female'
          AND u.account_status = 'active'
        LIMIT 1
    `;

  let assignedAdminId = null;
  if (activeLadyAdmins.length > 0) {
    assignedAdminId = activeLadyAdmins[0].id;
  } else {
    // Fallback Priority 2: Any active Admin
    const anyAdmins = await sql`
            SELECT u.id
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            WHERE r.code = 'admin' 
              AND u.account_status = 'active'
            LIMIT 1
        `;
    if (anyAdmins.length > 0) {
      assignedAdminId = anyAdmins[0].id;
    } else {

      // In extreme case where no admins exist (fallback to null)
    }}

  const ticketNo = await generateTicketNumber();

  // Telugu Translation (Optional Background)
  let description_te = null;
  try {
    const te = await translateFields({ description });
    description_te = te.description || null;
  } catch (e) {

  }

  const _attachments = attachments ? JSON.stringify(attachments) : '[]';

  const [complaint] = await sql`
        INSERT INTO public.girl_safety_complaints 
            (ticket_no, student_id, category, description, description_te, incident_date, attachments, is_anonymous, assigned_to)
        VALUES 
            (${ticketNo}, ${userProfile.student_id}, ${category}, ${description}, ${description_te}, 
             ${incident_date ? new Date(incident_date) : null}, ${_attachments}::jsonb, ${!!is_anonymous}, ${assignedAdminId})
        RETURNING *
    `;

  // Trigger Push Notification to assigned admin
  if (assignedAdminId) {
    (async () => {
      try {
        const { sendNotificationToUsers } = await import('../services/notificationService.js');
        await sendNotificationToUsers(
          [assignedAdminId],
          'GIRL_SAFETY_RECEIVED', // Generic template name or fallback
          { message: 'You have a new safety message' }
        );
      } catch (err) {

      }
    })();
  }

  res.status(201).json({
    message: 'Complaint submitted confidentially',
    complaint: {
      id: complaint.id,
      ticket_no: complaint.ticket_no,
      category: complaint.category,
      status: complaint.status,
      created_at: complaint.created_at,
      is_anonymous: complaint.is_anonymous
    }
  });
}));

/**
 * GET /girl-safety/:id
 * Get details & thread
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [complaint] = await sql`
        SELECT 
            c.*,
             CASE 
                WHEN c.is_anonymous = true THEN 'Confidential User'
                ELSE sp.display_name
            END as student_name
        FROM public.girl_safety_complaints c
        JOIN students s ON c.student_id = s.id
        JOIN persons sp ON s.person_id = sp.id
        WHERE c.id = ${id}
    `;

  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  const internalId = req.user.internal_id;
  const isStudent = req.user?.roles.includes('student');
  const isAdmin = req.user?.roles.includes('admin');

  // Access control
  if (isStudent) {
    // Verify student owns this
    const [studentProfile] = await sql`
            SELECT s.id 
            FROM students s 
            JOIN persons p ON s.person_id = p.id 
            JOIN users u ON p.id = u.person_id 
            WHERE u.id = ${internalId}
        `;
    if (!studentProfile || studentProfile.id !== complaint.student_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Hide description to students? No, they raised it.
  } else if (isAdmin) {
    // Usually check if assigned
    if (complaint.assigned_to !== internalId) {
      // Depending on strict policy, they might not see it, or super admins can. Let's strict to assigned.
      const [isSuper] = await sql`SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ${internalId} AND r.code='superadmin'`;
      if (!isSuper) {
        return res.status(403).json({ error: 'Access denied - not assigned' });
      }
    }
  } else {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Fetch threads
  const threads = await sql`
        SELECT 
            t.id, t.sender_role, t.message, t.message_te, t.created_at
        FROM public.girl_safety_complaint_threads t
        WHERE t.complaint_id = ${id}
        ORDER BY t.created_at ASC
    `;

  // Map `assigned_to` to generic string for student
  let assigned_authority = 'Admin';
  if (isStudent) {
    // Determine if lady admin (but don't expose name)
    const [assigned] = await sql`
            SELECT g.name as gender
            FROM users u
            JOIN persons p ON u.person_id = p.id
            JOIN genders g ON p.gender_id = g.id
            WHERE u.id = ${complaint.assigned_to}
         `;
    if (assigned?.gender === 'Female') {
      assigned_authority = 'Lady Admin';
    }
  } else {

    // If it's admin, they don't necessarily need this, but good to have.
    // Also don't send the real student_name if anonymous (handled in query)
  }res.json({
    ...complaint,
    assigned_authority,
    threads
  });
}));

/**
 * POST /girl-safety/:id/thread
 * Add a reply to the complaint
 */
router.post('/:id/thread', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const [complaint] = await sql`
        SELECT student_id, assigned_to 
        FROM public.girl_safety_complaints 
        WHERE id = ${id}
    `;

  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  const internalId = req.user.internal_id;
  const isStudent = req.user?.roles.includes('student');
  const isAdmin = req.user?.roles.includes('admin');

  const sender_role = isStudent ? 'student' : 'admin';

  // Access control
  if (isStudent) {
    const [studentProfile] = await sql`
            SELECT s.id 
            FROM students s 
            JOIN persons p ON s.person_id = p.id 
            JOIN users u ON p.id = u.person_id 
            WHERE u.id = ${internalId}
        `;
    if (!studentProfile || studentProfile.id !== complaint.student_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
  } else if (isAdmin) {
    if (complaint.assigned_to !== internalId) {
      const [isSuper] = await sql`SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ${internalId} AND r.code='superadmin'`;
      if (!isSuper) {
        return res.status(403).json({ error: 'Access denied - not assigned' });
      }
    }
  } else {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Translate message
  let message_te = null;
  try {
    const te = await translateFields({ message });
    message_te = te.message || null;
  } catch (e) {

  }

  const [thread] = await sql`
        INSERT INTO public.girl_safety_complaint_threads 
            (complaint_id, sender_id, sender_role, message, message_te)
        VALUES 
            (${id}, ${internalId}, ${sender_role}, ${message}, ${message_te})
        RETURNING id, sender_role, message, message_te, created_at
    `;

  // Notifications
  (async () => {
    try {
      const { sendNotificationToUsers } = await import('../services/notificationService.js');
      const targetUserId = isStudent ? complaint.assigned_to : (() => {
        // Convert student_id to user_id for notification
        // ... handle cleanly in query
        return null;
      })();

      if (isStudent && complaint.assigned_to) {
        await sendNotificationToUsers(
          [complaint.assigned_to],
          'GIRL_SAFETY_UPDATE',
          { message: 'You have a new safety message' }
        );
      } else if (!isStudent && complaint.student_id) {
        const [studentUser] = await sql`
                    SELECT u.id 
                    FROM users u
                    JOIN persons p ON u.person_id = p.id
                    JOIN students s ON p.id = s.person_id
                    WHERE s.id = ${complaint.student_id}
                 `;
        if (studentUser) {
          await sendNotificationToUsers(
            [studentUser.id],
            'GIRL_SAFETY_UPDATE',
            { message: 'You have a new safety message' }
          );
        }
      }

    } catch (err) {

    }
  })();

  res.status(201).json(thread);
}));

export default router;