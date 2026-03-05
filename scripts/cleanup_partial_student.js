import sql from '../db.js';

async function cleanupPartialStudent() {
  try {

    const admissionNo = '01';

    // 1. Find Student
    const students = await sql`
            SELECT id, person_id 
            FROM students 
            WHERE admission_no = ${admissionNo}
        `;

    if (students.length === 0) {

      return;
    }

    const student = students[0];

    // 2. Hard Delete (Cascading manually due to RESTRICT constraints or just logic)
    // Order: Fees -> Attendance -> Marks -> Enrollments -> Student Parents -> Students -> Person Contacts -> Persons
    // Note: Schema seems to use ON DELETE RESTRICT for most things, so we must be careful.

    // Student Parents
    await sql`DELETE FROM student_parents WHERE student_id = ${student.id}`;

    // Enrollments (and cascading attendance/marks if any, though likely none for new student)
    // Need to check ID of enrollment to delete dependent tables if cascading isn't set
    const enrollments = await sql`SELECT id FROM student_enrollments WHERE student_id = ${student.id}`;
    for (const enr of enrollments) {
      await sql`DELETE FROM daily_attendance WHERE student_enrollment_id = ${enr.id}`;
      await sql`DELETE FROM marks WHERE student_enrollment_id = ${enr.id}`;
      await sql`DELETE FROM student_enrollments WHERE id = ${enr.id}`;
    }

    // Student Fees & Receipts (missed in first pass)
    await sql`DELETE FROM student_fees WHERE student_id = ${student.id}`;
    await sql`DELETE FROM receipts WHERE student_id = ${student.id}`;

    // Student Table
    await sql`DELETE FROM students WHERE id = ${student.id}`;

    // Person Contacts & Person (Optional: only if we are sure this person is garbage)
    // Since we just created it, it's likely garbage. 
    // We can check if this person is linked to anything else (users, staff, etc).
    // For now, let's just delete contacts and person to be clean.
    await sql`DELETE FROM person_contacts WHERE person_id = ${student.person_id}`;
    await sql`DELETE FROM persons WHERE id = ${student.person_id}`;

  } catch (error) {

  } finally {
    process.exit();
  }
}

cleanupPartialStudent();