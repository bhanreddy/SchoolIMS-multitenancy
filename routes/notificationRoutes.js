
import express from 'express';
import { sendTemplatedNotification } from '../services/notificationService.js';
import { NotificationTypes } from '../services/notificationTemplateService.js';
import sql from '../db.js';

const router = express.Router();

router.post('/attendance', async (req, res, next) => {
    try {
        const { student_id, student_name, status, date } = req.body;

        if (!student_id || !status) {
            return res.status(400).json({ error: 'Missing student_id or status' });
        }

        console.log(`Processing attendance notification for Student: ${student_id} (${student_name}), Status: ${status}`);

        // 1. Find Parents linked to the student
        const parents = await sql`
      SELECT 
        u.id as user_id, 
        u.preferred_language
      FROM student_parents sp
      JOIN parents par ON sp.parent_id = par.id
      JOIN users u ON par.person_id = u.person_id
      WHERE sp.student_id = ${student_id}
      AND u.account_status = 'active'
    `;

        if (!parents || parents.length === 0) {
            console.log('No registered parent users found for this student.');
            return res.status(200).json({ message: 'No parents found', success: false });
        }

        const results = [];
        const isAbsent = status.toLowerCase() === 'absent';
        const notificationDate = date || new Date().toISOString().split('T')[0];

        // 2. Send notification to each parent
        for (const parent of parents) {
            // Get tokens for this user
            const devices = await sql`
        SELECT fcm_token FROM user_devices WHERE user_id = ${parent.user_id}
      `;

            const tokens = devices.map(d => d.fcm_token);

            if (tokens.length > 0) {
                let response;
                // Create targetUsers array mirroring the tokens array for accurate logging
                const targetUsers = tokens.map(() => ({ id: parent.user_id, role: 'parent' }));

                if (isAbsent) {
                    response = await sendTemplatedNotification(
                        tokens,
                        NotificationTypes.ATTENDANCE_ABSENT,
                        { date: notificationDate },
                        targetUsers
                    );
                } else {
                    // Fallback for Present/Late using GENERAL template if needed
                    // Using GENERAL as per request for "no specific category applies"
                    response = await sendTemplatedNotification(
                        tokens,
                        NotificationTypes.GENERAL,
                        { message: `${student_name} is marked ${status} today.` },
                        targetUsers
                    );
                }

                // Check if blocked by killswitch or rate limit
                if (response.blocked) {
                    results.push({ parent: parent.user_id, success: false, reason: 'Blocked by policy' });
                } else {
                    results.push({ parent: parent.user_id, success: true, count: response.successCount });
                }
            } else {
                results.push({ parent: parent.user_id, success: false, reason: 'No tokens' });
            }
        }

        res.json({ message: 'Notifications processed', results });

    } catch (error) {
        next(error);
    }
});

router.post('/register', async (req, res, next) => {
    try {
        // identifyUser middleware populates req.user
        const { fcm_token, platform } = req.body;
        const user_id = req.user?.id;

        if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
        if (!fcm_token) return res.status(400).json({ error: 'Token required' });

        await sql`
      INSERT INTO user_devices (user_id, fcm_token, platform, last_used_at)
      VALUES (${user_id}, ${fcm_token}, ${platform || 'unknown'}, now())
      ON CONFLICT (user_id, fcm_token) 
      DO UPDATE SET last_used_at = now(), platform = EXCLUDED.platform
    `;

        res.json({ success: true, message: 'Token registered' });
    } catch (error) {
        next(error);
    }
});

router.post('/unregister', async (req, res, next) => {
    try {
        const { fcm_token } = req.body;
        const user_id = req.user?.id;

        if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
        if (!fcm_token) return res.status(200).json({ message: 'No token to unregister' }); // idempotent

        await sql`
      DELETE FROM user_devices WHERE user_id = ${user_id} AND fcm_token = ${fcm_token}
    `;

        res.json({ success: true, message: 'Token unregistered' });
    } catch (error) {
        next(error);
    }
});

export default router;
