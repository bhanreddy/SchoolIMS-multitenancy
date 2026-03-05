import sql from '../db.js';

async function checkMappings() {
  try {

    // 1. Get recent diary entries and their class sections
    const entries = await sql`
      SELECT d.id, d.title, d.entry_date, d.class_section_id, 
             c.name as class_name, s.name as section_name
      FROM diary_entries d
      LEFT JOIN class_sections cs ON d.class_section_id = cs.id
      LEFT JOIN classes c ON cs.class_id = c.id
      LEFT JOIN sections s ON cs.section_id = s.id
      ORDER BY d.created_at DESC
      LIMIT 3
    `;

    // 2. Get students in those class sections
    let students = [];
    if (entries.length > 0) {
      const classSectionIds = [...new Set(entries.map((e) => e.class_section_id))];
      students = await sql`
        SELECT st.id as student_id, st.admission_no, p.display_name, se.class_section_id
        FROM students st
        JOIN student_enrollments se ON st.id = se.student_id
        JOIN persons p ON st.person_id = p.id
        WHERE se.class_section_id IN ${sql(classSectionIds)}
          AND se.status = 'active'
        LIMIT 5
      `;
    }

    process.exit(0);
  } catch (err) {

    process.exit(1);
  }
}

checkMappings();