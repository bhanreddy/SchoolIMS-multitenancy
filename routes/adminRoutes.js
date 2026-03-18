import express from 'express';
import sql from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';

const router = express.Router();

/**
 * GET /admin/dashboard-stats
 * Get aggregated statistics for the admin dashboard
 * AR1: fee_transactions scoped via student_fees.school_id join
 */
router.get('/dashboard-stats', requireAuth, asyncHandler(async (req, res) => {
    const schoolId = req.schoolId;

    // 1. Total Students
    const [studentCount] = await sql`
        SELECT COUNT(*) as count FROM students WHERE deleted_at IS NULL AND school_id = ${schoolId}
    `;

    // 2. Staff Stats
    const [totalStaff] = await sql`
        SELECT COUNT(*) as count FROM staff WHERE status_id = 1 AND deleted_at IS NULL AND school_id = ${schoolId}
    `;
    const activeStaffCount = parseInt(totalStaff.count) || 0;

    // Staff Present Today
    const [staffPresentQuery] = await sql`
        SELECT COUNT(*) as count FROM staff_attendance sa
        JOIN staff st ON sa.staff_id = st.id
        WHERE sa.attendance_date = CURRENT_DATE AND sa.status = 'present' AND st.school_id = ${schoolId}
    `;
    const staffPresent = parseInt(staffPresentQuery.count) || 0;

    // 3. Complaints
    const [complaintCount] = await sql`
        SELECT COUNT(*) as count FROM complaints WHERE status = 'open' AND school_id = ${schoolId}
    `;

    // 4. AR1: Fee collection — scoped to this school via student_fees join
    const [todayCollection] = await sql`
        SELECT COALESCE(SUM(ft.amount), 0) as total
        FROM fee_transactions ft
        JOIN student_fees sf ON ft.student_fee_id = sf.id
        WHERE ft.paid_at::DATE = CURRENT_DATE
          AND sf.school_id = ${schoolId}
    `;

    const [totalCollection] = await sql`
        SELECT COALESCE(SUM(ft.amount), 0) as total
        FROM fee_transactions ft
        JOIN student_fees sf ON ft.student_fee_id = sf.id
        WHERE sf.school_id = ${schoolId}
    `;

    return sendSuccess(res, req.schoolId, {
        totalStudents: parseInt(studentCount.count),
        staffPresent: staffPresent,
        totalStaff: activeStaffCount,
        complaints: parseInt(complaintCount.count),
        collection: parseFloat(totalCollection?.total || 0),
        todayCollection: parseFloat(todayCollection?.total || 0)
    });
}));

export default router;