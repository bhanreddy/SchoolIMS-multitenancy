/**
 * Middleware: requireSchoolId (formerly validateSchoolId)
 * SchoolIMS multi-tenant contract: school_id MUST be explicitly passed on every request.
 * - GET/DELETE: from req.query.school_id
 * - POST/PUT/PATCH: from req.body.school_id
 * Never infer from JWT, session, or auth context.
 */

/**
 * Extract school_id from request based on HTTP method.
 * @param {import('express').Request} req
 * @returns {string|null} Trimmed school_id or null if missing/empty
 */
export const getSchoolId = (req) => {
  const method = (req.method || '').toUpperCase();
  const raw =
    method === 'GET' || method === 'DELETE'
      ? req.query?.school_id
      : req.body?.school_id;

  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
};

/**
 * Middleware: requireSchoolId
 * Extracts school_id from query (GET/DELETE) or body (POST/PUT/PATCH).
 * Rejects with 400 if missing or empty. Sets req.schoolId on success.
 */
export const requireSchoolId = (req, res, next) => {
  const schoolId = getSchoolId(req);

  if (!schoolId) {
    return res.status(400).json({ success: false, error: 'school_id is required' });
  }

  req.schoolId = schoolId;
  next();
};

/**
 * Alias for backward compatibility. Use requireSchoolId for new code.
 * @deprecated Use requireSchoolId - this now enforces the same contract
 */
export const validateSchoolId = requireSchoolId;

export default requireSchoolId;
