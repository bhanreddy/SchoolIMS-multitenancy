-- ============================================================
-- AUDIT CHECK SCRIPT
-- Purpose: Detect data integrity issues without modifying data.
-- Run this in SQL Editor to see violations.
-- ============================================================

-- 1. ORPHAN RECORDS (Referencing deleted or non-existent parents)
-- ============================================================

-- 1.1 Enrollments pointing to deleted students
SELECT 'Orphan Enrollment' as issue, se.id, se.student_id, s.admission_no 
FROM student_enrollments se 
LEFT JOIN students s ON se.student_id = s.id 
WHERE s.id IS NULL OR s.deleted_at IS NOT NULL;

-- 1.2 Class Sections pointing to missing staff (Class Teacher)
SELECT 'Invalid Class Teacher' as issue, cs.id as section_id, cs.class_teacher_id
FROM class_sections cs
LEFT JOIN staff s ON cs.class_teacher_id = s.id
WHERE cs.class_teacher_id IS NOT NULL AND (s.id IS NULL OR s.deleted_at IS NOT NULL);

-- 1.3 Timetable slots pointing to invalid teachers
SELECT 'Invalid Teacher in Timetable' as issue, ts.id, ts.teacher_id
FROM timetable_slots ts
LEFT JOIN staff s ON ts.teacher_id = s.id
WHERE ts.teacher_id IS NOT NULL AND (s.id IS NULL OR s.deleted_at IS NOT NULL);

-- 2. LOGICAL INCONSISTENCIES
-- ============================================================

-- 2.1 Students with MULTIPLE ACTIVE enrollments in the SAME Academic Year
SELECT 'Multiple Active Enrollments' as issue, s.admission_no, p.display_name, COUNT(*) as count
FROM student_enrollments se
JOIN students s ON se.student_id = s.id
JOIN persons p ON s.person_id = p.id
WHERE se.status = 'active' AND se.deleted_at IS NULL
GROUP BY se.student_id, se.academic_year_id, s.admission_no, p.display_name
HAVING COUNT(*) > 1;

-- 2.2 Attendance records for students NOT enrolled in the class ON THAT DATE
SELECT 'Attendance without Enrollment' as issue, da.attendance_date, s.admission_no, c.name as class_name
FROM daily_attendance da
JOIN student_enrollments se ON da.student_enrollment_id = se.id
JOIN students s ON se.student_id = s.id
JOIN class_sections cs ON se.class_section_id = cs.id
JOIN classes c ON cs.class_id = c.id
WHERE da.deleted_at IS NULL
  AND (da.attendance_date < se.start_date OR (se.end_date IS NOT NULL AND da.attendance_date > se.end_date));

-- 2.3 Duplicate Attendance (Same Student, Same Date)
SELECT 'Duplicate Attendance' as issue, s.admission_no, da.attendance_date, COUNT(*)
FROM daily_attendance da
JOIN student_enrollments se ON da.student_enrollment_id = se.id
JOIN students s ON se.student_id = s.id
WHERE da.deleted_at IS NULL
GROUP BY da.student_enrollment_id, da.attendance_date, s.admission_no
HAVING COUNT(*) > 1;

-- 2.4 Timetable: Teacher assigned to subject they are not mapped to in class_subjects
SELECT 'Teacher Subject Mismatch' as issue, ts.day_of_week, ts.period_number, st.display_name as teacher, sub.name as subject, c.name as class_name
FROM timetable_slots ts
JOIN staff t ON ts.teacher_id = t.id
JOIN persons st ON t.person_id = st.id
JOIN subjects sub ON ts.subject_id = sub.id
JOIN class_sections cs ON ts.class_section_id = cs.id
JOIN classes c ON cs.class_id = c.id
WHERE ts.teacher_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM class_subjects map 
    WHERE map.class_section_id = ts.class_section_id 
      AND map.teacher_id = ts.teacher_id
      AND map.subject_id = ts.subject_id
);

-- 2.5 LMS: Course instructor distinct from Class Subject Teacher (Soft Check)
SELECT 'LMS Instructor Mismatch' as issue, lms.title, p.display_name as instructor, c.name as class, s.name as subject
FROM lms_courses lms
JOIN staff st ON lms.instructor_id = st.id
JOIN persons p ON st.person_id = p.id
JOIN classes c ON lms.class_id = c.id
JOIN subjects s ON lms.subject_id = s.id
LEFT JOIN class_sections cs ON cs.class_id = c.id -- Approximation (LMS is per class, not section usually)
WHERE NOT EXISTS (
    SELECT 1 FROM class_subjects map
    JOIN class_sections map_cs ON map.class_section_id = map_cs.id
    WHERE map_cs.class_id = lms.class_id 
      AND map.teacher_id = lms.instructor_id 
      AND map.subject_id = lms.subject_id
);

-- 2.6 Fees: Student Fees for AY where student has NO enrollment history
SELECT 'Fee without Enrollment' as issue, s.admission_no, ay.code as ay_code, ft.name as fee
FROM student_fees sf
JOIN fee_structures fs ON sf.fee_structure_id = fs.id
JOIN academic_years ay ON fs.academic_year_id = ay.id
JOIN students s ON sf.student_id = s.id
JOIN fee_types ft ON fs.fee_type_id = ft.id
WHERE NOT EXISTS (
    SELECT 1 FROM student_enrollments se 
    WHERE se.student_id = sf.student_id 
      AND se.academic_year_id = fs.academic_year_id
);

-- 3. CONSTRAINT CHECKS
-- ============================================================

-- 3.1 Check for duplicate class_subjects mapping
SELECT 'Duplicate Class Subject Map' as issue, c.name, s.name, COUNT(*)
FROM class_subjects cs
JOIN class_sections sec ON cs.class_section_id = sec.id
JOIN classes c ON sec.class_id = c.id
JOIN subjects s ON cs.subject_id = s.id
GROUP BY cs.class_section_id, cs.subject_id, c.name, s.name
HAVING COUNT(*) > 1;
