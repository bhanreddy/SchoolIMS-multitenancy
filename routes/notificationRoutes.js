
import express from 'express';
import sql from '../db.js';
import { withRetry } from '../utils/retry.js';

const router = express.Router();


router.post('/register', async (req, res, next) => {
    try {
        // identifyUser middleware populates req.user
        const { fcm_token, platform } = req.body;
        const user_id = req.user?.id;

        if (!user_id) return res.status(401).json({ error: 'Unauthorized' });
        if (!fcm_token) return res.status(400).json({ error: 'Token required' });

        await withRetry(async () => {
            await sql`
                INSERT INTO user_devices (user_id, fcm_token, platform, last_used_at)
                VALUES (${user_id}, ${fcm_token}, ${platform || 'unknown'}, now())
                ON CONFLICT (user_id, fcm_token) 
                DO UPDATE SET last_used_at = now(), platform = EXCLUDED.platform
            `;
        }, { retries: 2, delayMs: 1000 });


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

        await withRetry(async () => {
            await sql`
                DELETE FROM user_devices WHERE user_id = ${user_id} AND fcm_token = ${fcm_token}
            `;
        }, { retries: 2, delayMs: 1000 });


        res.json({ success: true, message: 'Token unregistered' });
    } catch (error) {
        next(error);
    }
});

export default router;
