import sql from '../db.js';

async function listStudents() {

  const statuses = await sql`SELECT * FROM student_statuses`;
  console.table(statuses);

  // Using current date to find active AY
  const [ay] = await sql`SELECT id, code FROM academic_years WHERE now() BETWEEN start_date AND end_date LIMIT 1`;

  if (!ay) {

    process.exit(1);
  }

  // Diagnostic Queries
  const diagnostics = await sql`
        SELECT
            (SELECT COUNT(*) FROM students) as total_students_all,
            (SELECT COUNT(*) FROM students WHERE deleted_at IS NULL) as total_active_students,
            (SELECT COUNT(*) FROM student_enrollments WHERE status = 'pending') as pending_enrollments_count,
            (SELECT COUNT(*) FROM student_enrollments WHERE status = 'failed') as failed_enrollments_count
    `;

  // Check for students with NO active enrollment in current AY
  const potentially_unenrolled = await sql`
        SELECT s.id, p.display_name, st.code as status
        FROM students s
        JOIN persons p ON s.person_id = p.id
        JOIN student_statuses st ON s.status_id = st.id
        WHERE s.deleted_at IS NULL
        AND NOT EXISTS (
            SELECT 1 FROM student_enrollments se
            WHERE se.student_id = s.id
            AND se.academic_year_id = ${ay.id}
            AND se.status = 'active'
            AND se.deleted_at IS NULL
        )
    `;

  // Check for Soft Deleted Students
  const deleted_students = await sql`
        SELECT s.id, p.display_name, s.deleted_at
        FROM students s
        JOIN persons p ON s.person_id = p.id
        WHERE s.deleted_at IS NOT NULL
        LIMIT 5
    `;

  const students = await sql`
        SELECT
            s.id, p.display_name, st.code as student_status,
            (SELECT COUNT(*) FROM student_enrollments se WHERE se.student_id = s.id) as total_enrollments,
            (SELECT COUNT(*) FROM student_enrollments se WHERE se.student_id = s.id AND se.academic_year_id = ${ay.id} AND se.status = 'active') as active_enrollments_this_year,
            (SELECT status FROM student_enrollments se WHERE se.student_id = s.id AND se.academic_year_id = ${ay.id} ORDER BY created_at DESC LIMIT 1) as latest_enrollment_status
        FROM students s
        JOIN persons p ON s.person_id = p.id
        JOIN student_statuses st ON s.status_id = st.id
        WHERE s.deleted_at IS NULL
    `;

  const result = {
    ay,
    diagnostics: diagnostics[0],
    unenrolled_list: potentially_unenrolled,
    deleted_sample: deleted_students,
    all_students: students
  };
  import('fs').then((fs) => {
    fs.writeFileSync('debug_results.json', JSON.stringify(result, null, 2));

    process.exit(0);
  });
}

listStudents().catch(console.error);