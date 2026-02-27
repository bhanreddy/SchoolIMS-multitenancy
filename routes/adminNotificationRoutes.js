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

export default router;
