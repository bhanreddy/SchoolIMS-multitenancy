-- Check teacher for Class 10th A
SELECT cs.id, cs.class_teacher_id, p.display_name as teacher_name, st.staff_code, c.name as class_name, s.name as section_name
FROM class_sections cs
JOIN classes c ON cs.class_id = c.id
JOIN sections s ON cs.section_id = s.id
LEFT JOIN staff st ON cs.class_teacher_id = st.id
LEFT JOIN persons p ON st.person_id = p.id
WHERE c.name ILIKE '%Class 10%' AND s.name ILIKE '%Section A%';

-- Check students in Class 10 A again
SELECT s.admission_no, p.display_name, se.class_section_id, cs.academic_year_id
FROM student_enrollments se
JOIN students s ON se.student_id = s.id
JOIN persons p ON s.person_id = p.id
JOIN class_sections cs ON se.class_section_id = cs.id
JOIN classes c ON cs.class_id = c.id
JOIN sections sec ON cs.section_id = sec.id
WHERE c.name ILIKE '%Class 10%' AND sec.name ILIKE '%Section A%';

-- Check all staff
SELECT st.id, p.display_name, st.staff_code
FROM staff st
JOIN persons p ON st.person_id = p.id
LIMIT 20;
