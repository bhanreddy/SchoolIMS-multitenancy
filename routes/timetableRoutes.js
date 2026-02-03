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
    day_of_week,
    period_number,
    subject_id,
    teacher_id,
    start_time,
    end_time
  } = req.body;

  // Basic Validation
  if (!academic_year_id || !class_section_id || !day_of_week || !period_number || !subject_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 1. Teacher Overlap Check (Manual since DB constraint is complex for Enums)
  if (teacher_id) {
    const overlap = await sql`
            SELECT 1 FROM timetable_slots 
            WHERE teacher_id = ${teacher_id} 
              AND day_of_week = ${day_of_week}::day_of_week_enum
              AND academic_year_id = ${academic_year_id}
              AND start_time < ${end_time} 
              AND end_time > ${start_time}
        `;

    if (overlap.length > 0) {
      return res.status(409).json({ error: 'Teacher is already booked at this time in another class' });
    }
  }

  // 2. Insert Slot
  const result = await sql`
        INSERT INTO timetable_slots (
            academic_year_id, class_section_id, day_of_week, period_number, 
            subject_id, teacher_id, start_time, end_time
        ) VALUES (
            ${academic_year_id}, ${class_section_id}, ${day_of_week}, ${period_number}, 
            ${subject_id}, ${teacher_id}, ${start_time}, ${end_time}
        )
        RETURNING id
    `;

  res.status(201).json(result[0]);
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

  res.json(slots);
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

  res.json(slots);
}));

export default router;
