import express from 'express';
import { sendResponse } from '../utils/apiResponse.js';
import { supabase, supabaseAdmin } from '../db.js';
import sql from '../db.js';
import bcrypt from 'bcrypt'; // Needed if we used local password hash but here we use Supabase Auth


const router = express.Router();

// Middleware to verify if the user is a super admin
export const verifySuperAdminMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Missing authorization header' });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Malformed authorization header' });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Query super_admins using SERVICE_ROLE client (supabaseAdmin)
        const { data: superAdminRow, error: saError } = await supabaseAdmin
            .from('super_admins')
            .select('id, is_active, email')
            .eq('id', user.id)
            .single();

        if (saError || !superAdminRow) {
            return res.status(403).json({ error: 'Not a super admin' });
        }

        if (superAdminRow.is_active !== true) {
            return res.status(403).json({ error: 'Super admin account is deactivated' });
        }

        req.superAdmin = { id: superAdminRow.id, email: superAdminRow.email };
        next();
    } catch (err) {
        console.error('Super Admin Verification Error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

// GET /api/super-admin/verify
router.get('/verify', verifySuperAdminMiddleware, async (req, res) => {
    try {
        // Try to update last_login first
        try {
            await sql`SELECT update_super_admin_last_login(${req.superAdmin.id})`;
        } catch (dbErr) {
            console.error('Warning: Could not update last_login (DB might be timing out):', dbErr.message || dbErr.code);
            // We ignore this error and continue to fetch the admin data
        }
        
        // Fetch full info to return
        const { data: adminData, error } = await supabaseAdmin
            .from('super_admins')
            .select('id, email, full_name, is_active, created_at, last_login, created_by')
            .eq('id', req.superAdmin.id)
            .single();
            
        if (error || !adminData) {
             return res.status(403).json({ error: 'Super admin not found' });
        }

        return sendResponse(res, 200, { isSuperAdmin: true, admin: adminData });
    } catch (err) {
        console.error('Error in /verify:', err);
        // Default to returning basic info from the middleware if everything else fails
        return sendResponse(res, 200, { isSuperAdmin: true, admin: req.superAdmin });
    }
});

// ==========================================
// SUPER ADMINS MANAGEMENT (/admins)
// ==========================================

router.get('/admins', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { data: admins, error } = await supabaseAdmin
            .from('super_admins')
            .select('id, email, full_name, is_active, created_at, last_login, created_by')
            .order('created_at', { ascending: true });
            
        if (error) throw error;
        
        return sendResponse(res, 200, admins || []);
    } catch (err) {
        console.error('Error fetching super admins:', err);
        res.status(500).json({ error: 'Failed to fetch super admins' });
    }
});

router.post('/admins', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { email, password, full_name } = req.body;
        
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });
        if (!password || password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' });
        if (!full_name || full_name.length < 2) return res.status(400).json({ error: 'Full name must be at least 2 characters' });

        // Create in Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name }
        });

        if (authError) {
             if (authError.status === 422 || authError.message.includes('already exists') || authError.code === 'email_exists') {
                 return res.status(409).json({ error: 'Email already exists' });
             }
             throw authError;
        }

        const authId = authData.user.id;

        // Insert into super_admins table
        const { data: newAdmin, error: insertError } = await supabaseAdmin
            .from('super_admins')
            .insert({
                id: authId,
                email,
                full_name,
                created_by: req.superAdmin.id
            })
            .select('id, email, full_name, is_active, created_at, last_login, created_by')
            .single();
            
        if (insertError) throw insertError;

        return sendResponse(res, 201, newAdmin);
    } catch (err) {
        console.error('Error creating super admin:', err);
        res.status(500).json({ error: 'Failed to create super admin' });
    }
});

router.patch('/admins/:id', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        
        if (typeof is_active !== 'boolean') {
             return res.status(400).json({ error: 'is_active must be a boolean' });
        }
        
        if (id === req.superAdmin.id && !is_active) {
             return res.status(400).json({ error: 'Cannot deactivate yourself' });
        }
        
        // Guard: check last active
        if (!is_active) {
             const { count, error: countError } = await supabaseAdmin
                 .from('super_admins')
                 .select('*', { count: 'exact', head: true })
                 .eq('is_active', true);
                 
             if (countError) throw countError;
             
             if (count <= 1) {
                 return res.status(400).json({ error: 'Cannot deactivate the only active super admin' });
             }
        }

        const { data: updatedAdmin, error } = await supabaseAdmin
            .from('super_admins')
            .update({ is_active })
            .eq('id', id)
            .select('id, email, full_name, is_active, created_at, last_login, created_by')
            .single();
            
        if (error) throw error;
        
        return sendResponse(res, 200, updatedAdmin);
    } catch (err) {
        console.error('Error updating super admin:', err);
        res.status(500).json({ error: 'Failed to update super admin' });
    }
});

router.delete('/admins/:id', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (id === req.superAdmin.id) {
             return res.status(400).json({ error: 'Cannot delete yourself' });
        }
        
        const { count, error: countError } = await supabaseAdmin
             .from('super_admins')
             .select('*', { count: 'exact', head: true })
             .eq('is_active', true);
             
         if (countError) throw countError;
         
         if (count <= 1) {
             return res.status(400).json({ error: 'Cannot delete the only super admin' });
         }

        const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(id);
        if (deleteAuthError) throw deleteAuthError;
        
        // super_admins row deletes via CASCADE since id REFERENCES auth.users(id) ON DELETE CASCADE

        return sendResponse(res, 200, { success: true });
    } catch (err) {
        console.error('Error deleting super admin:', err);
        res.status(500).json({ error: 'Failed to delete super admin' });
    }
});

// ==========================================
// STUDENTS MANAGEMENT
// ==========================================

router.get('/students', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const studentsList = await sql`
            SELECT 
                s.id, 
                s.admission_no, 
                s.created_at,
                s.status_id,
                st.code as status_name,
                p.first_name, 
                p.last_name, 
                p.gender_id,
                p.photo_url,
                sc.name as school_name,
                sc.id as school_id
            FROM students s
            JOIN persons p ON s.person_id = p.id
            JOIN schools sc ON s.school_id = sc.id
            LEFT JOIN student_statuses st ON s.status_id = st.id
            WHERE s.deleted_at IS NULL
            ORDER BY s.created_at DESC
        `;
        return sendResponse(res, 200, studentsList);
    } catch (err) {
        console.error('Error fetching students:', err);
        res.status(500).json({ error: 'Failed to fetch students' });
    }
});

// Schools Management
router.get('/schools', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const schools = await sql`
            SELECT id, name, code, address, logo_url, is_active, created_at
            FROM schools
            ORDER BY created_at DESC
        `;
        return sendResponse(res, 200, schools);
    } catch (err) {
        console.error('Error fetching schools:', err);
        res.status(500).json({ error: 'Failed to fetch schools' });
    }
});

router.get('/schools/:id', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const schools = await sql`
            SELECT id, name, code, address, logo_url, is_active, created_at
            FROM schools
            WHERE id = ${id}
        `;
        if (!schools || schools.length === 0) {
            return res.status(404).json({ error: 'School not found' });
        }
        return sendResponse(res, 200, schools[0]);
    } catch (err) {
        console.error('Error fetching school:', err);
        res.status(500).json({ error: 'Failed to fetch school' });
    }
});

router.post('/schools', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { name, code, address, logo_url } = req.body;
        if (!name || !code) {
           return res.status(400).json({ error: 'Name and Code are required' });
        }
        const newSchool = await sql`
            INSERT INTO schools (school_id, name, code, address, logo_url)
    VALUES (${req.schoolId}, ${name}, ${code}, ${address || null}, ${logo_url || null})
            RETURNING id, name, code, address, logo_url, is_active, created_at
        `;
        return sendResponse(res, 201, newSchool[0]);
    } catch (err) {
        console.error('Error creating school:', err);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'School code already exists' });
        }
        res.status(500).json({ error: 'Failed to create school' });
    }
});

router.patch('/schools/:id', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        const updated = await sql`
            UPDATE schools 
            SET is_active = ${is_active}
            WHERE id = ${id}
      AND school_id = ${req.schoolId}
            RETURNING id, name, code, address, logo_url, is_active, created_at
        `;
        if (!updated || updated.length === 0) {
            return res.status(404).json({ error: 'School not found' });
        }
        return sendResponse(res, 200, updated[0]);
    } catch (err) {
        console.error('Error updating school:', err);
        res.status(500).json({ error: 'Failed to update school' });
    }
});

router.post('/schools/:id/seed-defaults', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        // Verify school exists
        const [school] = await sql`SELECT id FROM schools WHERE id = ${id}`;
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        await sql.begin(async (tx) => {
            // 1. Seed default permissions
            const defaultPermissions = [
                // Students
                { code: 'students.view', name: 'View Students', module: 'students' },
                { code: 'students.create', name: 'Create Students', module: 'students' },
                { code: 'students.edit', name: 'Edit Students', module: 'students' },
                { code: 'students.delete', name: 'Delete Students', module: 'students' },
                // Staff
                { code: 'staff.view', name: 'View Staff', module: 'staff' },
                { code: 'staff.create', name: 'Create Staff', module: 'staff' },
                { code: 'staff.edit', name: 'Edit Staff', module: 'staff' },
                { code: 'staff.delete', name: 'Delete Staff', module: 'staff' },
                // Academics
                { code: 'academics.view', name: 'View Academics', module: 'academics' },
                { code: 'academics.manage', name: 'Manage Academics', module: 'academics' },
                // Attendance
                { code: 'attendance.view', name: 'View Attendance', module: 'attendance' },
                { code: 'attendance.mark', name: 'Mark Attendance', module: 'attendance' },
                { code: 'attendance.edit', name: 'Edit Attendance', module: 'attendance' },
                // Fees
                { code: 'fees.view', name: 'View Fees', module: 'fees' },
                { code: 'fees.manage', name: 'Manage Fees', module: 'fees' },
                { code: 'fees.collect', name: 'Collect Fees', module: 'fees' },
                // Results
                { code: 'exams.view', name: 'View Exams', module: 'results' },
                { code: 'exams.manage', name: 'Manage Exams', module: 'results' },
                { code: 'marks.view', name: 'View Marks', module: 'results' },
                { code: 'marks.enter', name: 'Enter Marks', module: 'results' },
                { code: 'results.view', name: 'View Results', module: 'results' },
                { code: 'results.generate', name: 'Generate Results', module: 'results' },
                // Notices
                { code: 'notices.view', name: 'View Notices', module: 'notices' },
                { code: 'notices.create', name: 'Create Notices', module: 'notices' },
                { code: 'notices.manage', name: 'Manage Notices', module: 'notices' },
                // Complaints
                { code: 'complaints.view', name: 'View Complaints', module: 'complaints' },
                { code: 'complaints.create', name: 'Create Complaints', module: 'complaints' },
                // Diary
                { code: 'diary.view', name: 'View Diary', module: 'diary' },
                { code: 'diary.create', name: 'Create Diary', module: 'diary' },
                // Events
                { code: 'events.view', name: 'View Events', module: 'events' },
                { code: 'events.manage', name: 'Manage Events', module: 'events' },
                // Transport
                { code: 'transport.view', name: 'View Transport', module: 'transport' },
                { code: 'transport.manage', name: 'Manage Transport', module: 'transport' },
                // Hostel
                { code: 'hostel.view', name: 'View Hostel', module: 'hostel' },
                { code: 'hostel.manage', name: 'Manage Hostel', module: 'hostel' },
                // Leaves
                { code: 'leaves.view', name: 'View Leaves', module: 'leaves' },
                { code: 'leaves.apply', name: 'Apply Leave', module: 'leaves' },
                { code: 'leaves.approve', name: 'Approve Leaves', module: 'leaves' },
            ];

            for (const perm of defaultPermissions) {
                await tx`
                    INSERT INTO permissions (school_id, code, name, module)
                    VALUES (${id}, ${perm.code}, ${perm.name}, ${perm.module})
                    ON CONFLICT (school_id, code) DO NOTHING
                `;
            }

            // 2. Seed default roles
            const defaultRoles = [
                { code: 'admin', name: 'Administrator', description: 'Full school admin access' },
                { code: 'staff', name: 'Staff', description: 'General staff member' },
                { code: 'teacher', name: 'Teacher', description: 'Teaching staff' },
                { code: 'accountant', name: 'Accountant', description: 'Finance and fees management' },
                { code: 'student', name: 'Student', description: 'Student access' },
                { code: 'parent', name: 'Parent', description: 'Parent/Guardian access' },
                { code: 'driver', name: 'Driver', description: 'Transport driver access' },
            ];

            for (const role of defaultRoles) {
                await tx`
                    INSERT INTO roles (school_id, code, name, description)
                    VALUES (${id}, ${role.code}, ${role.name}, ${role.description})
                    ON CONFLICT (school_id, code) DO NOTHING
                `;
            }

            // 3. Seed role_permissions (admin gets ALL permissions)
            const adminPermissions = await tx`
                SELECT p.id as perm_id, r.id as role_id
                FROM permissions p, roles r
                WHERE p.school_id = ${id} AND r.school_id = ${id} AND r.code = 'admin'
            `;

            for (const ap of adminPermissions) {
                await tx`
                    INSERT INTO role_permissions (school_id, role_id, permission_id)
    VALUES (${req.schoolId}, ${ap.role_id}, ${ap.perm_id})
                    ON CONFLICT DO NOTHING
                `;
            }

            // 4. Teacher gets view + diary + attendance + marks permissions
            const teacherPerms = ['students.view', 'academics.view', 'attendance.view', 'attendance.mark',
                'diary.view', 'diary.create', 'marks.view', 'marks.enter', 'results.view',
                'notices.view', 'complaints.view', 'complaints.create', 'events.view', 'leaves.view', 'leaves.apply'];

            const teacherRole = await tx`SELECT id FROM roles WHERE school_id = ${id} AND code = 'teacher'`;
            if (teacherRole.length > 0) {
                const teacherPermRows = await tx`
                    SELECT id FROM permissions WHERE school_id = ${id} AND code = ANY(${teacherPerms})
                `;
                for (const perm of teacherPermRows) {
                    await tx`
                        INSERT INTO role_permissions (school_id, role_id, permission_id)
    VALUES (${req.schoolId}, ${teacherRole[0].id}, ${perm.id})
                        ON CONFLICT DO NOTHING
                    `;
                }
            }

            // 4.5. Accountant gets view + fees + staff.create permissions
            const accountantPerms = ['students.view', 'attendance.view', 'fees.view', 'fees.collect', 'fees.manage', 'staff.view', 'staff.create', 'staff.edit'];
            const accountantRole = await tx`SELECT id FROM roles WHERE school_id = ${id} AND code = 'accountant'`;
            if (accountantRole.length > 0) {
                const accountantPermRows = await tx`
                    SELECT id FROM permissions WHERE school_id = ${id} AND code = ANY(${accountantPerms})
                `;
                for (const perm of accountantPermRows) {
                    await tx`
                        INSERT INTO role_permissions (school_id, role_id, permission_id)
    VALUES (${req.schoolId}, ${accountantRole[0].id}, ${perm.id})
                        ON CONFLICT DO NOTHING
                    `;
                }
            }

            // 5. Student gets view-only permissions
            const studentPerms = ['attendance.view', 'diary.view', 'results.view', 'notices.view',
                'complaints.view', 'events.view', 'fees.view', 'transport.view', 'hostel.view'];

            const studentRole = await tx`SELECT id FROM roles WHERE school_id = ${id} AND code = 'student'`;
            if (studentRole.length > 0) {
                const studentPermRows = await tx`
                    SELECT id FROM permissions WHERE school_id = ${id} AND code = ANY(${studentPerms})
                `;
                for (const perm of studentPermRows) {
                    await tx`
                        INSERT INTO role_permissions (school_id, role_id, permission_id)
    VALUES (${req.schoolId}, ${studentRole[0].id}, ${perm.id})
                        ON CONFLICT DO NOTHING
                    `;
                }
            }

            // 6. Parent gets same as student
            const parentRole = await tx`SELECT id FROM roles WHERE school_id = ${id} AND code = 'parent'`;
            if (parentRole.length > 0) {
                const parentPermRows = await tx`
                    SELECT id FROM permissions WHERE school_id = ${id} AND code = ANY(${studentPerms})
                `;
                for (const perm of parentPermRows) {
                    await tx`
                        INSERT INTO role_permissions (school_id, role_id, permission_id)
    VALUES (${req.schoolId}, ${parentRole[0].id}, ${perm.id})
                        ON CONFLICT DO NOTHING
                    `;
                }
            }
        });

        return sendResponse(res, 200, { success: true, message: 'Defaults seeded successfully' });
    } catch (err) {
        console.error('Error seeding defaults:', err);
        res.status(500).json({ error: 'Failed to seed defaults', details: err.message });
    }
});

router.post('/schools/:id/first-admin', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { email, password, first_name, last_name, gender_id, dob } = req.body;
        
        if (!email || !password || !first_name || !last_name || !gender_id || !dob) {
            return res.status(400).json({ error: 'All fields including gender and date of birth are required' });
        }

        // 1. Create Supabase Auth user
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });

        if (authError || !authData.user) {
            console.error(authError);
            return res.status(400).json({ error: authError?.message || 'Auth user creation failed' });
        }

        // 2. We use supabaseAdmin auth result to create the entry in `users` and `persons`.
        // Since `school_id` is typically required, we insert person and user with school_id.
        const userId = authData.user.id;

        try {
            await sql.begin(async (tx) => {
                // Check if role exists
                const roles = await tx`SELECT id FROM roles WHERE code = 'admin' AND school_id = ${id}`;
                let roleId;
                if (roles.length > 0) {
                    roleId = roles[0].id;
                } else {
                    // Assuming global roles could be seeded later, we fallback to insert
                    const newRole = await tx`INSERT INTO roles (code, name, school_id) VALUES ('admin', 'Administrator', ${id}) RETURNING id`;
                    roleId = newRole[0].id;
                }

                // Insert Person (dob is the correct column name)
                const newPerson = await tx`
                    INSERT INTO persons (school_id, first_name, last_name, gender_id, dob) 
                    VALUES (${id}, ${first_name}, ${last_name}, ${gender_id}, ${dob}) 
                    RETURNING id
                `;
                const personId = newPerson[0].id;

                // Insert User
                await tx`
                    INSERT INTO users (id, school_id, person_id, account_status)
                    VALUES (${userId}, ${id}, ${personId}, 'active')
                `;

                // Assign Admin Role
                await tx`
                    INSERT INTO user_roles (user_id, role_id, school_id)
                    VALUES (${userId}, ${roleId}, ${id})
                `;
            });
        } catch (dbError) {
            console.error('Error creating first admin in DB, rolling back Auth user:', dbError);
            // Cleanup: delete the auth user we just created since DB insert failed
            await supabaseAdmin.auth.admin.deleteUser(userId);
            return res.status(500).json({ error: dbError.message || 'Failed to create first admin in database' });
        }

        return sendResponse(res, 201, { success: true, message: 'First admin created successfully' });
    } catch (err) {
        console.error('Error creating first admin:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// DASHBOARD & HEALTH STATS
// ==========================================

router.get('/dashboard/stats', verifySuperAdminMiddleware, async (req, res) => {
    try {
        // Run as superuser/service_role bypass
        const statsRow = await sql`
            SELECT
                (SELECT COUNT(*) FROM schools) AS total_schools,
                (SELECT COUNT(*) FROM schools WHERE is_active = true) AS active_schools,
                (SELECT COUNT(*) FROM students WHERE deleted_at IS NULL) AS total_students,
                (SELECT COUNT(*) FROM staff WHERE deleted_at IS NULL) AS total_staff,
                (SELECT COUNT(*) FROM super_admins WHERE is_active = true) AS total_super_admins
        `;
        
        const stats = statsRow && statsRow.length > 0 ? statsRow[0] : {
            total_schools: 0,
            active_schools: 0,
            total_students: 0,
            total_staff: 0,
            total_super_admins: 0
        };

        // Ensure numbers
        return sendResponse(res, 200, {
            total_schools: Number(stats.total_schools) || 0,
            active_schools: Number(stats.active_schools) || 0,
            total_students: Number(stats.total_students) || 0,
            total_staff: Number(stats.total_staff) || 0,
            total_super_admins: Number(stats.total_super_admins) || 0
        });
    } catch (err) {
        console.error('Error fetching dashboard stats - Full Error:', err);
        console.error('Error Details:', {
            message: err.message,
            code: err.code,
            detail: err.detail,
            hint: err.hint,
            where: err.where
        });
        res.status(500).json({ error: 'Failed to fetch dashboard stats', debug: err.message });
    }
});

router.get('/schools/:id/health', verifySuperAdminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const healthRow = await sql`
            SELECT
                (SELECT COUNT(*) FROM students WHERE school_id = ${id} AND deleted_at IS NULL) AS student_count,
                (SELECT COUNT(*) FROM staff WHERE school_id = ${id} AND deleted_at IS NULL) AS staff_count,
                (SELECT COUNT(*) FROM users WHERE school_id = ${id}) AS user_count,
                (SELECT MAX(created_at) FROM audit_logs WHERE school_id = ${id}) AS last_activity,
                (SELECT EXISTS(SELECT 1 FROM roles WHERE school_id = ${id})) AS defaults_seeded,
                (SELECT EXISTS(
                    SELECT 1 FROM user_roles ur
                    JOIN roles r ON ur.role_id = r.id 
                    WHERE ur.school_id = ${id} AND r.code = 'admin'
                )) AS first_admin_exists,
                (SELECT COUNT(*) FROM roles WHERE school_id = ${id}) AS roles_count,
                (SELECT COUNT(*) FROM permissions WHERE school_id = ${id}) AS permissions_count,
                (SELECT COUNT(*) FROM classes WHERE school_id = ${id}) AS class_count,
                (SELECT COUNT(*) FROM academic_years WHERE school_id = ${id}) AS academic_year_count,
                (SELECT EXISTS(
                    SELECT 1 FROM academic_years 
                    WHERE school_id = ${id} AND now() BETWEEN start_date AND end_date
                )) AS has_active_academic_year
        `;
        
        const health = healthRow && healthRow.length > 0 ? healthRow[0] : {
            student_count: 0,
            staff_count: 0,
            user_count: 0,
            last_activity: null,
            defaults_seeded: false,
            first_admin_exists: false,
            roles_count: 0,
            permissions_count: 0,
            class_count: 0,
            academic_year_count: 0,
            has_active_academic_year: false
        };

        return sendResponse(res, 200, {
            student_count: Number(health.student_count) || 0,
            staff_count: Number(health.staff_count) || 0,
            user_count: Number(health.user_count) || 0,
            last_activity: health.last_activity || null,
            defaults_seeded: Boolean(health.defaults_seeded),
            first_admin_exists: Boolean(health.first_admin_exists),
            roles_count: Number(health.roles_count) || 0,
            permissions_count: Number(health.permissions_count) || 0,
            class_count: Number(health.class_count) || 0,
            academic_year_count: Number(health.academic_year_count) || 0,
            has_active_academic_year: Boolean(health.has_active_academic_year)
        });
    } catch (err) {
        console.error('Error fetching school health:', err);
        res.status(500).json({ error: 'Failed to fetch school health' });
    }
});

export default router;