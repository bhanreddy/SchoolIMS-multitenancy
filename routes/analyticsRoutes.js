import express from 'express';
import sql from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

const GEMINI_TIMEOUT_MS = 10_000;
let _geminiModel = null;

function getGeminiModel() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    if (!_geminiModel) {
        const genAI = new GoogleGenerativeAI(apiKey);
        _geminiModel = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    }
    return _geminiModel;
}

/** OPT-19: cache net-balance for identical school + date window (5 min). */
const _netBalanceCache = new Map();

/**
 * GET /admin/analytics/risk
 * AN1: scoped students query to school_id
 */
router.get('/risk', requireAuth, asyncHandler(async (req, res) => {
    const schoolId = req.schoolId;

    const students = await sql`
        WITH attendance_stats AS (
            SELECT
                se.student_id,
                COUNT(*) FILTER (WHERE da.status IN ('present', 'late', 'half_day'))::FLOAT / NULLIF(COUNT(*), 0) * 100 as attendance_pct
            FROM daily_attendance da
            JOIN student_enrollments se ON da.student_enrollment_id = se.id
            JOIN students s ON se.student_id = s.id
            WHERE da.attendance_date > CURRENT_DATE - INTERVAL '60 days'
              AND s.school_id = ${schoolId}
            GROUP BY se.student_id
        ),
        academic_stats AS (
            SELECT
                m.student_enrollment_id,
                COUNT(*) FILTER (WHERE m.marks_obtained < 35) as failed_subjects,
                json_agg(sub.name) FILTER (WHERE m.marks_obtained < 35) as failed_subject_names
            FROM marks m
            JOIN exam_subjects es ON m.exam_subject_id = es.id
            JOIN subjects sub ON es.subject_id = sub.id
            JOIN student_enrollments se ON m.student_enrollment_id = se.id
            JOIN students s ON se.student_id = s.id
            WHERE m.created_at > CURRENT_DATE - INTERVAL '6 months'
              AND s.school_id = ${schoolId}
            GROUP BY m.student_enrollment_id
        ),
        discipline_stats AS (
            SELECT
                c.raised_for_student_id as student_id,
                COUNT(*) as incident_count,
                MAX(CASE WHEN c.priority = 'urgent' THEN 2 WHEN c.priority = 'high' THEN 1 ELSE 0 END) as max_severity
            FROM complaints c
            WHERE c.created_at > CURRENT_DATE - INTERVAL '6 months'
              AND c.raised_for_student_id IS NOT NULL
              AND c.school_id = ${schoolId}
            GROUP BY c.raised_for_student_id
        )
        SELECT
            s.id,
            p.display_name as name,
            s.admission_no,
            c.name || ' ' || sec.name as class_name,
            COALESCE(att.attendance_pct, 100) as attendance_pct,
            COALESCE(acad.failed_subjects, 0) as failed_count,
            COALESCE(acad.failed_subject_names, '[]'::json) as failed_names,
            COALESCE(disc.incident_count, 0) as discipline_count,
            COALESCE(disc.max_severity, 0) as discipline_severity,
            (
                SELECT COALESCE(json_agg(t.pct), '[]'::json)
                FROM (
                    SELECT (m.marks_obtained::FLOAT / es.max_marks * 100)::INT as pct
                    FROM marks m
                    JOIN exam_subjects es ON m.exam_subject_id = es.id
                    WHERE m.student_enrollment_id = se.id
                    ORDER BY m.created_at DESC
                    LIMIT 5
                ) t
            ) as trend
        FROM students s
        JOIN persons p ON s.person_id = p.id
        JOIN student_enrollments se ON s.id = se.student_id AND se.status = 'active'
        JOIN class_sections cs ON se.class_section_id = cs.id
        JOIN classes c ON cs.class_id = c.id
        JOIN sections sec ON cs.section_id = sec.id
        LEFT JOIN attendance_stats att ON s.id = att.student_id
        LEFT JOIN academic_stats acad ON se.id = acad.student_enrollment_id
        LEFT JOIN discipline_stats disc ON s.id = disc.student_id
        WHERE s.deleted_at IS NULL
          AND s.school_id = ${schoolId}
    `;

    const riskProfiles = students.map(s => {
        let riskLevel = 'SAFE';
        let factors = [];

        if (s.attendance_pct < 75) {
            riskLevel = 'CRITICAL';
            factors.push(`Attendance ${(s.attendance_pct || 0).toFixed(0)}%`);
        } else if (s.attendance_pct < 85) {
            if (riskLevel !== 'CRITICAL') riskLevel = 'WARNING';
            factors.push(`Low Attendance`);
        }

        if (s.failed_count >= 2) {
            riskLevel = 'CRITICAL';
            factors.push(`${s.failed_count} Failed Subjects`);
        } else if (s.failed_count === 1) {
            if (riskLevel !== 'CRITICAL') riskLevel = 'WARNING';
            const subject = Array.isArray(s.failed_names) ? s.failed_names[0] : '';
            factors.push(`Failed ${subject}`);
        }

        if (s.discipline_severity >= 2) {
            riskLevel = 'CRITICAL';
            factors.push('Discipline Issues');
        } else if (s.discipline_severity === 1) {
            if (riskLevel !== 'CRITICAL') riskLevel = 'WARNING';
            factors.push('Behavior Warning');
        }

        return {
            id: s.id,
            name: s.name,
            class: s.class_name,
            riskLevel,
            factors,
            trend: s.trend && s.trend.length > 0 ? s.trend.reverse() : [0, 0, 0, 0, 0]
        };
    });

    const sorted = riskProfiles.sort((a, b) => {
        const order = { 'CRITICAL': 0, 'WARNING': 1, 'SAFE': 2 };
        return order[a.riskLevel] - order[b.riskLevel];
    });

    return sendSuccess(res, req.schoolId, sorted);
}));

/**
 * GET /admin/analytics/heatmap
 * AN2: scoped marks/students query to school_id
 */
router.get('/heatmap', requireAuth, asyncHandler(async (req, res) => {
    const schoolId = req.schoolId;

    const stats = await sql`
        SELECT
            c.name as class_name,
            sub.name as subject_name,
            AVG(m.marks_obtained::FLOAT / es.max_marks * 100)::INT as avg_pct
        FROM marks m
        JOIN exam_subjects es ON m.exam_subject_id = es.id
        JOIN subjects sub ON es.subject_id = sub.id
        JOIN student_enrollments se ON m.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        JOIN class_sections cs ON se.class_section_id = cs.id
        JOIN classes c ON cs.class_id = c.id
        WHERE m.created_at > CURRENT_DATE - INTERVAL '1 year'
          AND s.school_id = ${schoolId}
        GROUP BY c.name, sub.name
        ORDER BY c.name, sub.name
    `;

    const classes = [...new Set(stats.map(s => s.class_name))];
    const subjects = [...new Set(stats.map(s => s.subject_name))];
    const data = {};

    classes.forEach(c => {
        data[c] = {};
        subjects.forEach(s => data[c][s] = 0);
    });

    stats.forEach(r => {
        if (data[r.class_name]) {
            data[r.class_name][r.subject_name] = r.avg_pct;
        }
    });

    return sendSuccess(res, req.schoolId, { classes, subjects, data });
}));

/**
 * GET /admin/analytics/talking-points/:id
 * AN3: student lookup and all stats scoped to school_id
 */
router.get('/talking-points/:id', requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const schoolId = req.schoolId;

    // AN3: Ownership check — student must belong to this school
    const [student] = await sql`
        SELECT s.id, p.display_name, s.admission_no
        FROM students s JOIN persons p ON s.person_id = p.id
        WHERE (s.id::text = ${id} OR s.admission_no = ${id})
          AND s.school_id = ${schoolId}
        LIMIT 1
    `;

    if (!student) return res.status(404).json({ error: 'Student not found' });

    const [[complaintStats], failedSubjects, [attendance]] = await Promise.all([
        sql`
        SELECT COUNT(*)::int as count
        FROM complaints
        WHERE raised_for_student_id = ${student.id}
          AND school_id = ${schoolId}
    `,
        sql`
        SELECT sub.name
        FROM marks m
        JOIN exam_subjects es ON m.exam_subject_id = es.id
        JOIN subjects sub ON es.subject_id = sub.id
        JOIN student_enrollments se ON m.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE se.student_id = ${student.id}
          AND s.school_id = ${schoolId}
          AND m.marks_obtained < 35
        ORDER BY m.created_at DESC
        LIMIT 5
    `,
        sql`
        SELECT
            COUNT(*) FILTER (WHERE da.status IN ('present', 'late', 'half_day'))::FLOAT / NULLIF(COUNT(*), 0) * 100 as pct
        FROM daily_attendance da
        JOIN student_enrollments se ON da.student_enrollment_id = se.id
        JOIN students s ON se.student_id = s.id
        WHERE se.student_id = ${student.id}
          AND s.school_id = ${schoolId}
          AND da.attendance_date > CURRENT_DATE - INTERVAL '60 days'
    `,
    ]);

    const attPct = attendance && attendance.pct ? attendance.pct.toFixed(1) : 100;
    const subjects = failedSubjects.length > 0 ? [...new Set(failedSubjects.map(f => f.name))].join(', ') : 'None';

    const prompt = `
You are a senior academic counselor. Prepare a set of 3 to 4 professional talking points for a parent-teacher meeting regarding the student ${student.display_name}.
Context:
- Attendance: ${attPct}%
- Recent failed subjects: ${subjects}
- Behavioral incidents: ${complaintStats.count}

Instructions:
1. Be professional and encouraging.
2. Provide specific insights based on the stats.
3. RETURN ONLY A JSON ARRAY OF STRINGS.
   Example: ["Insight 1", "Insight 2", "Insight 3"]
4. DO NOT include any markdown code blocks.
`;

    let points = [];
    try {
        const model = getGeminiModel();

        const result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Gemini timeout')), GEMINI_TIMEOUT_MS)
            ),
        ]);
        let responseText = result.response.text().trim();

        const start = responseText.indexOf('[');
        const end = responseText.lastIndexOf(']');

        if (start === -1 || end === -1 || end < start) {
            throw new Error(`No JSON array found in response.`);
        }

        const jsonStr = responseText.substring(start, end + 1);
        points = JSON.parse(jsonStr);

        if (!Array.isArray(points)) {
            throw new Error("Parsed result is not an array");
        }
    } catch (aiError) {
        console.error("AI Insights Error:", aiError.message);
        points.push(`[Rule-based Analysis] for ${student.display_name}`);

        if (failedSubjects.length > 0) {
            points.push(`Student is struggling in ${subjects}. Recommend extra tutoring.`);
        } else {
            points.push('Student is passing all subjects with a stable academic record.');
        }

        if (parseFloat(attPct) < 75) {
            points.push(`Critical: Attendance at ${attPct}% is significantly below school standards.`);
        } else if (parseFloat(attPct) < 85) {
            points.push(`Warning: Attendance is low (${attPct}%). Regularity is advised.`);
        } else {
            points.push(`Positive: Consistent attendance maintained at ${attPct}%.`);
        }

        if (complaintStats.count > 0) {
            points.push(`Behavioral Note: ${complaintStats.count} complaints recorded recently.`);
        }
    }

    return sendSuccess(res, req.schoolId, points);
}));

/**
 * GET /admin/analytics/net-balance
 * AN4: All 3 financial sub-queries scoped to school_id
 */
router.get('/net-balance', requireAuth, asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    const schoolId = req.schoolId;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const cacheKey = `${schoolId}:${startDate}:${endDate}`;
    const cached = _netBalanceCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
        return sendSuccess(res, req.schoolId, cached.payload);
    }

    const [[feeStats], [salaryStats], [expenseStats]] = await Promise.all([
        sql`
        SELECT COALESCE(SUM(ft.amount), 0) as total
        FROM fee_transactions ft
        JOIN student_fees sf ON ft.student_fee_id = sf.id
        WHERE ft.paid_at BETWEEN ${startDate} AND ${endDate}::date + INTERVAL '1 day'
          AND sf.school_id = ${schoolId}
    `,
        sql`
        SELECT COALESCE(SUM(sp.net_salary), 0) as total
        FROM staff_payroll sp
        JOIN staff st ON sp.staff_id = st.id
        WHERE sp.status = 'paid'
          AND sp.payment_date BETWEEN ${startDate} AND ${endDate}
          AND st.school_id = ${schoolId}
    `,
        sql`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM expenses
        WHERE status = 'paid'
          AND expense_date BETWEEN ${startDate} AND ${endDate}
          AND school_id = ${schoolId}
    `,
    ]);

    const totalFee = parseFloat(feeStats.total);
    const totalSalary = parseFloat(salaryStats.total);
    const totalExpenses = parseFloat(expenseStats.total);
    const netBalance = totalFee - totalSalary - totalExpenses;

    const payload = { totalFee, totalSalary, totalExpenses, netBalance };
    _netBalanceCache.set(cacheKey, { payload, expiresAt: Date.now() + 5 * 60_000 });

    return sendSuccess(res, req.schoolId, payload);
}));

export default router;