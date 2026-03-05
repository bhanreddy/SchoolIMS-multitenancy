import express from 'express';
import { supabase } from '../db.js';
import sql from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendNotificationToUsers } from '../services/notificationService.js';

const router = express.Router();

/**
 * GET /:classSectionId/slots
 * Fetch slots for a specific class section (Admin View)
 */
router.get('/:classSectionId/slots', asyncHandler(async (req, res) => {
  const { classSectionId } = req.params;
  const { academic_year_id } = req.query;

  if (!classSectionId) return res.status(400).json({ error: 'Class Section ID required' });

  // Default to current academic year if not provided
  let yearId = academic_year_id;
  if (!yearId) {
    const currentYear = await sql`SELECT id FROM academic_years WHERE start_date <= current_date AND end_date >= current_date LIMIT 1`;
    if (currentYear.length > 0) yearId = currentYear[0].id;else
    return res.json([]); // No active year
  }

  const slots = await sql`
        SELECT 
            ts.id,
            ts.period_number,
            ts.start_time,
            ts.end_time,
            ts.room_no,
            sub.name as subject_name,
            sub.id as subject_id,
            p.display_name as teacher_name,
            ts.teacher_id
        FROM timetable_slots ts
        JOIN subjects sub ON ts.subject_id = sub.id
        LEFT JOIN staff st ON ts.teacher_id = st.id
        LEFT JOIN persons p ON st.person_id = p.id
        WHERE ts.class_section_id = ${classSectionId}
          AND ts.academic_year_id = ${yearId}
        ORDER BY ts.period_number
    `;

  res.json(slots);
}));

/**
 * POST /
 * Add a new timetable slot (Admin Only)
 */
router.post('/', asyncHandler(async (req, res) => {
  const {
    academic_year_id,
    class_section_id,
    period_number,
    subject_id,
    teacher_id: provided_teacher_id,
    room_no
  } = req.body;

  // Basic Validation
  if (!academic_year_id || !class_section_id || !period_number || !subject_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 1. Fetch Official Period Times
  const periodDef = await sql`
        SELECT start_time, end_time 
        FROM periods 
        WHERE sort_order = ${period_number}
        LIMIT 1
  `;

  if (periodDef.length === 0) {
    return res.status(400).json({ error: `Invalid Period Number: ${period_number}. Only configured periods are allowed.` });
  }

  const { start_time, end_time } = periodDef[0];

  // Determine Teacher
  const final_teacher_id = provided_teacher_id || null;
  const final_room_no = room_no || null;

  // Process Logic within Transaction
  await sql.begin(async (sql) => {
    // 2. Teacher Overlap Check
    if (final_teacher_id) {
      const overlap = await sql`
          SELECT 1 FROM timetable_slots 
          WHERE teacher_id = ${final_teacher_id} 
            AND academic_year_id = ${academic_year_id}
            AND start_time < ${end_time} 
            AND end_time > ${start_time}
            AND class_section_id != ${class_section_id} -- Ignore self-overlap (e.g. updating same slot)
      `;

      if (overlap.length > 0) {
        throw new Error('Teacher is already booked at this time');
      }
    }

    // 3. Upsert Slot
    await sql`
      INSERT INTO timetable_slots (
          academic_year_id, class_section_id, period_number, 
          subject_id, teacher_id, start_time, end_time, room_no
      ) VALUES (
          ${academic_year_id}, ${class_section_id}, ${period_number}, 
          ${subject_id}, ${final_teacher_id}, ${start_time}, ${end_time}, ${final_room_no}
      )
      ON CONFLICT (class_section_id, academic_year_id, period_number) WHERE deleted_at IS NULL
      DO UPDATE SET
          subject_id = EXCLUDED.subject_id,
          teacher_id = EXCLUDED.teacher_id,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          room_no = EXCLUDED.room_no,
          updated_at = now()
    `;
  });

  // Send Notification (Async)
  (async () => {
    try {
      await notifyTimetableUpdate([class_section_id]);
    } catch (err) {

    }
  })();

  res.status(200).json({ message: 'Timetable updated successfully' });
}));

/**
 * DELETE /:id
 * Delete a slot
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  await sql`DELETE FROM timetable_slots WHERE id = ${id}`;
  res.json({ message: 'Slot deleted' });
}));

/**
 * GET /my-timetable
 * For Students to see their own timetable
 */
router.get('/my-timetable', asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  const userId = req.user.id;

  // 1. Get Class Section ID for the student
  // Join users -> persons -> students -> student_enrollments (active)
  const enrollment = await sql`
        SELECT se.class_section_id, se.academic_year_id
        FROM student_enrollments se
        JOIN students s ON se.student_id = s.id
        JOIN persons p ON s.person_id = p.id
        JOIN users u ON u.person_id = p.id
        WHERE u.id = ${userId}
          AND se.status = 'active'
        LIMIT 1
    `;

  if (enrollment.length === 0) {
    return res.json([]); // Not enrolled
  }

  const { class_section_id, academic_year_id } = enrollment[0];

  // 2. Fetch Timetable
  const slots = await sql`
        SELECT 
            ts.period_number,
            ts.start_time,
            ts.end_time,
            ts.room_no,
            sub.name as subject_name,
            p.display_name as teacher_name
        FROM timetable_slots ts
        JOIN subjects sub ON ts.subject_id = sub.id
        LEFT JOIN staff st ON ts.teacher_id = st.id
        LEFT JOIN persons p ON st.person_id = p.id
        WHERE ts.class_section_id = ${class_section_id}
          AND ts.academic_year_id = ${academic_year_id}
        ORDER BY ts.start_time
    `;

  res.json(slots);
}));

/**
 * GET /teacher-timetable
 * For Teachers to see their own schedule
 */
router.get('/teacher-timetable', asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  const userId = req.user.id;
  const { academic_year_id } = req.query;

  // Resolve Year
  let yearId = academic_year_id;
  if (!yearId) {
    const currentYear = await sql`SELECT id FROM academic_years WHERE start_date <= current_date AND end_date >= current_date LIMIT 1`;
    if (currentYear.length > 0) yearId = currentYear[0].id;else
    return res.json([]);
  }

  // Fetch Slots for this teacher
  // Join users -> persons -> staff -> timetable_slots
  const slots = await sql`
        SELECT 
            ts.period_number,
            ts.start_time,
            ts.end_time,
            ts.room_no,
            c.name as class_name,
            sec.name as section_name,
            sub.name as subject_name
        FROM timetable_slots ts
        JOIN staff st ON ts.teacher_id = st.id
        JOIN persons p ON st.person_id = p.id
        JOIN users u ON u.person_id = p.id
        JOIN class_sections cs ON ts.class_section_id = cs.id
        JOIN classes c ON cs.class_id = c.id
        JOIN sections sec ON cs.section_id = sec.id
        JOIN subjects sub ON ts.subject_id = sub.id
        WHERE u.id = ${userId}
          AND ts.academic_year_id = ${yearId}
        ORDER BY ts.start_time
    `;

  res.json(slots);
}));

/**
 * GET /periods
 * Fetch all defined periods
 */
router.get('/periods/list', asyncHandler(async (req, res) => {
  const periods = await sql`
        SELECT * FROM periods 
        ORDER BY sort_order ASC, start_time ASC
    `;
  res.json(periods);
}));

/**
 * POST /periods/create
 * Create a new period
 */
router.post('/periods/create', asyncHandler(async (req, res) => {
  const { name, start_time, end_time } = req.body;

  if (!name || !start_time || !end_time) {
    return res.status(400).json({ error: 'name, start_time, and end_time are required' });
  }

  // Validate time format and ensure end > start
  if (start_time >= end_time) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  // Auto-calculate sort_order as max + 1
  const [maxRow] = await sql`SELECT COALESCE(MAX(sort_order), 0) as max_order FROM periods`;
  const sort_order = maxRow.max_order + 1;

  const [created] = await sql`
    INSERT INTO periods (name, start_time, end_time, sort_order)
    VALUES (${name}, ${start_time}, ${end_time}, ${sort_order})
    RETURNING *
  `;

  res.status(201).json(created);
}));
/**
 * PUT /periods
 * Batch update period timings
 */
router.put('/periods', asyncHandler(async (req, res) => {
  const { periods } = req.body;

  if (!periods || !Array.isArray(periods)) {
    return res.status(400).json({ error: 'Invalid payload: periods array required' });
  }

  // Track updated periods for notification
  const updatedPeriodNumbers = [];

  // Use a transaction for atomic updates
  await sql.begin(async (sql) => {
    for (const p of periods) {
      if (p.id) {
        // 1. Update Period Definition
        await sql`
            UPDATE periods 
            SET 
                name = ${p.name}, 
                start_time = ${p.start_time}, 
                end_time = ${p.end_time},
                sort_order = ${p.sort_order || 0}
            WHERE id = ${p.id}
        `;

        // 2. Cascade Time Changes to Timetable Slots
        // We assume period_number in slots corresponds to sort_order
        // This ensures student/teacher views (which read from slots) reflect the new times
        // and collision detection uses the new times.
        if (p.start_time && p.end_time && p.sort_order) {
          await sql`
                UPDATE timetable_slots
                SET 
                    start_time = ${p.start_time},
                    end_time = ${p.end_time}
                WHERE period_number = ${p.sort_order}
            `;
          updatedPeriodNumbers.push(p.sort_order);
        }
      }
    }
  });

  // Send Notification (Async)
  (async () => {
    if (updatedPeriodNumbers.length > 0) {
      try {
        const affected = await sql`
          SELECT DISTINCT class_section_id 
          FROM timetable_slots 
          WHERE period_number IN ${sql(updatedPeriodNumbers)}
        `;

        if (affected.length > 0) {
          const classSectionIds = affected.map((a) => a.class_section_id);
          await notifyTimetableUpdate(classSectionIds);
        }
      } catch (err) {

      }
    }
  })();

  res.json({ message: 'Periods updated successfully' });
}));

/**
 * DELETE /periods/:id
 * Delete a single period and its associated timetable slots
 */
router.delete('/periods/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Get the period to find its sort_order (used as period_number in timetable_slots)
  const [period] = await sql`SELECT * FROM periods WHERE id = ${id}`;
  if (!period) {
    return res.status(404).json({ error: 'Period not found' });
  }

  await sql.begin(async (sql) => {
    // Delete associated timetable slots first
    await sql`DELETE FROM timetable_slots WHERE period_number = ${period.sort_order}`;
    // Delete the period
    await sql`DELETE FROM periods WHERE id = ${id}`;
  });

  res.json({ message: 'Period deleted successfully' });
}));
// Helper to notify students of timetable updates
async function notifyTimetableUpdate(classSectionIds) {
  if (!classSectionIds || classSectionIds.length === 0) return;

  // Deduplicate IDs just in case
  const uniqueIds = [...new Set(classSectionIds)];

  const recipients = await sql`
    SELECT DISTINCT u.id
    FROM users u
    JOIN students s ON u.person_id = s.person_id
    JOIN student_enrollments se ON s.id = se.student_id
    WHERE se.class_section_id IN ${sql(uniqueIds)}
      AND se.status = 'active'
      AND u.account_status = 'active'

    UNION

    SELECT DISTINCT u.id
    FROM users u
    JOIN parents p ON u.person_id = p.person_id
    JOIN student_parents sp ON p.id = sp.parent_id
    JOIN students s ON sp.student_id = s.id
    JOIN student_enrollments se ON s.id = se.student_id
    WHERE se.class_section_id IN ${sql(uniqueIds)}
      AND se.status = 'active'
      AND u.account_status = 'active'
  `;

  if (recipients.length > 0) {
    const userIds = recipients.map((r) => r.id);
    await sendNotificationToUsers(
      userIds,
      'TIMETABLE_UPDATED',
      { message: 'Your class timetable has been updated.' }
    );
  }
}

export default router;