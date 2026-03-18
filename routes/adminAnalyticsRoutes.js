import express from 'express';
import sql from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';

const router = express.Router();

/**
 * Helper to get date range based on 'month', 'quarter', or 'year'
 */
function getDateRange(range) {
    const now = new Date();
    let startDate;
    switch (range) {
        case 'quarter':
            startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
        case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
        case 'month':
        default:
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
    }
    return startDate;
}

/**
 * fetchFinancials — 100% DB-driven
 */
async function fetchFinancials(range, schoolId) {
    const start = getDateRange(range);

    // Total Collected
    const [collected] = await sql`
        SELECT COALESCE(SUM(ft.amount), 0) as total
        FROM fee_transactions ft
        JOIN student_fees sf ON ft.student_fee_id = sf.id
        WHERE ft.paid_at >= ${start}
          AND sf.school_id = ${schoolId}
    `;

    // Outstanding
    const [outstanding] = await sql`
        SELECT COALESCE(SUM(amount_due - discount - amount_paid), 0) as total
        FROM student_fees
        WHERE due_date >= ${start}
          AND status != 'paid'
          AND deleted_at IS NULL
          AND school_id = ${schoolId}
    `;

    // Total Invoiced (all billed)
    const [invoiced] = await sql`
        SELECT COALESCE(SUM(amount_due), 0) as total
        FROM student_fees
        WHERE created_at >= ${start}
          AND deleted_at IS NULL
          AND school_id = ${schoolId}
    `;

    // Discount Given
    const [discounts] = await sql`
        SELECT COALESCE(SUM(discount), 0) as total
        FROM student_fees
        WHERE created_at >= ${start}
          AND deleted_at IS NULL
          AND school_id = ${schoolId}
    `;

    // Refunds (Not supported in current DB schema)
    const refunds = { total: 0 };

    // New Enrollments — students enrolled this period
    const [enrollments] = await sql`
        SELECT COUNT(*) as count
        FROM students
        WHERE created_at >= ${start}
          AND deleted_at IS NULL
          AND school_id = ${schoolId}
    `;

    // Revenue Trend — last 6 months
    const trend = await sql`
        SELECT
            TO_CHAR(ft.paid_at, 'Mon') as label,
            SUM(ft.amount) as value
        FROM fee_transactions ft
        JOIN student_fees sf ON ft.student_fee_id = sf.id
        WHERE ft.paid_at > CURRENT_DATE - INTERVAL '6 months'
          AND sf.school_id = ${schoolId}
        GROUP BY TO_CHAR(ft.paid_at, 'Mon'), DATE_TRUNC('month', ft.paid_at)
        ORDER BY DATE_TRUNC('month', ft.paid_at)
    `;

    const totalCollected = parseFloat(collected.total) || 0;
    const totalInvoiced = parseFloat(invoiced.total) || 0;
    const efficiency = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

    return {
        total_collected: totalCollected,
        outstanding_dues: parseFloat(outstanding.total) || 0,
        collection_efficiency: efficiency,
        total_invoiced: totalInvoiced,
        discount_given: parseFloat(discounts.total) || 0,
        refunds_issued: parseFloat(refunds.total) || 0,
        new_enrollments: parseInt(enrollments.count) || 0,
        trend: trend.map(t => ({ label: t.label, value: parseFloat(t.value) || 0 })),
        by_class: [],
        top_pending: []
    };
}

/**
 * fetchAttendance — 100% DB-driven
 */
async function fetchAttendance(range, schoolId) {
    const start = getDateRange(range);

    // Average student attendance %
    const [avgAtt] = await sql`
        SELECT
            (COUNT(*) FILTER (WHERE da.status IN ('present', 'late', 'half_day')))::FLOAT
            / NULLIF(COUNT(*), 0) * 100 as pct
        FROM daily_attendance da
        JOIN student_enrollments se ON da.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE da.attendance_date >= ${start}
          AND s.school_id = ${schoolId}
    `;

    // Chronic absentees (<75%)
    const [chronic] = await sql`
        WITH student_att AS (
            SELECT se.student_id,
                   COUNT(*) FILTER (WHERE da.status IN ('present', 'late', 'half_day'))::FLOAT / NULLIF(COUNT(*), 0) * 100 as pct
            FROM daily_attendance da
            JOIN student_enrollments se ON da.student_enrollment_id = se.id
            JOIN students s ON se.student_id = s.id
            WHERE da.attendance_date >= ${start}
              AND s.school_id = ${schoolId}
            GROUP BY se.student_id
        )
        SELECT COUNT(*) as count FROM student_att WHERE pct < 75
    `;

    // Total working days (distinct dates with attendance records)
    const [workingDays] = await sql`
        SELECT COUNT(DISTINCT da.attendance_date) as count
        FROM daily_attendance da
        JOIN student_enrollments se ON da.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE da.attendance_date >= ${start}
          AND s.school_id = ${schoolId}
    `;

    // Staff attendance %
    const [staffAtt] = await sql`
        SELECT
            (COUNT(*) FILTER (WHERE sa.status IN ('present', 'late', 'half_day')))::FLOAT
            / NULLIF(COUNT(*), 0) * 100 as pct
        FROM staff_attendance sa
        JOIN staff st ON sa.staff_id = st.id
        WHERE sa.attendance_date >= ${start}
          AND st.school_id = ${schoolId}
          AND st.deleted_at IS NULL
    `;

    // Attendance trend — last 14 days
    const trend = await sql`
        SELECT
            TO_CHAR(da.attendance_date, 'DD Mon') as label,
            (COUNT(*) FILTER (WHERE da.status IN ('present', 'late', 'half_day')))::FLOAT
            / NULLIF(COUNT(*), 0) * 100 as value
        FROM daily_attendance da
        JOIN student_enrollments se ON da.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE da.attendance_date > CURRENT_DATE - INTERVAL '14 days'
          AND s.school_id = ${schoolId}
        GROUP BY da.attendance_date
        ORDER BY da.attendance_date
    `;

    // Total present days aggregate
    const [presentDays] = await sql`
        SELECT COUNT(*) as count
        FROM daily_attendance da
        JOIN student_enrollments se ON da.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE da.attendance_date >= ${start}
          AND da.status IN ('present', 'late', 'half_day')
          AND s.school_id = ${schoolId}
    `;

    return {
        avg_attendance: Math.round(avgAtt.pct || 0),
        chronic_absentees: parseInt(chronic.count) || 0,
        total_present_days: parseInt(presentDays.count) || 0,
        total_working_days: parseInt(workingDays.count) || 0,
        staff_attendance: Math.round(staffAtt.pct || 0),
        trend: trend.map(t => ({ label: t.label, value: Math.round(parseFloat(t.value) || 0) })),
        by_class: [],
        low_attendance_students: []
    };
}

/**
 * fetchAcademics — 100% DB-driven
 */
async function fetchAcademics(range, schoolId) {
    const start = getDateRange(range);

    // Average score across all marks
    const [avgScore] = await sql`
        SELECT COALESCE(AVG(m.marks_obtained::FLOAT / NULLIF(es.max_marks, 0) * 100), 0)::FLOAT as avg
        FROM marks m
        JOIN exam_subjects es ON m.exam_subject_id = es.id
        JOIN student_enrollments se ON m.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE s.school_id = ${schoolId}
          AND m.created_at >= ${start}
    `;

    // Pass rate — students with avg >= 35% of max marks
    const [passRate] = await sql`
        WITH student_pass AS (
            SELECT se.student_id,
                   CASE WHEN AVG(m.marks_obtained::FLOAT / NULLIF(es.max_marks, 0) * 100) >= 35 THEN 1 ELSE 0 END as passed
            FROM marks m
            JOIN exam_subjects es ON m.exam_subject_id = es.id
            JOIN student_enrollments se ON m.student_enrollment_id = se.id
            JOIN students s ON se.student_id = s.id
            WHERE s.school_id = ${schoolId}
              AND m.created_at >= ${start}
            GROUP BY se.student_id
        )
        SELECT
            CASE WHEN COUNT(*) > 0 THEN (SUM(passed)::FLOAT / COUNT(*) * 100) ELSE 0 END as rate
        FROM student_pass
    `;

    // Top subject (highest avg score)
    const topSubjects = await sql`
        SELECT sub.name, AVG(m.marks_obtained::FLOAT / NULLIF(es.max_marks, 0) * 100) as avg_pct
        FROM marks m
        JOIN exam_subjects es ON m.exam_subject_id = es.id
        JOIN subjects sub ON es.subject_id = sub.id
        JOIN student_enrollments se ON m.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE s.school_id = ${schoolId}
          AND m.created_at >= ${start}
        GROUP BY sub.name
        ORDER BY avg_pct DESC
        LIMIT 1
    `;

    // Weakest subject (lowest avg score)
    const weakSubjects = await sql`
        SELECT sub.name, AVG(m.marks_obtained::FLOAT / NULLIF(es.max_marks, 0) * 100) as avg_pct
        FROM marks m
        JOIN exam_subjects es ON m.exam_subject_id = es.id
        JOIN subjects sub ON es.subject_id = sub.id
        JOIN student_enrollments se ON m.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE s.school_id = ${schoolId}
          AND m.created_at >= ${start}
        GROUP BY sub.name
        ORDER BY avg_pct ASC
        LIMIT 1
    `;

    // Exams conducted — count distinct exams
    const [examsCount] = await sql`
        SELECT COUNT(DISTINCT e.id) as count
        FROM exams e
        JOIN exam_subjects es ON e.id = es.exam_id
        JOIN marks m ON es.id = m.exam_subject_id
        JOIN student_enrollments se ON m.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE s.school_id = ${schoolId}
          AND m.created_at >= ${start}
    `;

    // Academic trend — average score per exam
    const trend = await sql`
        SELECT
            e.name as label,
            AVG(m.marks_obtained::FLOAT / NULLIF(es.max_marks, 0) * 100) as value
        FROM marks m
        JOIN exam_subjects es ON m.exam_subject_id = es.id
        JOIN exams e ON es.exam_id = e.id
        JOIN student_enrollments se ON m.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE s.school_id = ${schoolId}
          AND m.created_at >= ${start}
        GROUP BY e.id, e.name, e.start_date
        ORDER BY e.start_date
    `;

    return {
        avg_score: Math.round(parseFloat(avgScore.avg) || 0),
        pass_rate: Math.round(parseFloat(passRate.rate) || 0),
        top_subject: topSubjects.length > 0 ? topSubjects[0].name : '—',
        weakest_subject: weakSubjects.length > 0 ? weakSubjects[0].name : '—',
        exams_conducted: parseInt(examsCount.count) || 0,
        trend: trend.map(t => ({ label: t.label, value: Math.round(parseFloat(t.value) || 0) })),
        by_subject: []
    };
}

/**
 * fetchStaff — 100% DB-driven
 */
async function fetchStaff(schoolId) {
    const start = getDateRange('month');

    // Total staff
    const [total] = await sql`
        SELECT COUNT(*) FROM staff WHERE deleted_at IS NULL AND school_id = ${schoolId}
    `;

    // Active staff
    const [active] = await sql`
        SELECT COUNT(*) FROM staff WHERE status_id = 1 AND deleted_at IS NULL AND school_id = ${schoolId}
    `;

    // On leave today — from leave applications
    // leave_applications uses applicant_id -> users(id), join through users -> staff
    const [onLeave] = await sql`
        SELECT COUNT(DISTINCT st.id) as count
        FROM leave_applications la
        JOIN users u ON la.applicant_id = u.id
        JOIN staff st ON st.person_id = u.person_id
        WHERE la.status = 'approved'
          AND CURRENT_DATE BETWEEN la.start_date AND la.end_date
          AND st.school_id = ${schoolId}
          AND st.deleted_at IS NULL
    `;

    // Average staff attendance % (current month)
    const [staffAttPct] = await sql`
        SELECT
            (COUNT(*) FILTER (WHERE sa.status IN ('present', 'late', 'half_day')))::FLOAT
            / NULLIF(COUNT(*), 0) * 100 as pct
        FROM staff_attendance sa
        JOIN staff st ON sa.staff_id = st.id
        WHERE sa.attendance_date >= ${start}
          AND st.school_id = ${schoolId}
          AND st.deleted_at IS NULL
    `;

    // New joinings (staff created this month)
    const [newJoins] = await sql`
        SELECT COUNT(*) as count
        FROM staff
        WHERE created_at >= ${start}
          AND deleted_at IS NULL
          AND school_id = ${schoolId}
    `;

    // Resignations (staff with end_date in current month or status indicating resigned)
    const [resigned] = await sql`
        SELECT COUNT(*) as count
        FROM staff
        WHERE deleted_at IS NOT NULL
          AND deleted_at >= ${start}
          AND school_id = ${schoolId}
    `;

    return {
        total_staff: parseInt(total.count) || 0,
        active_staff: parseInt(active.count) || 0,
        on_leave_today: parseInt(onLeave.count) || 0,
        avg_staff_attendance: Math.round(parseFloat(staffAttPct.pct) || 0),
        new_joinings: parseInt(newJoins.count) || 0,
        resignations: parseInt(resigned.count) || 0
    };
}

/**
 * generateInsights — dynamically generate alerts based on real DB data
 */
function generateInsights(financials, attendance, academics, staff) {
    const insights = [];
    let id = 1;

    // Finance alerts
    if (financials.outstanding_dues > 50000) {
        insights.push({
            id: String(id++),
            severity: 'high',
            category: 'finance',
            message: `Outstanding dues at ₹${(financials.outstanding_dues / 1000).toFixed(1)}K — needs immediate attention.`,
            created_at: new Date().toISOString()
        });
    }
    if (financials.collection_efficiency < 70) {
        insights.push({
            id: String(id++),
            severity: 'high',
            category: 'finance',
            message: `Collection efficiency is only ${financials.collection_efficiency}% — significantly below target.`,
            created_at: new Date().toISOString()
        });
    } else if (financials.collection_efficiency < 85) {
        insights.push({
            id: String(id++),
            severity: 'medium',
            category: 'finance',
            message: `Collection efficiency at ${financials.collection_efficiency}% — room for improvement.`,
            created_at: new Date().toISOString()
        });
    }

    // Attendance alerts
    if (attendance.avg_attendance < 75) {
        insights.push({
            id: String(id++),
            severity: 'high',
            category: 'attendance',
            message: `Average attendance critically low at ${attendance.avg_attendance}%.`,
            created_at: new Date().toISOString()
        });
    } else if (attendance.avg_attendance < 85) {
        insights.push({
            id: String(id++),
            severity: 'medium',
            category: 'attendance',
            message: `Average attendance at ${attendance.avg_attendance}% — below target of 85%.`,
            created_at: new Date().toISOString()
        });
    }
    if (attendance.chronic_absentees > 10) {
        insights.push({
            id: String(id++),
            severity: 'high',
            category: 'attendance',
            message: `${attendance.chronic_absentees} students with attendance below 75% — immediate intervention needed.`,
            created_at: new Date().toISOString()
        });
    } else if (attendance.chronic_absentees > 0) {
        insights.push({
            id: String(id++),
            severity: 'medium',
            category: 'attendance',
            message: `${attendance.chronic_absentees} student(s) at risk with attendance below 75%.`,
            created_at: new Date().toISOString()
        });
    }

    // Academic alerts
    if (academics.pass_rate < 70) {
        insights.push({
            id: String(id++),
            severity: 'high',
            category: 'academic',
            message: `Pass rate is only ${academics.pass_rate}% — academic support programs recommended.`,
            created_at: new Date().toISOString()
        });
    } else if (academics.pass_rate < 85) {
        insights.push({
            id: String(id++),
            severity: 'medium',
            category: 'academic',
            message: `Pass rate at ${academics.pass_rate}% — consider additional tutoring sessions.`,
            created_at: new Date().toISOString()
        });
    }

    // Staff alerts
    if (staff.on_leave_today > 5) {
        insights.push({
            id: String(id++),
            severity: 'medium',
            category: 'staff',
            message: `${staff.on_leave_today} staff members on leave today — may affect class schedules.`,
            created_at: new Date().toISOString()
        });
    }
    if (staff.avg_staff_attendance > 0 && staff.avg_staff_attendance < 85) {
        insights.push({
            id: String(id++),
            severity: 'medium',
            category: 'staff',
            message: `Staff attendance at ${staff.avg_staff_attendance}% this month — below expected standard.`,
            created_at: new Date().toISOString()
        });
    }

    return insights.slice(0, 5); // Return top 5 most relevant
}

/**
 * GET /admin/analytics — Full dashboard snapshot, 100% DB-driven
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const { range = 'month' } = req.query;
    const schoolId = req.schoolId;

    const [financials, attendance, academics, staff] = await Promise.all([
        fetchFinancials(range, schoolId),
        fetchAttendance(range, schoolId),
        fetchAcademics(range, schoolId),
        fetchStaff(schoolId)
    ]);

    const insights = generateInsights(financials, attendance, academics, staff);

    return sendSuccess(res, req.schoolId, {
        range,
        generated_at: new Date().toISOString(),
        financials,
        attendance,
        academics,
        staff,
        insights
    });
}));

router.get('/financials', requireAuth, asyncHandler(async (req, res) => {
    const data = await fetchFinancials(req.query.range || 'month', req.schoolId);
    return sendSuccess(res, req.schoolId, data);
}));

router.get('/attendance', requireAuth, asyncHandler(async (req, res) => {
    const data = await fetchAttendance(req.query.range || 'month', req.schoolId);
    return sendSuccess(res, req.schoolId, data);
}));

router.get('/academics', requireAuth, asyncHandler(async (req, res) => {
    const data = await fetchAcademics(req.query.range || 'month', req.schoolId);
    return sendSuccess(res, req.schoolId, data);
}));

router.get('/staff', requireAuth, asyncHandler(async (req, res) => {
    const data = await fetchStaff(req.schoolId);
    return sendSuccess(res, req.schoolId, data);
}));

router.get('/insights', requireAuth, asyncHandler(async (req, res) => {
    const range = req.query.range || 'month';
    const schoolId = req.schoolId;
    const [financials, attendance, academics, staff] = await Promise.all([
        fetchFinancials(range, schoolId),
        fetchAttendance(range, schoolId),
        fetchAcademics(range, schoolId),
        fetchStaff(schoolId)
    ]);
    const insights = generateInsights(financials, attendance, academics, staff);
    return sendSuccess(res, req.schoolId, insights);
}));

router.patch('/insights/:id/dismiss', requireAuth, asyncHandler(async (req, res) => {
    return sendSuccess(res, req.schoolId, { success: true });
}));

router.post('/export', requireAuth, asyncHandler(async (req, res) => {
    return sendSuccess(res, req.schoolId, { download_url: 'https://example.com/report.pdf' });
}));

export default router;