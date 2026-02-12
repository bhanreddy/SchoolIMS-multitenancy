-- 1. Check current academic year as per logic: now() BETWEEN start_date AND end_date
SELECT id, code, start_date, end_date, (now() BETWEEN start_date AND end_date) as is_current
FROM academic_years;

-- 2. Check staff for person logged in (assuming we know the person_id for Arun Kura)
-- First find person_id for STF001
SELECT p.id as person_id, st.id as staff_id, p.display_name
FROM staff st
JOIN persons p ON st.person_id = p.id
WHERE st.staff_code = 'STF001';

-- 3. Check timetable slots for Period 1 for this staff
SELECT ts.class_section_id, ts.academic_year_id, ts.period_number, c.name as class_name, s.name as section_name
FROM timetable_slots ts
JOIN class_sections cs ON ts.class_section_id = cs.id
JOIN classes c ON cs.class_id = c.id
JOIN sections s ON cs.section_id = s.id
WHERE ts.teacher_id = (SELECT id FROM staff WHERE staff_code = 'STF001')
AND ts.period_number = 1;

-- 4. Check students enrolled in those class_sections for the specific academic year
SELECT se.id, s.admission_no, p.display_name, se.class_section_id, se.academic_year_id, se.status
FROM student_enrollments se
JOIN students s ON se.student_id = s.id
JOIN persons p ON s.person_id = p.id
WHERE se.class_section_id IN (
    SELECT class_section_id 
    FROM timetable_slots 
    WHERE teacher_id = (SELECT id FROM staff WHERE staff_code = 'STF001') 
    AND period_number = 1
)
AND se.deleted_at IS NULL;

-- 5. Check if req.user.person_id exists and matches
SELECT u.id as user_id, u.person_id, p.display_name
FROM users u
JOIN persons p ON u.person_id = p.id
WHERE p.display_name ILIKE '%Arun Kura%';
