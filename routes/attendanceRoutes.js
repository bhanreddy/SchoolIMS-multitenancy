import express from 'express';
import sql from '../db.js';
import { requirePermission, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

/**
 * GET /attendance
 * Get attendance records with filters
 * Query params: date, class_section_id, student_id, from_date, to_date
 */
router.get('/', requirePermission('attendance.view'), asyncHandler(async (req, res) => {
  const { date, class_section_id, student_id, from_date, to_date, page = 1, limit = 50 } = req.query;
  console.log('[DEBUG] GET /attendance called with params:', req.query);
  const offset = (page - 1) * limit;

  // Build dynamic query based on filters
  let attendance;

  if (date && class_section_id) {
    // Get full student list with attendance for a specific date and class
    attendance = await sql`
      SELECT 
        da.id, da.attendance_date, da.status, da.marked_at,
        s.id as student_id, s.admission_no,
        p.display_name as student_name, p.photo_url,
        marker.display_name as marked_by_name
      FROM student_enrollments se
      JOIN students s ON se.student_id = s.id
      JOIN persons p ON s.person_id = p.id
      LEFT JOIN daily_attendance da ON da.student_enrollment_id = se.id 
        AND da.attendance_date = ${date}
        AND da.deleted_at IS NULL
      LEFT JOIN users u ON da.marked_by = u.id
      LEFT JOIN persons marker ON u.person_id = marker.id
      WHERE se.class_section_id = ${class_section_id}
        AND se.status = 'active'
        AND se.deleted_at IS NULL
        AND s.deleted_at IS NULL
      ORDER BY p.display_name
    `;
  } else if (student_id && from_date && to_date) {
    // Get attendance history for a student
    attendance = await sql`
      SELECT 
        da.id, da.attendance_date, da.status, da.marked_at,
        c.name as class_name, sec.name as section_name
      FROM daily_attendance da
      JOIN student_enrollments se ON da.student_enrollment_id = se.id
      JOIN class_sections cs ON se.class_section_id = cs.id
      JOIN classes c ON cs.class_id = c.id
      JOIN sections sec ON cs.section_id = sec.id
      WHERE se.student_id = ${student_id}
        AND da.attendance_date BETWEEN ${from_date} AND ${to_date}
        AND da.deleted_at IS NULL
      ORDER BY da.attendance_date DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (date) {
    // Get all attendance for a date
    attendance = await sql`
      SELECT 
        da.id, da.attendance_date, da.status,
        s.id as student_id, s.admission_no,
        p.display_name as student_name,
        c.name as class_name, sec.name as section_name
      FROM daily_attendance da
      JOIN student_enrollments se ON da.student_enrollment_id = se.id
      JOIN students s ON se.student_id = s.id
      JOIN persons p ON s.person_id = p.id
      JOIN class_sections cs ON se.class_section_id = cs.id
      JOIN classes c ON cs.class_id = c.id
      JOIN sections sec ON cs.section_id = sec.id
      WHERE da.attendance_date = ${date}
        AND da.deleted_at IS NULL
      ORDER BY c.name, sec.name, p.display_name
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    return res.status(400).json({
      error: 'Please provide filters: date, or (student_id + from_date + to_date)'
    });
  }

  res.json(attendance);
}));

/**
 * POST /attendance
 * Mark attendance (bulk)
 * Body: { class_section_id, date, attendance: [{ student_id, status }] }
 */
// Mark attendance (bulk)
router.post('/', requirePermission('attendance.mark'), asyncHandler(async (req, res) => {
  let { class_section_id, date, attendance, records } = req.body;
  if (!attendance && records) attendance = records;
  const isAdmin = req.user?.roles.includes('admin');

  if (!date || !attendance || !Array.isArray(attendance)) {
    return res.status(400).json({
      error: 'date and attendance array are required'
    });
  }

  // 1. Automatic Detection for Teachers
  if (!class_section_id && !isAdmin) {
    const [staff] = await sql`SELECT id FROM staff WHERE person_id = ${req.user.person_id}`;
    const [currentYear] = await sql`SELECT id FROM academic_years WHERE now() BETWEEN start_date AND end_date LIMIT 1`;

    if (staff && currentYear) {
      // Try Timetable Period 1 first
      let [assigned] = await sql`
        SELECT class_section_id as id 
        FROM timetable_slots 
        WHERE teacher_id = ${staff.id} 
          AND academic_year_id = ${currentYear.id} 
          AND period_number = 1
        LIMIT 1
      `;

      // Fallback to static assignment
      if (!assigned) {
        [assigned] = await sql`
          SELECT id FROM class_sections 
          WHERE class_teacher_id = ${staff.id} 
          AND academic_year_id = ${currentYear.id} 
          LIMIT 1
        `;
      }
      if (assigned) {
        class_section_id = assigned.id;
      }
    }
  }

  if (!class_section_id) {
    return res.status(400).json({ error: 'class_section_id is required' });
  }

  // 2. Strict Authorization: Verify User is Class Teacher (unless Admin)
  if (!isAdmin) {
    // Check Timetable (Period 1) OR static Class Teacher Assignment
    const [isAuthorized] = await sql`
        SELECT 1 FROM class_sections cs
        WHERE cs.id = ${class_section_id}
          AND cs.class_teacher_id = (SELECT id FROM staff WHERE person_id = ${req.user.person_id})
        UNION ALL
        SELECT 1 FROM timetable_slots ts
        WHERE ts.class_section_id = ${class_section_id}
          AND ts.teacher_id = (SELECT id FROM staff WHERE person_id = ${req.user.person_id})
          AND ts.period_number = 1
        LIMIT 1
      `;

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Only the designated Class Teacher (or Period 1 Subject Teacher) can mark attendance for this class' });
    }
  }

  const markedBy = req.user?.internal_id || null;

  const results = await sql.begin(async sql => {
    const inserted = [];

    for (const record of attendance) {
      const { student_id, status } = record;

      if (!student_id || !status) continue;

      // Get active enrollment for this student in this class
      const [enrollment] = await sql`
        SELECT id FROM student_enrollments
        WHERE student_id = ${student_id}
          AND class_section_id = ${class_section_id}
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `;

      if (!enrollment) {
        console.warn(`No active enrollment for student ${student_id} in class ${class_section_id}`);
        continue;
      }

      // Upsert attendance using ON CONFLICT (requires unique constraint on student_enrollment_id, attendance_date)
      const [upserted] = await sql`
        INSERT INTO daily_attendance (student_enrollment_id, attendance_date, status, marked_by, updated_at, deleted_at)
        VALUES (${enrollment.id}, ${date}, ${status}, ${markedBy}, NOW(), NULL)
        ON CONFLICT (student_enrollment_id, attendance_date)
        WHERE deleted_at IS NULL -- Handle partial index compatibility if unique constraint is partial
        DO UPDATE SET 
            status = EXCLUDED.status,
            marked_by = EXCLUDED.marked_by,
            updated_at = NOW(),
            deleted_at = NULL
        RETURNING id, status
      `;

      inserted.push({ student_id, ...upserted });
    }

    return inserted;
  });

  res.status(201).json({
    message: 'Attendance marked successfully',
    count: results.length,
    records: results
  });
}));

/**
 * PUT /attendance/:id
 * Update single attendance record
 */
router.put('/:id', requirePermission('attendance.edit'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  const validStatuses = ['present', 'absent', 'late', 'half_day'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  const [updated] = await sql`
    UPDATE daily_attendance
    SET status = ${status}, marked_by = ${req.user?.internal_id}
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING *
  `;

  if (!updated) {
    return res.status(404).json({ error: 'Attendance record not found' });
  }

  res.json({ message: 'Attendance updated', attendance: updated });
}));

/**
 * GET /attendance/summary
 * Get attendance summary/statistics
 * Query: student_id, class_section_id, academic_year_id, from_date, to_date
 */
router.get('/summary', requirePermission('attendance.view'), asyncHandler(async (req, res) => {
  const { student_id, class_section_id, from_date, to_date } = req.query;

  if (student_id) {
    // Student attendance summary
    const summary = await sql`
      SELECT 
        COUNT(*) FILTER (WHERE da.status = 'present') as present_days,
        COUNT(*) FILTER (WHERE da.status = 'absent') as absent_days,
        COUNT(*) FILTER (WHERE da.status = 'late') as late_days,
        COUNT(*) FILTER (WHERE da.status = 'half_day') as half_days,
        COUNT(*) as total_days,
        ROUND(
          COUNT(*) FILTER (WHERE da.status = 'present')::numeric / 
          NULLIF(COUNT(*), 0) * 100, 2
        ) as attendance_percentage
      FROM daily_attendance da
      JOIN student_enrollments se ON da.student_enrollment_id = se.id
      WHERE se.student_id = ${student_id}
        AND da.deleted_at IS NULL
        ${from_date ? sql`AND da.attendance_date >= ${from_date}` : sql``}
        ${to_date ? sql`AND da.attendance_date <= ${to_date}` : sql``}
    `;

    res.json(summary[0]);
  } else if (class_section_id) {
    // Class attendance summary for a date range
    const summary = await sql`
      SELECT 
        da.attendance_date,
        COUNT(*) FILTER (WHERE da.status = 'present') as present,
        COUNT(*) FILTER (WHERE da.status = 'absent') as absent,
        COUNT(*) FILTER (WHERE da.status = 'late') as late,
        COUNT(*) as total
      FROM daily_attendance da
      JOIN student_enrollments se ON da.student_enrollment_id = se.id
      WHERE se.class_section_id = ${class_section_id}
        AND da.deleted_at IS NULL
        ${from_date ? sql`AND da.attendance_date >= ${from_date}` : sql``}
        ${to_date ? sql`AND da.attendance_date <= ${to_date}` : sql``}
      GROUP BY da.attendance_date
      ORDER BY da.attendance_date DESC
    `;

    res.json(summary);
  } else {
    return res.status(400).json({
      error: 'Please provide student_id or class_section_id'
    });
  }
}));

/**
 * GET /attendance/my-class
 * Automatically detect teacher's assigned class and student list
 */
router.get('/my-class', requireAuth, asyncHandler(async (req, res) => {
  // 1. Get staff profile for current user
  const [staff] = await sql`SELECT id FROM staff WHERE person_id = ${req.user.person_id}`;
  if (!staff) {
    return res.status(404).json({ error: 'Staff profile not found' });
  }

  // 2. Get current academic year
  const [currentYear] = await sql`SELECT id FROM academic_years WHERE now() BETWEEN start_date AND end_date LIMIT 1`;
  if (!currentYear) {
    return res.status(404).json({ error: 'No active academic year found' });
  }

  // 3. Find assigned class section (Dynamic Timetable Check)
  // Logic: First look for a class where they have Period 1 (Class Teacher logic)
  // Fallback: Use explicitly assigned class_teacher_id
  let [classSection] = await sql`
    SELECT class_section_id as id 
    FROM timetable_slots 
    WHERE teacher_id = ${staff.id} 
      AND academic_year_id = ${currentYear.id} 
      AND period_number = 1
    LIMIT 1
  `;

  if (!classSection) {
    [classSection] = await sql`
      SELECT id 
      FROM class_sections 
      WHERE class_teacher_id = ${staff.id} 
      AND academic_year_id = ${currentYear.id} 
      LIMIT 1
    `;
  }

  if (!classSection) {
    return res.status(404).json({
      error: 'No class assigned to you as a Class Teacher for the current academic year'
    });
  }

  // 4. Load students for this class section (reusing logic)
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const students = await sql`
    SELECT 
      s.id as student_id, s.admission_no,
      p.display_name as student_name, p.photo_url,
      se.id as enrollment_id,
      da.id as attendance_id, da.status, da.marked_at
    FROM student_enrollments se
    JOIN students s ON se.student_id = s.id
    JOIN persons p ON s.person_id = p.id
    LEFT JOIN daily_attendance da ON da.student_enrollment_id = se.id 
      AND da.attendance_date = ${date}
      AND da.deleted_at IS NULL
    WHERE se.class_section_id = ${classSection.id}
      AND se.status = 'active'
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
    ORDER BY p.display_name
  `;

  const [classInfo] = await sql`
    SELECT c.name as class_name, s.name as section_name
    FROM class_sections cs
    JOIN classes c ON cs.class_id = c.id
    JOIN sections s ON cs.section_id = s.id
    WHERE cs.id = ${classSection.id}
  `;

  res.json({
    date,
    class_section_id: classSection.id,
    class_name: classInfo?.class_name,
    section_name: classInfo?.section_name,
    total_students: students.length,
    marked_count: students.filter(s => s.status).length,
    students
  });
}));

/**
 * GET /attendance/class/:classSectionId
 * Get class attendance for a specific date (or today)
 * Returns list of students with their attendance status
 */
router.get('/class/:classSectionId', requirePermission('attendance.view'), asyncHandler(async (req, res) => {
  let { classSectionId } = req.params;

  // 1. Automatic Detection if ID is missing or literal 'undefined'/'null'
  if (!classSectionId || classSectionId === 'undefined' || classSectionId === 'null') {
    const isAdmin = req.user?.roles.includes('admin');
    if (!isAdmin) {
      // Auto-detect for teacher
      const [staff] = await sql`SELECT id FROM staff WHERE person_id = ${req.user.person_id}`;
      const [currentYear] = await sql`SELECT id FROM academic_years WHERE now() BETWEEN start_date AND end_date LIMIT 1`;

      if (staff && currentYear) {
        // Priority 1: Timetable Period 1
        const [timetableAuto] = await sql`
          SELECT class_section_id FROM timetable_slots 
          WHERE teacher_id = ${staff.id} AND academic_year_id = ${currentYear.id} AND period_number = 1
          LIMIT 1
        `;
        if (timetableAuto) {
          classSectionId = timetableAuto.class_section_id;
        } else {
          // Priority 2: Static Class Teacher Assignment
          const [staticAuto] = await sql`
            SELECT id FROM class_sections 
            WHERE class_teacher_id = ${staff.id} AND academic_year_id = ${currentYear.id}
            LIMIT 1
          `;
          if (staticAuto) {
            classSectionId = staticAuto.id;
          }
        }
      }
    }
  }

  if (!classSectionId || classSectionId === 'undefined' || classSectionId === 'null') {
    return res.status(400).json({ error: 'Class Section ID required (not automatically detectable for this user)' });
  }

  const { date = new Date().toISOString().split('T')[0] } = req.query;

  // Get all students in the class with their attendance status for the date
  const students = await sql`
    SELECT 
      s.id as student_id, s.admission_no,
      p.display_name as student_name, p.photo_url,
      se.id as enrollment_id,
      da.id as attendance_id, da.status, da.marked_at
    FROM student_enrollments se
    JOIN students s ON se.student_id = s.id
    JOIN persons p ON s.person_id = p.id
    LEFT JOIN daily_attendance da ON da.student_enrollment_id = se.id 
      AND da.attendance_date = ${date}
      AND da.deleted_at IS NULL
    WHERE se.class_section_id = ${classSectionId}
      AND se.status = 'active'
      AND se.deleted_at IS NULL
      AND s.deleted_at IS NULL
    ORDER BY p.display_name
  `;

  // Get class info
  const [classInfo] = await sql`
    SELECT c.name as class_name, s.name as section_name
    FROM class_sections cs
    JOIN classes c ON cs.class_id = c.id
    JOIN sections s ON cs.section_id = s.id
    WHERE cs.id = ${classSectionId}
  `;

  res.json({
    date,
    class_section_id: classSectionId,
    class_name: classInfo?.class_name,
    section_name: classInfo?.section_name,
    total_students: students.length,
    marked_count: students.filter(s => s.status).length,
    students
  });
}));


/**
 * GET /attendance/staff
 * Get staff attendance for a specific date
 * Query: date
 */
router.get('/staff', requirePermission('attendance.view'), asyncHandler(async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }

  const attendance = await sql`
        SELECT 
            s.id as staff_id, s.staff_code,
            p.display_name as staff_name, p.photo_url,
            sd.name as designation,
            sa.id as attendance_id, sa.attendance_date, sa.status, sa.marked_at
        FROM staff s
        JOIN persons p ON s.person_id = p.id
        LEFT JOIN staff_designations sd ON s.designation_id = sd.id
        LEFT JOIN staff_attendance sa ON s.id = sa.staff_id 
            AND sa.attendance_date = ${date}
            AND sa.deleted_at IS NULL
        WHERE s.deleted_at IS NULL
          AND s.status_id = 1 -- Only active staff
        ORDER BY p.display_name
    `;

  res.json(attendance);
}));

/**
 * POST /attendance/staff
 * Mark staff attendance (bulk)
 * Body: { date, attendance: [{ staff_id, status }] }
 */
router.post('/staff', requirePermission('attendance.mark'), asyncHandler(async (req, res) => {
  const { date, attendance } = req.body;

  if (!date || !attendance || !Array.isArray(attendance)) {
    return res.status(400).json({
      error: 'date and attendance array are required'
    });
  }

  const markedBy = req.user?.internal_id || null;

  // Process attendance
  const results = await sql.begin(async sql => {
    const inserted = [];

    for (const record of attendance) {
      const { staff_id, status } = record;

      if (!staff_id || !status) continue;

      const [result] = await sql`
                INSERT INTO staff_attendance (staff_id, attendance_date, status, marked_by)
                VALUES (${staff_id}, ${date}, ${status}, ${markedBy})
                ON CONFLICT (staff_id, attendance_date)
                DO UPDATE SET 
                    status = EXCLUDED.status,
                    marked_by = EXCLUDED.marked_by,
                    updated_at = NOW(),
                    deleted_at = NULL
                RETURNING id, status
            `;

      inserted.push({ staff_id, status: result.status });
    }
    return inserted;
  });

  res.status(201).json({
    message: 'Staff attendance marked successfully',
    count: results.length,
    records: results
  });
}));

export default router;

