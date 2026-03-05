import express from 'express';
import { supabase, supabaseAdmin } from '../db.js';
import sql from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import config from '../config/env.js';

const router = express.Router();

/**
 * POST /auth/login
 * Login with email and password via Supabase Auth
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return res.status(401).json({ error: 'Invalid credentials', details: error.message });
  }

  // Fetch user roles and permissions
  const userInfo = await sql`
    SELECT 
      u.id, u.account_status, u.person_id,
      p.first_name, p.last_name, p.display_name, p.photo_url,
      s.admission_no,
      st.id as staff_id,
      st.staff_code,
      (SELECT EXISTS(SELECT 1 FROM students st WHERE st.person_id = p.id AND st.deleted_at IS NULL)) as has_student_profile,
      (SELECT EXISTS(SELECT 1 FROM staff st WHERE st.person_id = p.id AND st.deleted_at IS NULL)) as has_staff_profile,
      array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL) as roles,
      array_agg(DISTINCT perm.code) FILTER (WHERE perm.code IS NOT NULL) as permissions,
      us.notification_sound,
      g.name as gender
    FROM users u
    JOIN persons p ON u.person_id = p.id
    LEFT JOIN genders g ON p.gender_id = g.id
    LEFT JOIN user_settings us ON u.id = us.user_id
    LEFT JOIN students s ON p.id = s.person_id
    LEFT JOIN staff st ON p.id = st.person_id
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    LEFT JOIN role_permissions rp ON r.id = rp.role_id
    LEFT JOIN permissions perm ON rp.permission_id = perm.id
    WHERE u.id = ${data.user.id}
    GROUP BY u.id, p.id, g.name, s.admission_no, st.id, us.notification_sound
  `;

  if (userInfo.length === 0) {
    return res.status(404).json({ error: 'User account not found in system' });
  }

  const dbUser = userInfo[0];

  if (dbUser.account_status !== 'active') {
    return res.status(403).json({ error: 'Account is not active' });
  }

  // Check for Class/Section Assignment
  let classSectionId = null;
  if (dbUser.has_staff_profile && dbUser.staff_id) {
    // Get active academic year
    const [currentYear] = await sql`SELECT id FROM academic_years WHERE now() BETWEEN start_date AND end_date LIMIT 1`;

    if (currentYear) {
      // Priority 1: Timetable Period 1
      const [timetableAuto] = await sql`
                SELECT class_section_id FROM timetable_slots 
                WHERE teacher_id = ${dbUser.staff_id} 
                  AND academic_year_id = ${currentYear.id} 
                  AND period_number = 1
                LIMIT 1
            `;
      if (timetableAuto) {
        classSectionId = timetableAuto.class_section_id;
      } else {
        // Priority 2: Static Class Teacher Assignment
        const [staticAuto] = await sql`
                    SELECT id FROM class_sections 
                    WHERE class_teacher_id = ${dbUser.staff_id} 
                      AND academic_year_id = ${currentYear.id}
                    LIMIT 1
                `;
        if (staticAuto) {
          classSectionId = staticAuto.id;
        }
      }
    }
  } else if (dbUser.has_student_profile) {
    // Get active enrollment for student
    const [enrollment] = await sql`
            SELECT se.class_section_id 
            FROM student_enrollments se
            JOIN students s ON se.student_id = s.id
            WHERE s.person_id = ${dbUser.person_id}
              AND se.status = 'active'
              AND se.deleted_at IS NULL
            LIMIT 1
        `;
    if (enrollment) {
      classSectionId = enrollment.class_section_id;
    }
  }

  // Update last login
  await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${data.user.id}`;

  res.json({
    message: 'Login successful',
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: {
      id: dbUser.id,
      email: data.user.email,
      display_name: dbUser.display_name,
      first_name: dbUser.first_name,
      last_name: dbUser.last_name,
      photo_url: dbUser.photo_url,
      roles: dbUser.roles || [],
      permissions: dbUser.permissions || [],
      admission_no: dbUser.admission_no,
      has_student_profile: dbUser.has_student_profile,
      has_staff_profile: dbUser.has_staff_profile,
      staff_id: dbUser.staff_id,
      staff_code: dbUser.staff_code,
      class_section_id: classSectionId,
      classId: classSectionId,
      notification_sound: dbUser.notification_sound || 'custom',
      gender: dbUser.gender
    }
  });
}));

/**
 * POST /auth/logout
 * Logout current session
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(400).json({ error: 'No session to logout' });
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    return res.status(500).json({ error: 'Logout failed', details: error.message });
  }

  res.json({ message: 'Logged out successfully' });
}));

/**
 * POST /auth/refresh
 * Refresh JWT token
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error) {
    return res.status(401).json({ error: 'Token refresh failed', details: error.message });
  }

  res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at
  });
}));

/**
 * GET /auth/me
 * Get current authenticated user profile
 */
router.get('/me', asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Fetch full profile
  const userInfo = await sql`
    SELECT 
      u.id, u.person_id, u.account_status, u.last_login_at, u.created_at,
      p.first_name, p.middle_name, p.last_name, p.display_name, p.dob, p.photo_url,
      g.name as gender,
      s.admission_no,
      st.id as staff_id,
      st.staff_code,
      (SELECT EXISTS(SELECT 1 FROM students st WHERE st.person_id = p.id AND st.deleted_at IS NULL)) as has_student_profile,
      (SELECT EXISTS(SELECT 1 FROM staff st WHERE st.person_id = p.id AND st.deleted_at IS NULL)) as has_staff_profile,
      array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL) as roles,
      array_agg(DISTINCT perm.code) FILTER (WHERE perm.code IS NOT NULL) as permissions,
      us.notification_sound,
      -- Get contacts
      (SELECT json_agg(json_build_object('type', pc.contact_type, 'value', pc.contact_value, 'is_primary', pc.is_primary))
       FROM person_contacts pc WHERE pc.person_id = p.id AND pc.deleted_at IS NULL) as contacts
    FROM users u
    JOIN persons p ON u.person_id = p.id
    LEFT JOIN user_settings us ON u.id = us.user_id
    LEFT JOIN students s ON p.id = s.person_id
    LEFT JOIN staff st ON p.id = st.person_id
    LEFT JOIN genders g ON p.gender_id = g.id
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    LEFT JOIN role_permissions rp ON r.id = rp.role_id
    LEFT JOIN permissions perm ON rp.permission_id = perm.id
    WHERE u.id = ${req.user.id}
    GROUP BY u.id, p.id, g.name, s.admission_no, st.id, us.notification_sound
  `;

  if (userInfo.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const dbUser = userInfo[0];

  // Check for Class/Section Assignment (Re-detect for /me)
  let classSectionId = null;
  if (dbUser.has_staff_profile && dbUser.staff_id) {
    const [currentYear] = await sql`SELECT id FROM academic_years WHERE now() BETWEEN start_date AND end_date LIMIT 1`;
    if (currentYear) {
      const [timetableAuto] = await sql`
                SELECT class_section_id FROM timetable_slots 
                WHERE teacher_id = ${dbUser.staff_id} AND academic_year_id = ${currentYear.id} AND period_number = 1
                LIMIT 1
            `;
      if (timetableAuto) {
        classSectionId = timetableAuto.class_section_id;
      } else {
        const [staticAuto] = await sql`
                    SELECT id FROM class_sections 
                    WHERE class_teacher_id = ${dbUser.staff_id} AND academic_year_id = ${currentYear.id}
                    LIMIT 1
                `;
        if (staticAuto) classSectionId = staticAuto.id;
      }
    }
  } else if (dbUser.has_student_profile) {
    const [enrollment] = await sql`
            SELECT class_section_id FROM student_enrollments se 
            JOIN students s ON se.student_id = s.id 
            WHERE s.person_id = ${dbUser.person_id} AND se.status = 'active' AND se.deleted_at IS NULL 
            LIMIT 1
        `;
    if (enrollment) classSectionId = enrollment.class_section_id;
  }

  res.json({
    ...dbUser,
    staff_id: dbUser.staff_id,
    staff_code: dbUser.staff_code,
    class_section_id: classSectionId,
    classId: classSectionId,
    notification_sound: dbUser.notification_sound || 'custom'
  });
}));

/**
 * POST /auth/forgot-password
 * Request password reset email
 */
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: config.auth.passwordResetRedirectUrl
  });

  if (error) {

  }

  // Always return success to prevent email enumeration
  res.json({ message: 'If the email exists, a password reset link has been sent' });
}));

/**
 * POST /auth/reset-password
 * Reset password with token (called after user clicks email link)
 */
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { new_password } = req.body;

  if (!new_password) {
    return res.status(400).json({ error: 'New password is required' });
  }

  if (new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const { error } = await supabase.auth.updateUser({ password: new_password });

  if (error) {
    return res.status(400).json({ error: 'Password reset failed', details: error.message });
  }

  res.json({ message: 'Password reset successfully' });
}));

/**
 * POST /auth/change-password
 * Change password by verifying current password first
 */
router.post('/change-password', asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  // We already have req.user from auth middleware, but we need email or phone to sign in again to verify old password.
  // Let's get the email first from the database
  const [dbUser] = await sql`SELECT email, person_id FROM users u 
                               JOIN auth.users au ON u.id = au.id
                               WHERE u.id = ${req.user.id}`;

  // As we can't easily query auth.users from public schema if we don't have access,
  // actually, let's use supabaseAdmin to get the user email if needed, or if we rely on req.user.email if available.
  // Or we verify by attempting signInWithPassword using the user's email.

  // Wait, let's do this cleaner:
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(req.user.id);
  if (userError || !userData.user) {
    return res.status(400).json({ error: 'User not found' });
  }

  const email = userData.user.email;

  // Verify current password by attempting login
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: current_password
  });

  if (signInError) {
    return res.status(401).json({ error: 'Incorrect current password' });
  }

  // Now update the password
  const { error: updateError } = await supabase.auth.admin.updateUserById(req.user.id, {
    password: new_password
  });

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update password', details: updateError.message });
  }

  // Log the event
  try {
    await sql`
            INSERT INTO audit_logs (
                user_id, 
                action, 
                entity, 
                details, 
                ip_address, 
                user_agent, 
                request_id
            ) VALUES (
                ${req.user.id}, 
                'PASSWORD_CHANGED', 
                'users', 
                ${sql.json({ changed_at: new Date().toISOString() })}, 
                ${req.ip}, 
                ${req.headers['user-agent']}, 
                ${req.headers['x-request-id']}
            )
        `;
  } catch (auditErr) {

  }

  res.json({ message: 'Password changed successfully. Please log in again.' });
}));

/**
 * POST /auth/request-access
 * Unauthenticated endpoint to request out-of-hours access after a rejected login
 */
router.post('/request-access', asyncHandler(async (req, res) => {
  const { userId, department, note } = req.body;

  if (!userId || !department) {
    return res.status(400).json({ error: 'userId and department are required' });
  }

  // Insert using the admin backend connection (bypasses RLS)
  try {
    const [request] = await sql`
        INSERT INTO access_requests (requested_by, department, request_note, status) 
        VALUES (${userId}, ${department}, ${note}, 'pending')
        RETURNING id
    `;
    res.json({ success: true, message: 'Access request submitted successfully', requestId: request.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit request', details: err.message });
  }
}));

export default router;