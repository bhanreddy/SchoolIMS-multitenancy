import express from 'express';
import sql from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { sendNotificationToUsers } from '../services/notificationService.js';

const router = express.Router();

/**
 * GET /:classSectionId/slots
 * TT1: requireAuth + requirePermission added
 * TT2: removed manual if(!req.user) guard
 */
router.get('/:classSectionId/slots', requirePermission('academics.view'), asyncHandler(async (req, res) => {
  const { classSectionId } = req.params;
  const { academic_year_id, lastSyncedAt } = req.query;
  const schoolId = req.schoolId;

  if (!classSectionId) return res.status(400).json({ error: 'Class Section ID required' });

  // Ownership check: class_section must belong to this school
  const [cs] = await sql`SELECT id FROM class_sections WHERE id = ${classSectionId} AND school_id = ${schoolId}`;
  if (!cs) return res.status(404).json({ error: 'Class section not found' });

  let yearId = academic_year_id;
  if (!yearId) {
    const currentYear = await sql`
      SELECT id FROM academic_years
      WHERE start_date <= current_date AND end_date >= current_date
        AND school_id = ${schoolId}
      LIMIT 1
    `;
    if (currentYear.length > 0) yearId = currentYear[0].id;
    else return sendSuccess(res, req.schoolId, []);
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
    WHERE ts.class_section_id = ${classSectionId} AND school_id = ${req.schoolId}
      AND ts.academic_year_id = ${yearId}
      ${lastSyncedAt ? sql`AND (ts.updated_at >= ${lastSyncedAt} OR ts.created_at >= ${lastSyncedAt})` : sql``}
    ORDER BY ts.period_number
  `;

  return sendSuccess(res, req.schoolId, slots);
}));

/**
 * POST /
 * TT1: requireAuth + requirePermission added
 * TT4: class_section ownership check before upsert
 */
router.post('/', requirePermission('academics.manage'), asyncHandler(async (req, res) => {
  const {
    academic_year_id,
    class_section_id,
    period_number,
    subject_id,
    teacher_id: provided_teacher_id,
    room_no
  } = req.body;
  const schoolId = req.schoolId;

  if (!academic_year_id || !class_section_id || !period_number || !subject_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // TT4: Ownership check — class_section must belong to this school
  const [csCheck] = await sql`SELECT id FROM class_sections WHERE id = ${class_section_id} AND school_id = ${schoolId}`;
  if (!csCheck) return res.status(404).json({ error: 'Class section not found' });

  // TT4: academic_year must belong to this school
  const [ayCheck] = await sql`SELECT id FROM academic_years WHERE id = ${academic_year_id} AND school_id = ${schoolId}`;
  if (!ayCheck) return res.status(404).json({ error: 'Academic year not found' });

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
  const final_teacher_id = provided_teacher_id || null;
  const final_room_no = room_no || null;

  await sql.begin(async (sql) => {
    if (final_teacher_id) {
      const overlap = await sql`
        SELECT 1 FROM timetable_slots
        WHERE teacher_id = ${final_teacher_id}
          AND academic_year_id = ${academic_year_id}
          AND start_time < ${end_time}
          AND end_time > ${start_time}
          AND class_section_id != ${class_section_id}
      `;

      if (overlap.length > 0) {
        throw new Error('Teacher is already booked at this time');
      }
    }

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

  (async () => {
    try {
      await notifyTimetableUpdate([class_section_id], schoolId);
    } catch (err) {}
  })();

  return sendSuccess(res, req.schoolId, { message: 'Timetable updated successfully' });
}));

/**
 * DELETE /:id
 * TT1: requireAuth added
 * TT4: school_id ownership check via class_sections join
 */
router.delete('/:id', requirePermission('academics.manage'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.schoolId;

  // TT4: Ownership check
  const [slot] = await sql`
    SELECT ts.id FROM timetable_slots ts
    JOIN class_sections cs ON ts.class_section_id = cs.id
    WHERE ts.id = ${id} AND cs.school_id = ${schoolId}
  `;
  if (!slot) return res.status(404).json({ error: 'Timetable slot not found' });

  await sql`DELETE FROM timetable_slots WHERE id = ${id} AND school_id = ${req.schoolId}`;
  return sendSuccess(res, req.schoolId, { message: 'Slot deleted' });
}));

/**
 * GET /my-timetable
 * TT1: requireAuth added
 * TT2: removed manual if(!req.user) guard
 */
router.get('/my-timetable', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const schoolId = req.schoolId;

  const enrollment = await sql`
    SELECT se.class_section_id, se.academic_year_id
    FROM student_enrollments se
    JOIN students s ON se.student_id = s.id
    JOIN persons p ON s.person_id = p.id
    JOIN users u ON u.person_id = p.id
    WHERE u.id = ${userId}
      AND se.status = 'active'
      AND s.school_id = ${schoolId}
    LIMIT 1
  `;

  if (enrollment.length === 0) {
    return sendSuccess(res, req.schoolId, []);
  }

  const { class_section_id, academic_year_id } = enrollment[0];

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
    WHERE ts.class_section_id = ${class_section_id} AND school_id = ${req.schoolId}
      AND ts.academic_year_id = ${academic_year_id}
      ${req.query.lastSyncedAt ? sql`AND (ts.updated_at >= ${req.query.lastSyncedAt} OR ts.created_at >= ${req.query.lastSyncedAt})` : sql``}
    ORDER BY ts.start_time
  `;

  return sendSuccess(res, req.schoolId, slots);
}));

/**
 * GET /teacher-timetable
 * TT1/TT2: requireAuth replaces manual guard; academic_year scoped to school
 */
router.get('/teacher-timetable', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const schoolId = req.schoolId;
  const { academic_year_id } = req.query;

  let yearId = academic_year_id;
  if (!yearId) {
    const currentYear = await sql`
      SELECT id FROM academic_years
      WHERE start_date <= current_date AND end_date >= current_date
        AND school_id = ${schoolId}
      LIMIT 1
    `;
    if (currentYear.length > 0) yearId = currentYear[0].id;
    else return sendSuccess(res, req.schoolId, []);
  }

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
      AND cs.school_id = ${schoolId}
      ${req.query.lastSyncedAt ? sql`AND (ts.updated_at >= ${req.query.lastSyncedAt} OR ts.created_at >= ${req.query.lastSyncedAt})` : sql``}
    ORDER BY ts.start_time
  `;

  return sendSuccess(res, req.schoolId, slots);
}));

/**
 * GET /periods/list
 * TT3: requireAuth added (periods shared structure, but at least auth-gated)
 */
router.get('/periods/list', requireAuth, asyncHandler(async (req, res) => {
  const periods = await sql`
    SELECT * FROM periods
    ORDER BY sort_order ASC, start_time ASC
  `;
  return sendSuccess(res, req.schoolId, periods);
}));

/**
 * POST /periods/create
 * TT3: requirePermission added
 */
router.post('/periods/create', requirePermission('academics.manage'), asyncHandler(async (req, res) => {
  const { name, start_time, end_time } = req.body;

  if (!name || !start_time || !end_time) {
    return res.status(400).json({ error: 'name, start_time, and end_time are required' });
  }

  if (start_time >= end_time) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  const [maxRow] = await sql`SELECT COALESCE(MAX(sort_order), 0) as max_order FROM periods`;
  const sort_order = maxRow.max_order + 1;

  const [created] = await sql`
    INSERT INTO periods (school_id, name, start_time, end_time, sort_order)
    VALUES (${req.schoolId}, ${name}, ${start_time}, ${end_time}, ${sort_order})
    RETURNING *
  `;

  return sendSuccess(res, req.schoolId, created, 201);
}));

/**
 * PUT /periods
 * TT3: requirePermission added
 */
router.put('/periods', requirePermission('academics.manage'), asyncHandler(async (req, res) => {
  const { periods } = req.body;
  const schoolId = req.schoolId;

  if (!periods || !Array.isArray(periods)) {
    return res.status(400).json({ error: 'Invalid payload: periods array required' });
  }

  const updatedPeriodNumbers = [];

  await sql.begin(async (sql) => {
    for (const p of periods) {
      if (p.id) {
        await sql`
          UPDATE periods
          SET
            name = ${p.name},
            start_time = ${p.start_time},
            end_time = ${p.end_time},
            sort_order = ${p.sort_order || 0}
          WHERE id = ${p.id}
      AND school_id = ${req.schoolId}
        `;

        if (p.start_time && p.end_time && p.sort_order) {
          // Only update slots belonging to this school's class sections
          await sql`
            UPDATE timetable_slots ts
            SET
              start_time = ${p.start_time},
              end_time = ${p.end_time}
            FROM class_sections cs
            WHERE ts.class_section_id = cs.id
              AND ts.period_number = ${p.sort_order}
              AND cs.school_id = ${schoolId}
          `;
          updatedPeriodNumbers.push(p.sort_order);
        }
      }
    }
  });

  (async () => {
    if (updatedPeriodNumbers.length > 0) {
      try {
        const affected = await sql`
          SELECT DISTINCT ts.class_section_id
          FROM timetable_slots ts
          JOIN class_sections cs ON ts.class_section_id = cs.id
          WHERE ts.period_number IN ${sql(updatedPeriodNumbers)}
            AND cs.school_id = ${schoolId}
        `;

        if (affected.length > 0) {
          const classSectionIds = affected.map((a) => a.class_section_id);
          await notifyTimetableUpdate(classSectionIds, schoolId);
        }
      } catch (err) {}
    }
  })();

  return sendSuccess(res, req.schoolId, { message: 'Periods updated successfully' });
}));

/**
 * DELETE /periods/:id
 * TT3: requirePermission added
 */
router.delete('/periods/:id', requirePermission('academics.manage'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.schoolId;

  const [period] = await sql`SELECT * FROM periods WHERE id = ${id}`;
  if (!period) {
    return res.status(404).json({ error: 'Period not found' });
  }

  await sql.begin(async (sql) => {
    // Only delete slots that belong to this school
    await sql`
      DELETE FROM timetable_slots ts
      USING class_sections cs
      WHERE ts.class_section_id = cs.id
        AND ts.period_number = ${period.sort_order}
        AND cs.school_id = ${schoolId}
    `;
    await sql`DELETE FROM periods WHERE id = ${id} AND school_id = ${req.schoolId}`;
  });

  return sendSuccess(res, req.schoolId, { message: 'Period deleted successfully' });
}));

// Helper to notify students of timetable updates (scoped to school)
async function notifyTimetableUpdate(classSectionIds, schoolId) {
  if (!classSectionIds || classSectionIds.length === 0) return;

  const uniqueIds = [...new Set(classSectionIds)];

  const recipients = await sql`
    SELECT DISTINCT u.id
    FROM users u
    JOIN students s ON u.person_id = s.person_id
    JOIN student_enrollments se ON s.id = se.student_id
    WHERE se.class_section_id IN ${sql(uniqueIds)}
      AND se.status = 'active'
      AND u.account_status = 'active'
      AND s.school_id = ${schoolId}

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
      AND s.school_id = ${schoolId}
  `;

  if (recipients.length > 0) {
    const userIds = recipients.map((r) => r.id);
    await sendNotificationToUsers(userIds, 'TIMETABLE_UPDATED', { message: 'Your class timetable has been updated.' });
  }
}

export default router;