import express from 'express';
import sql, { supabaseAdmin } from '../db.js';
import { requirePermission, requireAuth } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

function normalizeStaffPayload(body) {
  return {
    first_name: body.first_name?.trim(),
    middle_name: body.middle_name?.trim() || null,
    last_name: body.last_name?.trim(),
    dob: body.dob || null,
    gender_id: body.gender_id || null, // Default to null if missing
    staff_code: body.staff_code?.trim(),
    joining_date: body.joining_date,
    status_id: body.status_id || 1, // Default to Active (1)
    designation_id: body.designation_id || null, // Default to null if missing
    salary: body.salary || null,
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    password: body.password || null,
    role_code: body.role_code || null
  };
}

/**
 * GET /staff
 * List all staff members
 */
router.get('/', requirePermission('staff.view'), asyncHandler(async (req, res) => {
  const { status, designation_id } = req.query;

  const staff = await sql`
    SELECT 
      st.id, st.staff_code, st.joining_date, st.salary,
      p.first_name, p.middle_name, p.last_name, p.display_name, p.dob, p.photo_url,
      g.name as gender,
      sd.name as designation,
      ss.name as status,
      (SELECT contact_value FROM person_contacts pc 
       WHERE pc.person_id = p.id AND pc.contact_type = 'email' AND pc.is_primary = true LIMIT 1) as email,
      (SELECT contact_value FROM person_contacts pc 
       WHERE pc.person_id = p.id AND pc.contact_type = 'phone' AND pc.is_primary = true LIMIT 1) as phone
    FROM staff st
    JOIN persons p ON st.person_id = p.id
    LEFT JOIN genders g ON p.gender_id = g.id
    LEFT JOIN staff_designations sd ON st.designation_id = sd.id
    LEFT JOIN staff_statuses ss ON st.status_id = ss.id
    WHERE st.deleted_at IS NULL
      AND st.school_id = ${req.schoolId}
      ${status ? sql`AND ss.code = ${status}` : sql``}
      ${designation_id ? sql`AND st.designation_id = ${designation_id}` : sql``}
    ORDER BY p.display_name
  `;

  return sendSuccess(res, req.schoolId, staff);
}));

/**
 * GET /staff/:id
 * Get single staff member details
 */
router.get('/:id', requirePermission('staff.view'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [staff] = await sql`
    SELECT 
      st.id, st.staff_code, st.joining_date, st.salary, st.created_at,
      p.id as person_id, p.first_name, p.middle_name, p.last_name, p.display_name, p.dob, p.photo_url,
      g.name as gender,
      sd.name as designation, sd.id as designation_id,
      ss.name as status, ss.id as status_id,
      u.id as user_id, u.account_status,
      (SELECT json_agg(json_build_object('type', pc.contact_type, 'value', pc.contact_value, 'is_primary', pc.is_primary))
       FROM person_contacts pc WHERE pc.person_id = p.id AND pc.deleted_at IS NULL) as contacts
    FROM staff st
    JOIN persons p ON st.person_id = p.id
    LEFT JOIN genders g ON p.gender_id = g.id
    LEFT JOIN staff_designations sd ON st.designation_id = sd.id
    LEFT JOIN staff_statuses ss ON st.status_id = ss.id
    LEFT JOIN users u ON u.person_id = p.id
    WHERE st.id = ${id} AND st.deleted_at IS NULL AND st.school_id = ${req.schoolId}
  `;

  if (!staff) {
    return res.status(404).json({ error: 'Staff not found' });
  }

  return sendSuccess(res, req.schoolId, staff);
}));

/**
 * POST /staff
 * Create new staff member (and optionally user login)
 */
router.post('/', requirePermission('staff.create'), asyncHandler(async (req, res) => {
  const staffData = normalizeStaffPayload(req.body);
  const {
    first_name, middle_name, last_name, dob, gender_id,
    staff_code, joining_date, status_id, designation_id, salary,
    email, phone, password, role_code
  } = staffData;

  if (!first_name || !last_name || !staff_code || !joining_date) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Missing required fields: first_name, last_name, staff_code, joining_date'
    });
  }

  // Check if user creation is requested but password missing
  if (role_code && !password) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Password is required when creating a login user'
    });
  }

  try {
    const result = await sql.begin(async (sql) => {
      // 1. Create Person
      const [person] = await sql`
                INSERT INTO persons (school_id, first_name, middle_name, last_name, dob, gender_id)
                VALUES (${req.schoolId}, ${first_name}, ${middle_name || null}, ${last_name}, ${dob || null}, ${gender_id})
                RETURNING id
            `;

      // 2. Create Staff
      const [staff] = await sql`
                INSERT INTO staff (school_id, person_id, staff_code, joining_date, status_id, designation_id, salary)
                VALUES (${req.schoolId}, ${person.id}, ${staff_code}, ${joining_date}, ${status_id || 1}, ${designation_id}, ${salary || null})
                RETURNING *
            `;

      // 3. Contacts
      if (email) {
        await sql`INSERT INTO person_contacts (school_id, person_id, contact_type, contact_value, is_primary) 
                    VALUES (${req.schoolId}, ${person.id}, 'email', ${email}, true)`;
      }
      if (phone) {
        await sql`INSERT INTO person_contacts (school_id, person_id, contact_type, contact_value, is_primary) 
                    VALUES (${req.schoolId}, ${person.id}, 'phone', ${phone}, true)`;
      }

      // 4. Create User Login (Optional)
      if (password && email) {
        // Ensure Supabase Admin is available
        if (!supabaseAdmin) {
          throw new Error('Server misconfiguration: Admin client not initialized');
        }

        // Create Supabase User
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { person_id: person.id }
        });

        if (authError) {
          throw new Error(`Supabase Auth Error: ${authError.message}`);
        }

        const supabaseUserId = authData.user.id;

        // Create Local User
        const [user] = await sql`
                    INSERT INTO users (id, school_id, person_id, account_status)
                    VALUES (${supabaseUserId}, ${req.schoolId}, ${person.id}, 'active')
                    RETURNING id
                `;

        // Assign Role (default to 'staff' if not provided)
        const userRole = role_code || 'staff';
        const [role] = await sql`SELECT id FROM roles WHERE code = ${userRole} AND school_id = ${req.schoolId}`;

        if (role) {
          await sql`
                        INSERT INTO user_roles (user_id, role_id, school_id, granted_by)
                        VALUES (${user.id}, ${role.id}, ${req.schoolId}, ${req.user?.internal_id || null})
                    `;
        }
      }

      return staff;
    });

    return sendSuccess(res, req.schoolId, { message: 'Staff created successfully', staff: result }, 201);
  } catch (error) {
    console.error('Error creating staff:', error);
    if (error.message.includes('Supabase Auth Error')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create staff: ' + (error.detail || error.message), details: error.message });
  }
}));

/**
 * PUT /staff/:id
 * Update staff member
 */
router.put('/:id', requirePermission('staff.edit'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    first_name, middle_name, last_name, dob, gender_id,
    staff_code, joining_date, status_id, designation_id, salary,
    email, phone
  } = req.body;

  // Ownership check must short-circuit as 404, not throw into catch/500.
  const [staffCheck] = await sql`
    SELECT person_id
    FROM staff
    WHERE id = ${id}
      AND deleted_at IS NULL
      AND school_id = ${req.schoolId}
  `;

  if (!staffCheck) {
    return res.status(404).json({ error: 'Staff not found' });
  }

  const personId = staffCheck.person_id;

  const result = await sql.begin(async (sql) => {
    // 1. Update Person
    await sql`
      UPDATE persons
      SET 
        first_name = COALESCE(${first_name ?? null}, first_name),
        middle_name = COALESCE(${middle_name ?? null}, middle_name),
        last_name = COALESCE(${last_name ?? null}, last_name),
        dob = COALESCE(${dob ?? null}, dob),
        gender_id = COALESCE(${gender_id ?? null}, gender_id)
      WHERE id = ${personId}
        AND school_id = ${req.schoolId}
    `;

    // 2. Update Staff
    const [updatedStaff] = await sql`
      UPDATE staff
      SET 
        staff_code = COALESCE(${staff_code ?? null}, staff_code),
        joining_date = COALESCE(${joining_date ?? null}, joining_date),
        status_id = COALESCE(${status_id ?? null}, status_id),
        designation_id = COALESCE(${designation_id ?? null}, designation_id),
        salary = COALESCE(${salary ?? null}, salary)
      WHERE id = ${id}
        AND school_id = ${req.schoolId}
      RETURNING *
    `;

    // 3. Update Contacts
    if (email) {
      const [existing] = await sql`
        SELECT id FROM person_contacts 
        WHERE person_id = ${personId} AND contact_type = 'email' AND is_primary = true
      `;
      if (existing) {
        await sql`UPDATE person_contacts SET contact_value = ${email} WHERE id = ${existing.id}
      AND school_id = ${req.schoolId}`;
      } else {
        await sql`INSERT INTO person_contacts (school_id, person_id, contact_type, contact_value, is_primary) 
                  VALUES (${req.schoolId}, ${personId}, 'email', ${email}, true)`;
      }
    }

    if (phone) {
      const [existing] = await sql`
        SELECT id FROM person_contacts 
        WHERE person_id = ${personId} AND contact_type = 'phone' AND is_primary = true
      `;
      if (existing) {
        await sql`UPDATE person_contacts SET contact_value = ${phone} WHERE id = ${existing.id}
      AND school_id = ${req.schoolId}`;
      } else {
        await sql`INSERT INTO person_contacts (school_id, person_id, contact_type, contact_value, is_primary) 
                  VALUES (${req.schoolId}, ${personId}, 'phone', ${phone}, true)`;
      }
    }

    return updatedStaff;
  });

  return sendSuccess(res, req.schoolId, { message: 'Staff updated successfully', staff: result });
}));

/**
 * DELETE /staff/:id
 * Soft delete staff member
 */
router.delete('/:id', requirePermission('staff.delete'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [result] = await sql`
    UPDATE staff SET deleted_at = NOW() WHERE id = ${id} AND deleted_at IS NULL AND school_id = ${req.schoolId} RETURNING id
  `;

  if (!result) {
    return res.status(404).json({ error: 'Staff not found' });
  }

  return sendSuccess(res, req.schoolId, { message: 'Staff deleted successfully' });
}));

// ============== SUB-ROUTES ==============

/**
 * GET /staff/:id/classes
 * Get classes assigned to staff (placeholder - needs class_teachers table)
 */
router.get('/:id/classes', requirePermission('staff.view'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Placeholder - would need class_teachers junction table
  return sendSuccess(res, req.schoolId, {
    staff_id: id,
    message: 'Class assignment feature requires class_teachers table',
    classes: []
  });
}));

/**
 * GET /staff/:id/timetable
 * Get staff timetable (placeholder - needs timetable tables)
 */
router.get('/:id/timetable', requirePermission('staff.view'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Placeholder - will be implemented in Phase 3
  return sendSuccess(res, req.schoolId, {
    staff_id: id,
    message: 'Timetable will be implemented in Phase 3',
    schedule: []
  });
}));

/**
 * GET /staff/:id/payslips
 * Get ALL staff payslips (list)
 */
router.get('/:id/payslips', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // 1. Check permissions (Own Data OR Has Permission)
  const [targetStaff] = await sql`SELECT person_id FROM staff WHERE id = ${id} AND school_id = ${req.schoolId}`;

  if (!targetStaff) {
    return res.status(404).json({ error: 'Staff not found' });
  }

  // Allow if user is looking at their own data OR has staff.view permission
  const isSelf = req.user.person_id === targetStaff.person_id;
  const hasPermission = req.user.permissions && req.user.permissions.includes('staff.view');

  if (!isSelf && !hasPermission) {
    return res.status(403).json({ error: 'Forbidden: missing permission staff.view' });
  }

  // Get all payslips ordered by date desc
  const payslips = await sql`
        SELECT 
            sp.id,
            sp.payroll_month as month,
            sp.payroll_year as year,
            sp.status,
            sp.net_salary as net,
            sp.base_salary + COALESCE(sp.bonus, 0) as earnings,
            sp.deductions as deductions,
            sp.payment_date,
            st.staff_code,
            p.display_name as staff_name,
            sd.name as designation
        FROM staff_payroll sp
        JOIN staff st ON sp.staff_id = st.id AND st.school_id = ${req.schoolId}
        JOIN persons p ON st.person_id = p.id
        LEFT JOIN staff_designations sd ON st.designation_id = sd.id
        WHERE sp.staff_id = ${id}
        ORDER BY sp.payroll_year DESC, sp.payroll_month DESC
    `;

  // Format for frontend (matches Payslip interface in payslip.tsx)
  const formattedPayslips = payslips.map((p) => {
    // Format currency helper
    const formatCurrency = (amount) => {
      return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
    };

    // Get month name
    const date = new Date();
    date.setMonth(p.month - 1);
    const monthName = date.toLocaleString('default', { month: 'long' });

    return {
      id: p.id,
      month: `${monthName} ${p.year}`,
      status: p.status.charAt(0).toUpperCase() + p.status.slice(1), // Capitalize
      earnings: formatCurrency(p.earnings),
      deductions: formatCurrency(p.deductions),
      net: formatCurrency(p.net),
      payment_date: p.payment_date
    };
  });

  return sendSuccess(res, req.schoolId, formattedPayslips);
}));

/**
 * GET /staff/:id/payslip
 * Get staff payslip (placeholder - needs payroll tables)
 */
router.get('/:id/payslip', requirePermission('staff.view'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { month, year } = req.query;

  const targetDate = new Date();
  const targetMonth = month ? parseInt(month) : targetDate.getMonth() + 1;
  const targetYear = year ? parseInt(year) : targetDate.getFullYear();

  // Ensure payroll exists/is up-to-date
  // effectively "lazy load" the payroll calculation if it's missing or outdated
  // (Though triggers handle updates, this ensures existence if never calculated)
  await sql`SELECT recalculate_staff_payroll(${id}, ${targetMonth}, ${targetYear})`;

  const [payroll] = await sql`
        SELECT 
            sp.*,
            st.staff_code,
            p.display_name as staff_name,
            sd.name as designation
        FROM staff_payroll sp
        JOIN staff st ON sp.staff_id = st.id AND st.school_id = ${req.schoolId}
        JOIN persons p ON st.person_id = p.id
        LEFT JOIN staff_designations sd ON st.designation_id = sd.id
        WHERE sp.staff_id = ${id}
        AND sp.payroll_month = ${targetMonth}
        AND sp.payroll_year = ${targetYear}
    `;

  if (!payroll) {
    return res.status(404).json({ error: 'Payroll record not found' });
  }

  return sendSuccess(res, req.schoolId, payroll);
}));

export default router;