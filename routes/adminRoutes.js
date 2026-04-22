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

    const [
        [studentCount],
        [totalStaff],
        [staffPresentQuery],
        [complaintCount],
        [todayCollection],
        [totalCollection],
    ] = await Promise.all([
        sql`
        SELECT COUNT(*)::int as count FROM students WHERE deleted_at IS NULL AND school_id = ${schoolId}
    `,
        sql`
        SELECT COUNT(*)::int as count FROM staff WHERE status_id = 1 AND deleted_at IS NULL AND school_id = ${schoolId}
    `,
        sql`
        SELECT COUNT(*)::int as count FROM staff_attendance sa
        JOIN staff st ON sa.staff_id = st.id
        WHERE sa.attendance_date = CURRENT_DATE
          AND sa.status = 'present'
          AND sa.deleted_at IS NULL
          AND st.school_id = ${schoolId}
    `,
        sql`
        SELECT COUNT(*)::int as count FROM complaints WHERE status = 'open' AND school_id = ${schoolId}
    `,
        sql`
        SELECT COALESCE(SUM(ft.amount), 0) as total
        FROM fee_transactions ft
        JOIN student_fees sf ON ft.student_fee_id = sf.id
        WHERE ft.paid_at::DATE = CURRENT_DATE
          AND sf.school_id = ${schoolId}
    `,
        sql`
        SELECT COALESCE(SUM(ft.amount), 0) as total
        FROM fee_transactions ft
        JOIN student_fees sf ON ft.student_fee_id = sf.id
        WHERE sf.school_id = ${schoolId}
    `,
    ]);

    const activeStaffCount = parseInt(totalStaff.count) || 0;
    const staffPresent = parseInt(staffPresentQuery.count) || 0;

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