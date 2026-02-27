import express from 'express';
import sql from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

/**
 * GET /school-settings
 * Public endpoint — returns school branding info (name, address, phone, etc.)
 * Used by PDFs, receipts, report cards, and the mobile app header.
 */
router.get('/', asyncHandler(async (req, res) => {
    const rows = await sql`
        SELECT key, value FROM school_settings
    `;

    // Convert rows to a flat object for easy consumption
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }

    res.json(settings);
}));

/**
 * PUT /school-settings
 * Admin-only — update school settings
 */
router.put('/', requirePermission('admin.manage'), asyncHandler(async (req, res) => {
    const updates = req.body; // { school_name: 'XYZ School', school_address: '...' }

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Request body must be a non-empty object of key-value pairs' });
    }

    const validKeys = [
        'school_name', 'school_address', 'school_phone', 'school_email',
        'school_website', 'school_logo_url', 'school_tagline',
        'school_affiliation', 'school_principal'
    ];

    for (const [key, value] of Object.entries(updates)) {
        if (!validKeys.includes(key)) {
            return res.status(400).json({ error: `Invalid setting key: ${key}` });
        }

        await sql`
            INSERT INTO school_settings (key, value, updated_at)
            VALUES (${key}, ${value}, now())
            ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
        `;
    }

    // Return updated settings
    const rows = await sql`SELECT key, value FROM school_settings`;
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }

    res.json({ message: 'Settings updated', settings });
}));

export default router;
