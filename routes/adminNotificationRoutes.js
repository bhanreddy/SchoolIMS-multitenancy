import express from 'express';
import sql from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendNotificationToUsers } from '../services/notificationService.js';


const router = express.Router();

/**
 * Helper: Check if Global Kill Switch is active
 */
async function isGlobalKillSwitchActive() {
    const config = await sql`SELECT value FROM notification_config WHERE key = 'kill_switch'`;
    return config.length > 0 && config[0].value.global === true;
}

/**
 * POST /fees/send-all
 * Triggers a batch fee reminder for all students (or filtered by class)
 */
router.post('/fees/send-all', requirePermission('fees.manage'), asyncHandler(async (req, res) => {
    const { month, filters, dryRun } = req.body;
    const adminId = req.user.id;

    if (!month) {
        return res.status(400).json({ error: 'Month is required (e.g., "September")' });
    }

    // 1. Guard: Kill Switch
    if (await isGlobalKillSwitchActive()) {
        return res.status(503).json({ error: 'Notifications are globally paused via Kill Switch.' });
    }

    // 2. Guard: Rate Limit (1 batch per day)
    // We check if there's any batch created in the last 24 hours
    const recentBatches = await sql`
        SELECT id FROM notification_batches 
        WHERE type = 'FEES' 
        AND created_at > now() - interval '24 hours'
        AND status != 'aborted'
    `;

    if (recentBatches.length > 0 && !dryRun) {
        return res.status(429).json({
            error: 'Rate limit exceeded. Only 1 bulk fee reminder allowed per 24 hours.'
        });
    }

    // 3. Guard: Idempotency (Check if specific month was already sent recently)
    // This overlaps with above but is more specific to the content
    const duplicateBatch = await sql`
        SELECT id FROM notification_batches
        WHERE type = 'FEES'
        AND filters->>'month' = ${month}
        AND created_at > now() - interval '30 days' -- Don't send for same month twice in 30 days
        AND status IN ('completed', 'processing')
    `;

    if (duplicateBatch.length > 0 && !dryRun) {
        return res.status(409).json({
            error: `Fee reminders for ${month} were already sent recently.`
        });
    }

    // 4. Resolve Target Students
    // Fetch students with active enrollment, joined with fee details if we want to calculate actual dues.
    // Requirement says: "Calculate due amount dynamically".
    let query = sql`
        SELECT 
            s.id as student_id, 
            s.admission_no,
            p.display_name,
            u_parent.id as parent_user_id,
            d.fcm_token
        FROM students s
        JOIN persons p ON s.person_id = p.id
        JOIN student_enrollments se ON s.id = se.student_id AND se.status = 'active'
        JOIN class_sections cs ON se.class_section_id = cs.id
        LEFT JOIN student_parents sp ON s.id = sp.student_id
        LEFT JOIN parents par ON sp.parent_id = par.id
        LEFT JOIN users u_parent ON par.person_id = u_parent.person_id
        LEFT JOIN user_devices d ON u_parent.id = d.user_id
        WHERE s.deleted_at IS NULL
        AND d.fcm_token IS NOT NULL -- Only target reachable users
    `;

    // Apply Filters (Class)
    if (filters && filters.class_id) {
        query = sql`${query} AND cs.class_id = ${filters.class_id}`;
    }

    // execute query
    const targets = await query;
    const uniqueTargets = new Map(); // Map student_id -> { student data, tokens: [] }

    // Group tokens by student (since one student can have multiple parents/devices)
    targets.forEach(row => {
        if (!uniqueTargets.has(row.student_id)) {
            uniqueTargets.set(row.student_id, {
                student_id: row.student_id,
                name: row.display_name,
                admission_no: row.admission_no,
                tokens: new Set(),
                parent_user_ids: new Set()
            });
        }
        if (row.fcm_token) uniqueTargets.get(row.student_id).tokens.add(row.fcm_token);
        if (row.parent_user_id) uniqueTargets.get(row.student_id).parent_user_ids.add(row.parent_user_id);
    });

    const totalStudents = uniqueTargets.size;

    if (dryRun) {
        return res.json({
            message: 'Dry run successful',
            total_students: totalStudents,
            sample_message: `Fee Reminder: ₹[Amount] due for ${month}.`
        });
    }

    // 5. Create Batch Record
    const [batch] = await sql`
        INSERT INTO notification_batches (admin_id, type, filters, status, total_targets)
        VALUES (${adminId}, 'FEES', ${JSON.stringify({ month, ...filters })}, 'processing', ${totalStudents})
        RETURNING id
    `;

    // 6. Start Async Processing (Fire and Forget)
    processBatch(batch.id, uniqueTargets, month, adminId).catch(async err => {
        console.error(`Batch ${batch.id} failed fatally:`, err);
        await sql`UPDATE notification_batches SET status = 'failed', failure_count = failure_count + 1 WHERE id = ${batch.id}`;
    });

    res.json({
        message: 'Batch processing started',
        batch_id: batch.id,
        total_targets: totalStudents
    });
}));

/**
 * Background Processor for Batches
 */
async function processBatch(batchId, targetMap, month, adminId) {
    const CHUNK_SIZE = 50;
    const targets = Array.from(targetMap.values());
    let sentCount = 0;
    let failureCount = 0;

    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
        // Check if aborted
        const [statusCheck] = await sql`SELECT status FROM notification_batches WHERE id = ${batchId}`;
        if (statusCheck.status === 'aborted') {
            console.log(`Batch ${batchId} aborted.`);
            return;
        }

        const chunk = targets.slice(i, i + CHUNK_SIZE);

        // Process Chunk Parallel
        const promises = chunk.map(async (student) => {
            try {
                // 1. Calculate Dues
                // We need to fetch actual due amount for this student
                // Querying DB inside loop is not ideal but needed for dynamic amount "₹{{amount}}"
                // Optimization: Could pre-fetch in bulk, but logic is complex.
                const [dues] = await sql`
                    SELECT COALESCE(SUM(amount_due - discount - amount_paid), 0) as balance
                    FROM student_fees
                    WHERE student_id = ${student.student_id}
                    AND status IN ('pending', 'partial', 'overdue')
                `;

                const amountDue = parseFloat(dues.balance);
                if (amountDue <= 0) return; // Skip if no dues (or handling "Upcoming"? Req says "Due for {{month}}")

                const userIds = Array.from(student.parent_user_ids);

                // Simpler: Just resolve users and send.
                if (userIds.length > 0) {
                    const response = await sendNotificationToUsers(
                        userIds,
                        'FEE_REMINDER',
                        { message: `Fee Reminder: ₹${amountDue.toFixed(2)} due for ${month}.` }
                    );

                    if (response && response.successCount > 0) sentCount += response.successCount;
                    if (response && response.failureCount > 0) failureCount += response.failureCount;
                }

            } catch (err) {
                console.error(`Failed to process student ${student.student_id}:`, err);
                failureCount++;
            }
        });

        await Promise.all(promises);

        // Update Progress
        await sql`
            UPDATE notification_batches 
            SET sent_count = ${sentCount}, failure_count = ${failureCount}
            WHERE id = ${batchId}
        `;
    }

    await sql`
        UPDATE notification_batches 
        SET status = 'completed', updated_at = now()
        WHERE id = ${batchId}
    `;
}

/**
 * POST /test-trigger
 * Global broadcaster used specifically for testing notification channels & sounds across ALL students
 */
router.post('/test-trigger', requirePermission('dashboard.view'), asyncHandler(async (req, res) => {
    const { type } = req.body;
    const adminId = req.user.id;

    if (!type) {
        return res.status(400).json({ error: 'notification type is required' });
    }

    if (await isGlobalKillSwitchActive()) {
        return res.status(503).json({ error: 'Notifications are globally paused via Kill Switch.' });
    }

    // Dynamically Resolve Target Users based on the requested broadcast type
    let recipients = [];

    if (type === 'ATTENDANCE_ABSENT' || type === 'ATTENDANCE_PRESENT') {
        const targetStatus = type === 'ATTENDANCE_ABSENT' ? 'absent' : 'present';
        recipients = await sql`
            SELECT DISTINCT u.id
            FROM users u
            JOIN students s ON u.person_id = s.person_id
            JOIN student_enrollments se ON s.id = se.student_id
            JOIN daily_attendance da ON da.student_enrollment_id = se.id
            WHERE se.status = 'active'
              AND u.account_status = 'active'
              AND da.attendance_date = CURRENT_DATE
              AND da.status = ${targetStatus}
            UNION
            SELECT DISTINCT u.id
            FROM users u
            JOIN parents p ON u.person_id = p.person_id
            JOIN student_parents sp ON p.id = sp.parent_id
            JOIN students s ON sp.student_id = s.id
            JOIN student_enrollments se ON s.id = se.student_id
            JOIN daily_attendance da ON da.student_enrollment_id = se.id
            WHERE se.status = 'active'
              AND u.account_status = 'active'
              AND da.attendance_date = CURRENT_DATE
              AND da.status = ${targetStatus}
        `;
    } else if (type === 'FEE_REMINDER') {
        // Query to get distinct users and their pending balance
        recipients = await sql`
            WITH pending_students AS (
                SELECT student_id, SUM(amount_due - discount - amount_paid) as balance
                FROM student_fees 
                WHERE status IN ('pending', 'overdue', 'partial')
                GROUP BY student_id
                HAVING SUM(amount_due - discount - amount_paid) > 0
            )
            SELECT DISTINCT u.id, ps.balance
            FROM users u
            JOIN students s ON u.person_id = s.person_id
            JOIN pending_students ps ON s.id = ps.student_id
            WHERE u.account_status = 'active'
            UNION
            SELECT DISTINCT u.id, ps.balance
            FROM users u
            JOIN parents p ON u.person_id = p.person_id
            JOIN student_parents sp ON p.id = sp.parent_id
            JOIN pending_students ps ON sp.student_id = ps.student_id
            WHERE u.account_status = 'active'
        `;
    } else {
        // Fallback generic broadast for arbitrary test signals (e.g. Notices, Results logic)
        recipients = await sql`
            SELECT DISTINCT u.id
            FROM users u
            JOIN students s ON u.person_id = s.person_id
            JOIN student_enrollments se ON s.id = se.student_id
            WHERE se.status = 'active'
              AND u.account_status = 'active'
            UNION
            SELECT DISTINCT u.id
            FROM users u
            JOIN parents p ON u.person_id = p.person_id
            JOIN student_parents sp ON p.id = sp.parent_id
            JOIN students s ON sp.student_id = s.id
            JOIN student_enrollments se ON s.id = se.student_id
            WHERE se.status = 'active'
              AND u.account_status = 'active'
        `;
    }

    const totalUsers = recipients.length;

    if (totalUsers === 0) {
        return res.status(200).json({ message: 'No students found matching this criteria (e.g., no absentees today).', batch_id: null, total_targets: 0 });
    }

    const [batch] = await sql`
        INSERT INTO notification_batches (admin_id, type, filters, status, total_targets)
        VALUES (${adminId}, 'TEST_TRIGGER', ${JSON.stringify({ type })}, 'processing', ${totalUsers})
        RETURNING id
    `;

    // Process Async
    (async () => {
        try {
            let sentCount = 0;
            let failureCount = 0;

            if (type === 'FEE_REMINDER') {
                const CHUNK_SIZE = 50;
                for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
                    const chunk = recipients.slice(i, i + CHUNK_SIZE);
                    await Promise.all(chunk.map(async (r) => {
                        const amt = parseFloat(r.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        const msg = `Gentle reminder: Your child has pending fees of <font color="red">₹${amt}</font> due for this active term.`;
                        const payload = { message: msg };

                        const response = await sendNotificationToUsers([r.id], type, payload);
                        if (response?.successCount) sentCount += response.successCount;
                        if (response?.failureCount) failureCount += response.failureCount;
                    }));
                }
            } else {
                const userIds = recipients.map(r => r.id);

                let payload = {};
                const today = new Date().toISOString().split('T')[0];

                if (type === 'ATTENDANCE_ABSENT') {
                    payload = { date: today };
                } else if (type === 'ATTENDANCE_PRESENT') {
                    payload = { message: 'Your child has arrived at school and is marked present.' };
                } else if (type === 'DIARY_UPDATED') {
                    payload = { message: "Please check today's diary to ensure your child is completing their work properly." };
                } else if (type === 'RESULT_RELEASED') {
                    payload = { message: "New exam results for your child are now available in the portal." };
                } else if (type === 'NOTICE_ADMIN_STUDENT') {
                    payload = { message: "A new important notice has been issued by the administration." };
                } else if (type === 'TIMETABLE_UPDATED') {
                    payload = { message: "The class timetable has been updated. Please check the latest schedule." };
                } else {
                    payload = { message: `System notification check for ${type}.`, date: today };
                }

                const response = await sendNotificationToUsers(userIds, type, payload);
                sentCount = response?.successCount || 0;
                failureCount = response?.failureCount || 0;
            }

            await sql`
                UPDATE notification_batches 
                SET status = 'completed', sent_count = ${sentCount}, failure_count = ${failureCount}, updated_at = now()
                WHERE id = ${batch.id}
            `;
        } catch (err) {
            console.error(`Batch ${batch.id} failed:`, err);
            await sql`UPDATE notification_batches SET status = 'failed' WHERE id = ${batch.id}`;
        }
    })();

    res.json({ message: 'Global test broadcast started', batch_id: batch.id, total_targets: totalUsers });
}));

/**
 * POST /diary/send-all
 * Triggers diary notifications for a specific class section and date
 */
router.post('/diary/send-all', requirePermission('diary.manage'), asyncHandler(async (req, res) => {
    const { class_section_id, date, dryRun } = req.body;
    const adminId = req.user.id;

    if (!class_section_id || !date) {
        return res.status(400).json({ error: 'class_section_id and date are required' });
    }

    if (await isGlobalKillSwitchActive()) {
        return res.status(503).json({ error: 'Notifications are globally paused via Kill Switch.' });
    }

    // Resolve Target Users
    const recipients = await sql`
        SELECT DISTINCT u.id
        FROM users u
        JOIN students s ON u.person_id = s.person_id
        JOIN student_enrollments se ON s.id = se.student_id
        WHERE se.class_section_id = ${class_section_id}
          AND se.status = 'active'
          AND u.account_status = 'active'
    UNION
        SELECT DISTINCT u.id
        FROM users u
        JOIN parents p ON u.person_id = p.person_id
        JOIN student_parents sp ON p.id = sp.parent_id
        JOIN students s ON sp.student_id = s.id
        JOIN student_enrollments se ON s.id = se.student_id
        WHERE se.class_section_id = ${class_section_id}
          AND se.status = 'active'
          AND u.account_status = 'active'
        `;

    const totalUsers = recipients.length;

    if (dryRun) {
        return res.json({
            message: 'Dry run successful',
            total_users: totalUsers,
            sample_message: `New diary entry posted for ${date}.`
        });
    }

    if (totalUsers === 0) {
        return res.status(400).json({ error: 'No reachable users found for this class section.' });
    }

    const [batch] = await sql`
        INSERT INTO notification_batches(admin_id, type, filters, status, total_targets)
    VALUES(${adminId}, 'DIARY', ${JSON.stringify({ class_section_id, date })}, 'processing', ${totalUsers})
        RETURNING id
    `;

    // Process Async
    (async () => {
        try {
            const userIds = recipients.map(r => r.id);
            const response = await sendNotificationToUsers(userIds, 'DIARY_UPDATED', { message: `New diary entry posted for ${date}.` });
            const sentCount = response?.successCount || 0;
            const failureCount = response?.failureCount || 0;

            await sql`
                UPDATE notification_batches 
                SET status = 'completed', sent_count = ${sentCount}, failure_count = ${failureCount}, updated_at = now()
                WHERE id = ${batch.id}
    `;
        } catch (err) {
            console.error(`Batch ${batch.id} failed: `, err);
            await sql`UPDATE notification_batches SET status = 'failed' WHERE id = ${batch.id} `;
        }
    })();

    res.json({ message: 'Diary batch processing started', batch_id: batch.id, total_targets: totalUsers });
}));

/**
 * POST /results/send-all
 * Triggers exam result release notifications
 */
router.post('/results/send-all', requirePermission('results.publish'), asyncHandler(async (req, res) => {
    const { exam_id, class_id, dryRun } = req.body;
    const adminId = req.user.id;

    if (!exam_id || !class_id) {
        return res.status(400).json({ error: 'exam_id and class_id are required' });
    }

    if (await isGlobalKillSwitchActive()) {
        return res.status(503).json({ error: 'Notifications are globally paused via Kill Switch.' });
    }

    const [exam] = await sql`SELECT name FROM exams WHERE id = ${exam_id} `;
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const recipients = await sql`
        SELECT DISTINCT u.id
        FROM users u
        JOIN students s ON u.person_id = s.person_id
        JOIN student_enrollments se ON s.id = se.student_id
        JOIN class_sections cs ON se.class_section_id = cs.id
        WHERE cs.class_id = ${class_id}
          AND se.status = 'active'
          AND u.account_status = 'active'
    UNION
        SELECT DISTINCT u.id
        FROM users u
        JOIN parents p ON u.person_id = p.person_id
        JOIN student_parents sp ON p.id = sp.parent_id
        JOIN students s ON sp.student_id = s.id
        JOIN student_enrollments se ON s.id = se.student_id
        JOIN class_sections cs ON se.class_section_id = cs.id
        WHERE cs.class_id = ${class_id}
          AND se.status = 'active'
          AND u.account_status = 'active'
        `;

    const totalUsers = recipients.length;

    if (dryRun) {
        return res.json({
            message: 'Dry run successful',
            total_users: totalUsers,
            sample_message: `Results for ${exam.name} have been published.`
        });
    }

    if (totalUsers === 0) {
        return res.status(400).json({ error: 'No reachable users found for this class.' });
    }

    const [batch] = await sql`
        INSERT INTO notification_batches(admin_id, type, filters, status, total_targets)
    VALUES(${adminId}, 'RESULTS', ${JSON.stringify({ exam_id, class_id })}, 'processing', ${totalUsers})
        RETURNING id
    `;

    (async () => {
        try {
            const userIds = recipients.map(r => r.id);
            const response = await sendNotificationToUsers(userIds, 'RESULT_RELEASED', { message: `Results for ${exam.name} have been published.` });
            const sentCount = response?.successCount || 0;
            const failureCount = response?.failureCount || 0;

            await sql`
                UPDATE notification_batches 
                SET status = 'completed', sent_count = ${sentCount}, failure_count = ${failureCount}, updated_at = now()
                WHERE id = ${batch.id}
    `;
        } catch (err) {
            console.error(`Batch ${batch.id} failed: `, err);
            await sql`UPDATE notification_batches SET status = 'failed' WHERE id = ${batch.id} `;
        }
    })();

    res.json({ message: 'Results batch processing started', batch_id: batch.id, total_targets: totalUsers });
}));

/**
 * POST /notices/retrigger
 * Retriggers a notice notification
 */
router.post('/notices/retrigger', requirePermission('notices.manage'), asyncHandler(async (req, res) => {
    const { notice_id, dryRun } = req.body;
    const adminId = req.user.id;

    if (!notice_id) return res.status(400).json({ error: 'notice_id is required' });

    if (await isGlobalKillSwitchActive()) {
        return res.status(503).json({ error: 'Notifications are globally paused via Kill Switch.' });
    }

    const [notice] = await sql`SELECT title, audience, target_class_id FROM notices WHERE id = ${notice_id} `;
    if (!notice) return res.status(404).json({ error: 'Notice not found' });

    const safeAudience = notice.audience;
    const safeTargetClassId = notice.target_class_id;

    let recips = [];
    if (safeAudience === 'class' && safeTargetClassId) {
        recips = await sql`
           SELECT DISTINCT u.id FROM users u
           JOIN students s ON u.person_id = s.person_id JOIN student_enrollments se ON s.id = se.student_id JOIN class_sections cs ON se.class_section_id = cs.id
           WHERE cs.class_id = ${safeTargetClassId} AND se.status = 'active' AND u.account_status = 'active'
    UNION
           SELECT DISTINCT u.id FROM users u
           JOIN parents p ON u.person_id = p.person_id JOIN student_parents sp ON p.id = sp.parent_id JOIN students s ON sp.student_id = s.id JOIN student_enrollments se ON s.id = se.student_id JOIN class_sections cs ON se.class_section_id = cs.id
           WHERE cs.class_id = ${safeTargetClassId} AND se.status = 'active' AND u.account_status = 'active'
        `;
    } else if (safeAudience === 'all') {
        recips = await sql`
           SELECT DISTINCT u.id FROM users u
           JOIN students s ON u.person_id = s.person_id JOIN student_enrollments se ON s.id = se.student_id
           WHERE se.status = 'active' AND u.account_status = 'active'
    UNION
           SELECT DISTINCT u.id FROM users u
           JOIN parents p ON u.person_id = p.person_id JOIN student_parents sp ON p.id = sp.parent_id JOIN students s ON sp.student_id = s.id JOIN student_enrollments se ON s.id = se.student_id
           WHERE se.status = 'active' AND u.account_status = 'active'
        `;
    }

    const totalUsers = recips.length;

    if (dryRun) {
        return res.json({ message: 'Dry run successful', total_users: totalUsers, sample_message: `Important Notice: ${notice.title} ` });
    }

    if (totalUsers === 0) return res.status(400).json({ error: 'No reachable users found for this notice.' });

    const [batch] = await sql`
        INSERT INTO notification_batches(admin_id, type, filters, status, total_targets)
    VALUES(${adminId}, 'NOTICE', ${JSON.stringify({ notice_id })}, 'processing', ${totalUsers})
        RETURNING id
    `;

    (async () => {
        try {
            const userIds = recips.map(r => r.id);
            const response = await sendNotificationToUsers(userIds, 'NOTICE_ADMIN_STUDENT', { message: `Important Notice: ${notice.title} ` });
            const sentCount = response?.successCount || 0;
            const failureCount = response?.failureCount || 0;

            await sql`
                UPDATE notification_batches 
                SET status = 'completed', sent_count = ${sentCount}, failure_count = ${failureCount}, updated_at = now()
                WHERE id = ${batch.id}
    `;
        } catch (err) {
            console.error(`Batch ${batch.id} failed: `, err);
            await sql`UPDATE notification_batches SET status = 'failed' WHERE id = ${batch.id} `;
        }
    })();

    res.json({ message: 'Notice retrigger started', batch_id: batch.id, total_targets: totalUsers });
}));

export default router;
