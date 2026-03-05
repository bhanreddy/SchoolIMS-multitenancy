import sql from '../db.js';

async function check() {
  try {
    const res = await sql`
            SELECT 
                cs.id, 
                c.name as class_name, 
                sec.name as section_name, 
                s.name as subject_name,
                st.staff_code,
                p.display_name
            FROM class_subjects cs
            JOIN class_sections csec ON cs.class_section_id = csec.id
            JOIN classes c ON csec.class_id = c.id
            JOIN sections sec ON csec.section_id = sec.id
            JOIN subjects s ON cs.subject_id = s.id
            JOIN staff st ON cs.teacher_id = st.id
            JOIN persons p ON st.person_id = p.id
            WHERE p.first_name = 'Bharath'
        `;

  } catch (err) {

  } finally {
    process.exit(0);
  }
}

check();