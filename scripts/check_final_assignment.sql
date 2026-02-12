-- Check teacher for Class 10th A after update
SELECT cs.id, cs.class_teacher_id, p.display_name as teacher_name, st.staff_code
FROM class_sections cs
JOIN classes c ON cs.class_id = c.id
JOIN sections s ON cs.section_id = s.id
LEFT JOIN staff st ON cs.class_teacher_id = st.id
LEFT JOIN persons p ON st.person_id = p.id
WHERE c.name ILIKE '%Class 10%' AND s.name ILIKE '%Section A%';

-- Check students in Class 10 A
SELECT s.admission_no, p.display_name, se.class_section_id
FROM student_enrollments se
JOIN students s ON se.student_id = s.id
JOIN persons p ON s.person_id = p.id
WHERE se.class_section_id = '6f891673-8d9a-4e6f-8519-d5363df86406'
AND se.status = 'active';
