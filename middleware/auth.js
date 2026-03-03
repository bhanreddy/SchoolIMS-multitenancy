import { supabase } from '../db.js';
import sql from '../db.js';
import { withRetry } from '../utils/retry.js';

// ── In-Memory Token Cache ──────────────────────────────────────────────
// Caches verified token → user data to avoid repeated Supabase API calls.
// TTL: 5 minutes. Evicted on expiry or when cache grows too large.
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TOKEN_CACHE_MAX_SIZE = 500;

function getCachedUser(token) {
    const entry = tokenCache.get(token);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TOKEN_CACHE_TTL) {
        tokenCache.delete(token);
        return null;
    }
    return entry.user;
}

function setCachedUser(token, user) {
    // Evict oldest entries if cache is too large
    if (tokenCache.size >= TOKEN_CACHE_MAX_SIZE) {
        const firstKey = tokenCache.keys().next().value;
        tokenCache.delete(firstKey);
    }
    tokenCache.set(token, { user, timestamp: Date.now() });
}


// ── Middleware: identifyUser ───────────────────────────────────────────
// Verifies the Supabase JWT, fetches user roles/permissions, attaches to req.
// Uses token cache + retry logic to survive transient network issues.
export const identifyUser = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            req.user = null;
            return next();
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            req.user = null;
            return next();
        }

        // ── Check cache first ──
        const cached = getCachedUser(token);
        if (cached) {
            req.user = cached;
            return next();
        }

        // ── 1. Verify Token with Supabase (with retry) ──
        let user;
        try {
            const result = await withRetry(async () => {
                const { data, error } = await supabase.auth.getUser(token);
                if (error) throw error;
                return data;
            }, { retries: 2, delayMs: 800 });
            user = result.user;
        } catch (authErr) {
            // Distinguish network failure from invalid token
            const isNetworkError =
                authErr.code === 'ETIMEDOUT' ||
                authErr.code === 'UND_ERR_CONNECT_TIMEOUT' ||
                authErr.message?.includes('fetch failed') ||
                authErr.message?.includes('Connect Timeout') ||
                authErr.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';

            if (isNetworkError) {
                console.error('Auth Middleware: Supabase Auth unreachable after retries');
                // Return 503 Service Unavailable instead of silently setting user=null
                return res.status(503).json({ error: 'Auth service temporarily unavailable. Please retry.' });
            }
            // Token is genuinely invalid/expired
            req.user = null;
            return next();
        }

        if (!user) {
            req.user = null;
            return next();
        }

        // ── 2. Fetch Internal User & Permissions (with retry) ──
        let userInfo;
        try {
            userInfo = await withRetry(async () => {
                return await sql`
                    SELECT 
                        u.id, 
                        u.account_status,
                        u.person_id,
                        array_agg(DISTINCT r.code) as roles,
                        array_agg(DISTINCT p.code) as permissions
                    FROM users u
                    LEFT JOIN user_roles ur ON u.id = ur.user_id
                    LEFT JOIN roles r ON ur.role_id = r.id
                    LEFT JOIN role_permissions rp ON r.id = rp.role_id
                    LEFT JOIN permissions p ON rp.permission_id = p.id
                    WHERE u.id = ${user.id}
                    GROUP BY u.id, u.person_id
                `;
            }, { retries: 1, delayMs: 500 });
        } catch (dbErr) {
            console.error('Auth Middleware: DB unreachable after retries');
            return res.status(503).json({ error: 'Database temporarily unavailable. Please retry.' });
        }

        if (userInfo.length === 0) {
            req.user = null;
            return next();
        }

        const dbUser = userInfo[0];

        if (dbUser.account_status !== 'active') {
            req.user = null;
            return res.status(403).json({ error: 'Account is not active' });
        }

        // Attach to req
        req.user = {
            ...user,
            roles: dbUser.roles || [],
            permissions: dbUser.permissions || [],
            internal_id: dbUser.id,
            person_id: dbUser.person_id
        };

        // ── Cache the result ──
        setCachedUser(token, req.user);

        next();

    } catch (err) {
        console.error('Auth Middleware Error:', err);
        req.user = null;
        next();
    }
};

// Middleware to require specific permission
export const requirePermission = (permissionCode) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized: No user logged in' });
        }

        // Super admin bypass (optional, e.g. if role is 'admin')
        if (req.user.roles.includes('admin')) {
            return next();
        }

        if (!req.user.permissions.includes(permissionCode)) {
            return res.status(403).json({ error: `Forbidden: Missing permission ${permissionCode}` });
        }

        next();
    };
};

// Middleware to just require authentication (valid user)
export const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};
