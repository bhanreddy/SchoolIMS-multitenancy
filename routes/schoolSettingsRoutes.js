import express from 'express';
import sql from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// ── GET /school-settings ───────────────────────────────────────────────────────
// Returns school branding/config for the authenticated user's school only.
// SS1: Scoped to req.schoolId via WHERE clause.
// SS3: requireAuth + requirePermission guard.
//
// NOTE: this assumes school_settings has a school_id column.
// Schema: school_settings (school_id, key, value, updated_at)
// UNIQUE constraint: (school_id, key)
router.get(
  '/',
  requireAuth,
  requirePermission('admin.manage'),
  asyncHandler(async (req, res) => {
    const schoolId = req.schoolId;

    const rows = await sql`
      SELECT key, value
      FROM school_settings
      WHERE school_id = ${schoolId}
    `;

    // Convert to flat key-value object
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return sendSuccess(res, req.schoolId, settings);
  })
);

// ── PUT /school-settings ───────────────────────────────────────────────────────
// Admin-only — update school settings for the authenticated school only.
// SS2: UPSERT scoped to req.schoolId.
// SS3: requireAuth + requirePermission('admin.manage') guard.
router.put(
  '/',
  requireAuth,
  requirePermission('admin.manage'),
  asyncHandler(async (req, res) => {
    const schoolId = req.schoolId;
    const updates = req.body; // { school_name: 'XYZ', school_address: '...' }

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'Request body must be a non-empty object of key-value pairs',
      });
    }

    const validKeys = [
      'school_name',
      'school_address',
      'school_phone',
      'school_email',
      'school_website',
      'school_logo_url',
      'school_tagline',
      'school_affiliation',
      'school_principal',
    ];

    for (const [key, value] of Object.entries(updates)) {
      if (!validKeys.includes(key)) {
        return res.status(400).json({ error: `Invalid setting key: ${key}` });
      }

      // SS2: UPSERT with (school_id, key) unique constraint — no cross-tenant writes possible
      await sql`
        INSERT INTO school_settings (school_id, key, value, updated_at)
        VALUES (${schoolId}, ${key}, ${value}, now())
        ON CONFLICT (school_id, key)
        DO UPDATE SET
          value      = EXCLUDED.value,
          updated_at = now()
      `;
    }

    // Return updated settings for this school only
    const rows = await sql`
      SELECT key, value
      FROM school_settings
      WHERE school_id = ${schoolId}
    `;

    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return sendSuccess(res, req.schoolId, { message: 'Settings updated', settings });
  })
);

export default router;