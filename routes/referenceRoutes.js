import express from 'express';
import sql from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

/**
 * GET /reference/staff-designations
 * Get all staff designations
 */
router.get('/staff-designations', requireAuth, asyncHandler(async (req, res) => {
    // Some reference data might depend on schoolId if customized, but usually it's global or shared
    // Assuming staff_designations are global or associated with school if customized
    // We check if school_id exists in the staff_designations table
    const designations = await sql`
        SELECT id, name 
        FROM staff_designations 
        ORDER BY id ASC
    `;
    
    return sendSuccess(res, req.schoolId, designations);
}));

export default router;
