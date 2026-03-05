import 'dotenv/config';
import sql from '../db.js';

async function fixRoles() {

  try {
    const result = await sql.begin(async (sql) => {
      // 1. Create student and parent roles if they don't exist

      await sql`
                INSERT INTO roles (code, name, is_system) 
                VALUES 
                    ('student', 'Student', true),
                    ('parent', 'Parent', true)
                ON CONFLICT (code) DO NOTHING
            `;

      // 2. Assign permissions to student role

      const studentRole = await sql`SELECT id FROM roles WHERE code = 'student'`;
      if (studentRole.length > 0) {
        const roleId = studentRole[0].id;
        const permissions = [
        'complaints.view', 'complaints.create',
        'attendance.view', 'fees.view',
        'exams.view', 'marks.view', 'results.view',
        'notices.view', 'diary.view', 'timetable.view',
        'events.view', 'transport.view', 'lms.view'];

        await sql`
                    INSERT INTO role_permissions (role_id, permission_id)
                    SELECT ${roleId}, p.id FROM permissions p
                    WHERE p.code = ANY(${permissions})
                    ON CONFLICT DO NOTHING
                `;
      }

      // 3. Assign permissions to parent role

      const parentRole = await sql`SELECT id FROM roles WHERE code = 'parent'`;
      if (parentRole.length > 0) {
        const roleId = parentRole[0].id;
        const permissions = [
        'complaints.view', 'complaints.create',
        'attendance.view', 'fees.view',
        'results.view', 'notices.view', 'diary.view', 'events.view'];

        await sql`
                    INSERT INTO role_permissions (role_id, permission_id)
                    SELECT ${roleId}, p.id FROM permissions p
                    WHERE p.code = ANY(${permissions})
                    ON CONFLICT DO NOTHING
                `;
      }

      // 4. Assign student role to existing student users

      const studentRoleId = studentRole[0].id;
      await sql`
                INSERT INTO user_roles (user_id, role_id)
                SELECT u.id, ${studentRoleId}
                FROM users u
                JOIN persons p ON u.person_id = p.id
                JOIN students s ON p.id = s.person_id
                ON CONFLICT DO NOTHING
            `;

      return true;
    });

  } catch (error) {

  } finally {
    process.exit();
  }
}

fixRoles();