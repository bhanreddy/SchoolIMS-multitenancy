import express from 'express';
import sql from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /admin/analytics/risk
 * Get student risk profiles based on Attendance, Marks, and Discipline
 */
router.get('/risk', requireAuth, asyncHandler(async (req, res) => {
    // 1. Fetch Risk Data Summary
    // We analyze:
    // - Attendance < 75% (Critical), < 85% (Warning)
    // - Failed Subjects (Marks < 35)
    // - Discipline Issues (derived from Complaints with 'high' or 'urgent' priority)

    const students = await sql`
        WITH attendance_stats AS (
            SELECT 
                se.student_id,
                COUNT(*) FILTER (WHERE da.status IN ('present', 'late', 'half_day'))::FLOAT / NULLIF(COUNT(*), 0) * 100 as attendance_pct
            FROM daily_attendance da
            JOIN student_enrollments se ON da.student_enrollment_id = se.id
            WHERE da.attendance_date > CURRENT_DATE - INTERVAL '60 days'
            GROUP BY se.student_id
        ),
        academic_stats AS (
            SELECT 
                m.student_enrollment_id,
                COUNT(*) FILTER (WHERE m.marks_obtained < 35) as failed_subjects,
                json_agg(s.name) FILTER (WHERE m.marks_obtained < 35) as failed_subject_names
            FROM marks m
            JOIN exam_subjects es ON m.exam_subject_id = es.id
            JOIN subjects s ON es.subject_id = s.id
            WHERE m.created_at > CURRENT_DATE - INTERVAL '6 months'
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
                    SELECT (m.marks_obtained / es.max_marks * 100)::INT as pct
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
    `;

    const riskProfiles = students.map(s => {
        let riskLevel = 'SAFE';
        let factors = [];

        // Logic
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
            // Access nested json array if necessary, or just use 0 index if it works directly
            const subject = Array.isArray(s.failed_names) ? s.failed_names[0] : '';
            factors.push(`Failed ${subject}`);
        }

        if (s.discipline_severity >= 2) { // Critical/Urgent
            riskLevel = 'CRITICAL';
            factors.push('Discipline Issues');
        } else if (s.discipline_severity === 1) { // High
            if (riskLevel !== 'CRITICAL') riskLevel = 'WARNING';
            factors.push('Behavior Warning');
        }

        return {
            id: s.id,
            name: s.name,
            // Only using first part of ID for brevity if needed, but full ID is fine
            class: s.class_name,
            riskLevel,
            factors,
            trend: s.trend && s.trend.length > 0 ? s.trend.reverse() : [0, 0, 0, 0, 0] // Reverse to show chronological left-to-right if UI expects it? Usually charts are left=oldest? Assuming fetch DESC means [newest, ..., oldest]. So reverse to [oldest, ..., newest].
        };
    });

    // Sort CRITICAL first
    const sorted = riskProfiles.sort((a, b) => {
        const order = { 'CRITICAL': 0, 'WARNING': 1, 'SAFE': 2 };
        return order[a.riskLevel] - order[b.riskLevel];
    });

    res.json(sorted);
}));

/**
 * GET /admin/analytics/heatmap
 * Avg marks by Class & Subject
 */
router.get('/heatmap', requireAuth, asyncHandler(async (req, res) => {
    // Aggregate avg marks
    const stats = await sql`
        SELECT 
            c.name as class_name,
            sub.name as subject_name,
            AVG(m.marks_obtained / es.max_marks * 100)::INT as avg_pct
        FROM marks m
        JOIN exam_subjects es ON m.exam_subject_id = es.id
        JOIN subjects sub ON es.subject_id = sub.id
        JOIN student_enrollments se ON m.student_enrollment_id = se.id
        JOIN class_sections cs ON se.class_section_id = cs.id
        JOIN classes c ON cs.class_id = c.id
        WHERE m.created_at > CURRENT_DATE - INTERVAL '1 year'
        GROUP BY c.name, sub.name
        ORDER BY c.name, sub.name
    `;

    // Transform to Heatmap format
    // { classes: [], subjects: [], data: { ClassA: { Math: 80 } } }

    const classes = [...new Set(stats.map(s => s.class_name))];
    const subjects = [...new Set(stats.map(s => s.subject_name))];
    const data = {};

    classes.forEach(c => {
        data[c] = {};
        subjects.forEach(s => data[c][s] = 0); // Init
    });

    stats.forEach(r => {
        if (data[r.class_name]) {
            data[r.class_name][r.subject_name] = r.avg_pct;
        }
    });

    res.json({ classes, subjects, data });
}));

/**
 * GET /admin/analytics/talking-points/:studentId
 * Generate summary
 */
router.get('/talking-points/:id', requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1. Fetch Student Details
    // Accepts UUID or admission_no
    const [student] = await sql`
        SELECT s.id, p.display_name, s.admission_no
        FROM students s JOIN persons p ON s.person_id = p.id
        WHERE s.id::text = ${id} OR s.admission_no = ${id}
        LIMIT 1
    `;

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // 2. Fetch Stats
    // Complaint count
    const [complaintStats] = await sql`
        SELECT COUNT(*) as count 
        FROM complaints 
        WHERE raised_for_student_id = ${student.id}
    `;

    // Failed subjects
    const failedSubjects = await sql`
        SELECT s.name
        FROM marks m
        JOIN exam_subjects es ON m.exam_subject_id = es.id
        JOIN subjects s ON es.subject_id = s.id
        JOIN student_enrollments se ON m.student_enrollment_id = se.id
        WHERE se.student_id = ${student.id} 
          AND m.marks_obtained < 35
        ORDER BY m.created_at DESC
        LIMIT 5
    `;

    // Attendance
    const [attendance] = await sql`
        SELECT 
            COUNT(*) FILTER (WHERE da.status IN ('present', 'late', 'half_day'))::FLOAT / NULLIF(COUNT(*), 0) * 100 as pct
        FROM daily_attendance da
        JOIN student_enrollments se ON da.student_enrollment_id = se.id
        WHERE se.student_id = ${student.id}
          AND da.attendance_date > CURRENT_DATE - INTERVAL '60 days'
    `;

    // 3. Generate Points
    const points = [];
    points.push(`Student: ${student.display_name} (${student.admission_no})`);

    // Academic
    if (failedSubjects.length > 0) {
        const subjects = failedSubjects.map(f => f.name).join(', ');
        points.push(`Recent struggles in: ${subjects}.`);
    } else {
        points.push('Recent academic performance is satisfying (Passing all subjects).');
    }

    // Attendance
    const attPct = attendance && attendance.pct ? attendance.pct : 100;
    if (attPct < 75) {
        points.push(`Attendance is CRITICAL (${attPct.toFixed(1)}%). Immediate attention required.`);
    } else if (attPct < 85) {
        points.push(`Attendance is low (${attPct.toFixed(1)}%). Monitor closely.`);
    } else {
        points.push(`Good attendance record (${attPct.toFixed(1)}%).`);
    }

    // Behavioral
    if (complaintStats.count > 0) {
        points.push(`Has ${complaintStats.count} reported behavior incidents/complaints.`);
    }

    res.json(points);
}));

export default router;
