import express from 'express';
import sql from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /admin/dashboard-stats
 * Get aggregated statistics for the admin dashboard
 */
router.get('/dashboard-stats', requireAuth, asyncHandler(async (req, res) => {
    // 1. Get Total Students (Using View)
    const [studentCount] = await sql`
        SELECT COUNT(*) as count FROM active_students
    `;

    // 2. Get Staff Stats
    // Total Active Staff
    const [totalStaff] = await sql`
        SELECT COUNT(*) as count FROM staff WHERE status_id = 1 AND deleted_at IS NULL
    `;
    const activeStaffCount = parseInt(totalStaff.count) || 0;

    // Staff Present Today
    const [staffPresentQuery] = await sql`
        SELECT COUNT(*) as count FROM staff_attendance 
        WHERE attendance_date = CURRENT_DATE AND status = 'present'
    `;
    const staffPresent = parseInt(staffPresentQuery.count) || 0;

    // 3. Get Complaints Count (Status = 'open')
    const [complaintCount] = await sql`
        SELECT COUNT(*) as count FROM complaints WHERE status = 'open'
    `;

    // 4. Get Collection stats from fee_transactions
    const [todayCollection] = await sql`
         SELECT COALESCE(SUM(amount), 0) as total 
         FROM fee_transactions 
         WHERE paid_at::DATE = CURRENT_DATE
    `;

    const [totalCollection] = await sql`
        SELECT COALESCE(SUM(amount), 0) as total 
        FROM fee_transactions
    `;

    res.json({
        totalStudents: parseInt(studentCount.count),
        staffPresent: staffPresent,
        totalStaff: activeStaffCount,
        complaints: parseInt(complaintCount.count),
        collection: parseFloat(totalCollection?.total || 0),
        todayCollection: parseFloat(todayCollection?.total || 0)
    });
}));

export default router;
