-- ============================================================
-- AUDIT FIX SCRIPT
-- Purpose: Safely fix data integrity issues.
-- WARNING: This modifies data. Run audit_check.sql afterwards to verify.
-- ============================================================

-- ============================================================

-- 1.1 Soft delete enrollments pointing to deleted students
UPDATE student_enrollments
SET deleted_at = NOW(), status = 'withdrawn'
WHERE student_id IN (SELECT id FROM students WHERE deleted_at IS NOT NULL)
  AND deleted_at IS NULL;

-- 1.2 Soft delete attendance for deleted enrollments/students
UPDATE daily_attendance
SET deleted_at = NOW()
WHERE student_enrollment_id IN (SELECT id FROM student_enrollments WHERE deleted_at IS NOT NULL)
  AND deleted_at IS NULL;

-- 1.3 Soft delete student_fees for deleted students
UPDATE student_fees
SET updated_at = NOW() -- Status update via trigger if needed, or just mark
WHERE student_id IN (SELECT id FROM students WHERE deleted_at IS NOT NULL)
  AND amount_paid = 0; -- Only if nothing paid, otherwise keep for financial record? 
-- Actually, we should probably keep fees for financial records even if student is deleted, 
-- but maybe flag them. For now, let's NOT delete fees to preserve financial history.


-- 2. FIX DUPLICATES
-- ============================================================

-- 2.1 Remove duplicate daily_attendance (Keep latest)
WITH duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY student_enrollment_id, attendance_date 
               ORDER BY updated_at DESC
           ) as rn
    FROM daily_attendance
    WHERE deleted_at IS NULL
)
UPDATE daily_attendance
SET deleted_at = NOW()
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- 2.2 Remove duplicate class_subjects (Keep one)
-- (No soft delete column on class_subjects, so HARD DELETE)
DELETE FROM class_subjects
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY class_section_id, subject_id 
                   ORDER BY id
               ) as rn
        FROM class_subjects
    ) t WHERE rn > 1
);

-- 3. FIX LOGICAL MISMATCHES
-- ============================================================

-- 3.1 Backfill class_subjects from timetable_slots (Fix Teacher Subject Mismatch)
-- If a teacher is assigned in timetable but not mapped, we map them.
-- Case A: No mapping exists for this Subject+Section -> INSERT
INSERT INTO class_subjects (class_section_id, subject_id, teacher_id)
SELECT DISTINCT ts.class_section_id, ts.subject_id, ts.teacher_id
FROM timetable_slots ts
WHERE ts.teacher_id IS NOT NULL 
  AND NOT EXISTS (
    SELECT 1 FROM class_subjects cs
    WHERE cs.class_section_id = ts.class_section_id
      AND cs.subject_id = ts.subject_id
);

-- Case B: Mapping exists but teacher is NULL -> UPDATE
UPDATE class_subjects cs
SET teacher_id = ts.teacher_id
FROM timetable_slots ts
WHERE cs.class_section_id = ts.class_section_id
  AND cs.subject_id = ts.subject_id
  AND cs.teacher_id IS NULL
  AND ts.teacher_id IS NOT NULL;

-- Case C: Mapping exists but teacher is different -> UPDATE (Trust Timetable)
-- WARNING: This overwrites existing mapping. We assume Timetable is more "granular/real".
UPDATE class_subjects cs
SET teacher_id = ts.teacher_id
FROM timetable_slots ts
WHERE cs.class_section_id = ts.class_section_id
  AND cs.subject_id = ts.subject_id
  AND cs.teacher_id IS DISTINCT FROM ts.teacher_id
  AND ts.teacher_id IS NOT NULL;


-- 3.2 Close old enrollments if multiple active exist (Keep latest started)
WITH duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY student_id, academic_year_id 
               ORDER BY start_date DESC, created_at DESC
           ) as rn
    FROM student_enrollments
    WHERE status = 'active' AND deleted_at IS NULL
)
UPDATE student_enrollments
SET status = 'completed', end_date = CURRENT_DATE
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
