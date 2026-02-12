-- Final check of Arun Kura's timetable
SELECT ts.period_number, c.name as class_name, s.name as section_name
FROM timetable_slots ts
JOIN class_sections cs ON ts.class_section_id = cs.id
JOIN classes c ON cs.class_id = c.id
JOIN sections s ON cs.section_id = s.id
WHERE ts.teacher_id = (SELECT id FROM staff WHERE staff_code = 'STF001')
ORDER BY ts.period_number;
