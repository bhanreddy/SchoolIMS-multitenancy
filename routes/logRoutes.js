import express from 'express';
import fs from 'fs';

const router = express.Router();

router.post('/', (req, res) => {
    const { msg, data } = req.body;
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - [CLIENT] ${msg} ${data ? JSON.stringify(data) : ''}\n`;

    try {
        fs.appendFileSync('debug_log.txt', logEntry);
        console.log('[CLIENT LOG]', msg);
    } catch (err) {
        console.error('Failed to write client log', err);
    }

    res.status(200).send('Logged');
});

export default router;
