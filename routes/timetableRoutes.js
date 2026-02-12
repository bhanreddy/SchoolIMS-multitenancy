import express from 'express';
import { supabase } from '../db.js';
import sql from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

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
    if (currentYear.length > 0) yearId = currentYear[0].id;
    else return res.json([]); // No active year
  }

  const slots = await sql`
        SELECT 
            ts.id,
            ts.day_of_week,
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
        ORDER BY ts.day_of_week, ts.period_number
    `;

  const formattedSlots = slots.map(slot => ({
    ...slot,
    day_of_week: slot.day_of_week ? slot.day_of_week.substring(0, 3).toLowerCase() : null
  }));

  res.json(formattedSlots);
}));

/**
 * POST /
 * Add a new timetable slot (Admin Only)
 */
router.post('/', asyncHandler(async (req, res) => {
  const {
    academic_year_id,
    class_section_id,
    day_of_week, // Optional if all_days is true
    period_number,
    subject_id,
    teacher_id: provided_teacher_id,
    room_no,
    all_days // Boolean flag
  } = req.body;

  // Basic Validation
  if (!academic_year_id || !class_section_id || !period_number || !subject_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!all_days && !day_of_week) {
    return res.status(400).json({ error: 'day_of_week is required when all_days is false' });
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


  // Determine Days to process
  const dayMap = {
    'mon': 'monday', 'tue': 'tuesday', 'wed': 'wednesday', 'thu': 'thursday', 'fri': 'friday', 'sat': 'saturday', 'sun': 'sunday',
    'Monday': 'monday', 'Tuesday': 'tuesday', 'Wednesday': 'wednesday', 'Thursday': 'thursday', 'Friday': 'friday', 'Saturday': 'saturday', 'Sunday': 'sunday'
  };

  const normalizeDay = (d) => {
    if (!d) return null;
    const cleanD = d.toString().trim().toLowerCase();
    const mapped = dayMap[cleanD];
    return mapped || cleanD;
  };

  const daysToProcess = (all_days && all_days !== 'false')
    ? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    : [normalizeDay(day_of_week)];

  // Process Logic within Transaction
  await sql.begin(async sql => {
    for (const day of daysToProcess) {
      // 2. Teacher Overlap Check
      if (final_teacher_id) {
        const overlap = await sql`
            SELECT 1 FROM timetable_slots 
            WHERE teacher_id = ${final_teacher_id} 
              AND day_of_week = ${day}::day_of_week_enum
              AND academic_year_id = ${academic_year_id}
              AND start_time < ${end_time} 
              AND end_time > ${start_time}
              AND class_section_id != ${class_section_id} -- Ignore self-overlap (e.g. updating same slot)
        `;

        // strict check for single day, skip/warn for bulk
        if (overlap.length > 0 && !all_days) {
          throw new Error(`Teacher is already booked at this time on ${day}`);
        } else if (overlap.length > 0) {
          continue; // Skip collision
        }
      }

      // 3. Upsert Slot
      await sql`
        INSERT INTO timetable_slots (
            academic_year_id, class_section_id, day_of_week, period_number, 
            subject_id, teacher_id, start_time, end_time, room_no
        ) VALUES (
            ${academic_year_id}, ${class_section_id}, ${day}, ${period_number}, 
            ${subject_id}, ${final_teacher_id}, ${start_time}, ${end_time}, ${final_room_no}
        )
        ON CONFLICT (class_section_id, academic_year_id, day_of_week, period_number) WHERE deleted_at IS NULL
        DO UPDATE SET
            subject_id = EXCLUDED.subject_id,
            teacher_id = EXCLUDED.teacher_id,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            room_no = EXCLUDED.room_no,
            updated_at = now()
      `;
    }
  });

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
            ts.day_of_week,
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
        ORDER BY ts.day_of_week, ts.start_time
    `;

  const formattedSlots = slots.map(slot => ({
    ...slot,
    day_of_week: slot.day_of_week ? slot.day_of_week.substring(0, 3).toLowerCase() : null
  }));

  res.json(formattedSlots);
}));

/**
 * GET /teacher-timetable
 * For Teachers to see their own schedule
 */
router.get('/teacher-timetable', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { academic_year_id } = req.query;

  // Resolve Year
  let yearId = academic_year_id;
  if (!yearId) {
    const currentYear = await sql`SELECT id FROM academic_years WHERE start_date <= current_date AND end_date >= current_date LIMIT 1`;
    if (currentYear.length > 0) yearId = currentYear[0].id;
    else return res.json([]);
  }

  // Fetch Slots for this teacher
  // Join users -> persons -> staff -> timetable_slots
  const slots = await sql`
        SELECT 
            ts.day_of_week,
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
        ORDER BY ts.day_of_week, ts.start_time
    `;

  const formattedSlots = slots.map(slot => ({
    ...slot,
    day_of_week: slot.day_of_week ? slot.day_of_week.substring(0, 3).toLowerCase() : null
  }));

  res.json(formattedSlots);
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
 * PUT /periods
 * Batch update period timings
 */
router.put('/periods', asyncHandler(async (req, res) => {
  const { periods } = req.body;

  if (!periods || !Array.isArray(periods)) {
    return res.status(400).json({ error: 'Invalid payload: periods array required' });
  }

  // Use a transaction for atomic updates
  await sql.begin(async sql => {
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
        }
      }
    }
  });

  res.json({ message: 'Periods updated successfully' });
}));

export default router;
