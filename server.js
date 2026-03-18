import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import config from './config/env.js';
import logger from './utils/logger.js';
// Accept self-signed certificates in local development
if (!config.isProduction) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
import { identifyUser } from './middleware/auth.js';
import { requireSchoolId } from './middleware/schoolId.js';
import { auditLogger } from './middleware/audit.js';
import { errorHandler } from './utils/asyncHandler.js';
import { sendSuccess } from './utils/apiResponse.js';
import sql from './db.js';

const app = express();
const port = config.port;

// Security Middleware
app.set('trust proxy', 1);
app.use(helmet());
app.disable('x-powered-by');

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: config.isProduction ? 100 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => req.path === '/api/v1/health' // Allow monitoring without rate limit
});
app.use('/api/', limiter);

// Structured HTTP logging + request id
app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
        const headerId = req.headers['x-request-id'] || req.headers['request-id'];
        const id = (Array.isArray(headerId) ? headerId[0] : headerId) || `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        res.setHeader('x-request-id', id);
        return id;
    },
    // Only log essential request info (no giant header dumps)
    serializers: {
        req(req) {
            return {
                method: req.method,
                url: req.url,
            };
        },
        res(res) {
            return {
                statusCode: res.statusCode,
            };
        },
    },
    // Custom success / error messages
    customSuccessMessage(req, res) {
        const status = res.statusCode;
        const icon = status < 300 ? '✅' : status < 400 ? '↪️' : '⛔';
        const tag  = status < 400 ? 'OK' : 'FAIL';
        const ms   = res[Symbol.for('pino-http.startTime')]
            ? `${Date.now() - res[Symbol.for('pino-http.startTime')]}ms`
            : '';
        return `${icon} ${req.method.padEnd(7)} ${status} │ ${req.url}${ms ? `  (${ms})` : ''}`;
    },
    customErrorMessage(req, res, err) {
        return `💥 ${req.method.padEnd(7)} ${res.statusCode} │ ${req.url}  ▸ ${err.message}`;
    },
    // Custom log level based on status code
    customLogLevel(req, res, err) {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
    // Skip logging noisy health-check polls
    autoLogging: {
        ignore: (req) => req.url === '/api/v1/health',
    },
}));

// CORS - Allow all origins for mobile app (Restrict in production if possible)
app.use(cors({
    origin: (origin, cb) => {
        const allow = config.cors.allowedOrigins;
        if (!allow || allow.length === 0) {
            // If nothing configured, default to permissive only outside production.
            return cb(config.isProduction ? new Error('CORS is not configured') : null, !config.isProduction);
        }
        if (allow.includes('*')) return cb(null, true);
        if (!origin) return cb(null, true); // server-to-server / curl
        return cb(null, allow.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id']
}));

// Middleware
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: config.bodyLimit }));

// Auth & Audit Middleware (Global — skip super-admin routes which have own auth)
app.use((req, res, next) => {
    if (req.path.startsWith('/api/super-admin')) return next();
    identifyUser(req, res, next);
});
app.use((req, res, next) => {
    if (req.path.startsWith('/api/super-admin')) return next();
    requireSchoolId(req, res, next);
});
app.use((req, res, next) => {
    if (req.path.startsWith('/api/super-admin')) return next();
    auditLogger(req, res, next);
});


// Import routes
import authRouter from './routes/authRoutes.js';
import studentsRouter from './routes/studentsRoutes.js';
import teachersRouter from './routes/teachersRoutes.js';
import staffRouter from './routes/staffRoutes.js';
import userRoutes from './routes/userRoutes.js';
import academicsRouter from './routes/academicsRoutes.js';
import attendanceRouter from './routes/attendanceRoutes.js';
import feesRouter from './routes/feesRoutes.js';
import resultsRouter from './routes/resultsRoutes.js';
import complaintsRouter from './routes/complaintsRoutes.js';
import noticesRouter from './routes/noticesRoutes.js';
import leavesRouter from './routes/leavesRoutes.js';
import diaryRouter from './routes/diaryRoutes.js';
import timetableRouter from './routes/timetableRoutes.js';
import transportRouter from './routes/transportRoutes.js';
import hostelRouter from './routes/hostelRoutes.js';
import eventsRouter from './routes/eventsRoutes.js';
import lmsRouter from './routes/lmsRoutes.js';
import adminRouter from './routes/adminRoutes.js';
import notificationRouter from './routes/notificationRoutes.js';
import aiRouter from './routes/aiRoutes.js';
import analyticsRouter from './routes/analyticsRoutes.js';
import adminAnalyticsRouter from './routes/adminAnalyticsRoutes.js';
import adminNotificationRoutes from './routes/adminNotificationRoutes.js';
import invoicesRouter from './routes/invoicesRoutes.js';
import expensesRouter from './routes/expensesRoutes.js';
import payrollRouter from './routes/payrollRoutes.js';
import logRouter from './routes/logRoutes.js';
import schoolSettingsRouter from './routes/schoolSettingsRoutes.js';
import girlSafetyRouter from './routes/girlSafetyRoutes.js';
import superAdminRouter from './routes/superAdminRoutes.js';

// Health check endpoint (requires school_id per multi-tenant contract)
app.get('/api/v1/health', async (req, res) => {
    try {
        // Check DB connectivity
        await sql`SELECT 1`;
        sendSuccess(res, req.schoolId, {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: 'connected'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: 'Database connection failed'
        });
    }
});

// Root route
app.get('/', (req, res) => {
    res.json({
        message: 'School Management System API',
        version: '2.0.0',
        endpoints: {
            auth: '/api/v1/auth',
            admin: '/api/v1/admin',
            students: '/api/v1/students',
            staff: '/api/v1/staff',
            users: '/api/v1/users',
            academics: '/api/v1/academics',
            attendance: '/api/v1/attendance',
            fees: '/api/v1/fees',
            results: '/api/v1/results',
            complaints: '/api/v1/complaints',
            notices: '/api/v1/notices',
            leaves: '/api/v1/leaves',
            diary: '/api/v1/diary',
            timetable: '/api/v1/timetable',
            transport: '/api/v1/transport',
            hostel: '/api/v1/hostel',
            events: '/api/v1/events',
            lms: '/api/v1/lms',
            health: '/api/v1/health',
            girlSafety: '/api/v1/girl-safety'
        }
    });
});

// API v1 Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/students', studentsRouter);
app.use('/api/v1/teachers', teachersRouter);
app.use('/api/v1/staff', staffRouter);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/academics', academicsRouter);
app.use('/api/v1/attendance', attendanceRouter);
app.use('/api/v1/fees', feesRouter);
app.use('/api/v1/results', resultsRouter);
app.use('/api/v1/complaints', complaintsRouter);
app.use('/api/v1/notices', noticesRouter);
app.use('/api/v1/leaves', leavesRouter);
app.use('/api/v1/diary', diaryRouter);
app.use('/api/v1/timetable', timetableRouter);
app.use('/api/v1/transport', transportRouter);
app.use('/api/v1/hostel', hostelRouter);
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/lms', lmsRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/ai', aiRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/admin/analytics', adminAnalyticsRouter);
app.use('/api/v1/admin/notifications', adminNotificationRoutes);
app.use('/api/v1/invoices', invoicesRouter);
app.use('/api/v1/expenses', expensesRouter);
app.use('/api/v1/payroll', payrollRouter);
app.use('/api/v1/log', logRouter);
app.use('/api/v1/school-settings', schoolSettingsRouter);
app.use('/api/v1/girl-safety', girlSafetyRouter);
app.use('/api/super-admin', superAdminRouter);

// Legacy routes (for backward compatibility)
app.use('/students', studentsRouter);
app.use('/teachers', teachersRouter);
app.use('/staff', staffRouter);
app.use('/users', userRoutes);
app.use('/academics', academicsRouter);

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.path });
});

// Global Error Handler
app.use((err, req, res, next) => {
    req.log?.error({ err: err.message, stack: err.stack }, `❌ ${req.method} ${req.url} — Unhandled error`);

    // Call the original errorHandler utility
    errorHandler(err, req, res, next);
});

// Prevent silent failures; let process manager restart in production
process.on('unhandledRejection', (reason) => {
    logger.error({ reason: reason?.message || reason }, '⚠️  Unhandled Promise Rejection');
    if (config.isProduction) process.exit(1);
});
process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message }, '💥 Uncaught Exception — shutting down');
    process.exit(1);
});

// ── ANSI helpers ─────────────────────────────────────────────────────
const c = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    italic:  '\x1b[3m',
    underline:'\x1b[4m',
    // Foreground
    black:   '\x1b[30m',
    red:     '\x1b[31m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    blue:    '\x1b[34m',
    magenta: '\x1b[35m',
    cyan:    '\x1b[36m',
    white:   '\x1b[37m',
    gray:    '\x1b[90m',
    // Background
    bgBlack: '\x1b[40m',
    bgRed:   '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow:'\x1b[43m',
    bgBlue:  '\x1b[44m',
    bgMagenta:'\x1b[45m',
    bgCyan:  '\x1b[46m',
    bgWhite: '\x1b[47m',
};

const server = app.listen(port, async () => {
    // ── Perform DB health check FIRST (this may trigger noisy logs) ──
    let dbOk = false;
    try {
        await sql`SELECT 1`;
        dbOk = true;
    } catch (error) {
        logger.error({ error: error.message }, '❌ Database connection failed at startup');
    }

    // ── Build the entire banner in a buffer, then flush once ─────────
    const W = 60; // inner width (between the two border chars)
    const hr  = '─'.repeat(W);
    const dhr = '━'.repeat(W);

    const pad = (text, w = W) => {
        const visible = text.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI for length
        const remaining = w - visible.length;
        const left = Math.floor(remaining / 2);
        const right = remaining - left;
        return ' '.repeat(Math.max(left, 0)) + text + ' '.repeat(Math.max(right, 0));
    };

    const row = (content) => `${c.cyan}│${c.reset}${content}${c.cyan}│${c.reset}`;

    const kvRow = (icon, label, value, valueColor = c.white) => {
        const strVal = String(value);
        const left = `  ${icon} ${c.white}${label}${c.reset}`;
        const right = `${valueColor}${c.bold}${strVal}${c.reset}`;
        // visible length of left = 2 + icon(1) + 1 + label.length = 4 + label.length
        // visible length of right = strVal.length
        const leftVisible = 4 + label.length;
        const rightVisible = strVal.length;
        const gap = W - leftVisible - rightVisible;
        return row(`${left}${' '.repeat(Math.max(gap, 1))}${right}`);
    };

    const now = new Date();
    const ts = now.toLocaleTimeString('en-GB', { hour12: false });
    const uptime = process.uptime();
    const uptimeStr = uptime < 60 ? `${uptime.toFixed(1)}s` : `${(uptime / 60).toFixed(1)}m`;

    const logo = [
        `${c.bold}${c.cyan} ███╗   ██╗███████╗██╗  ██╗${c.magenta}███████╗██╗   ██╗██████╗ ${c.yellow}██╗   ██╗███████╗${c.reset}`,
        `${c.bold}${c.cyan} ████╗  ██║██╔════╝╚██╗██╔╝${c.magenta}██╔════╝╚██╗ ██╔╝██╔══██╗${c.yellow}██║   ██║██╔════╝${c.reset}`,
        `${c.bold}${c.cyan} ██╔██╗ ██║█████╗   ╚███╔╝ ${c.magenta}███████╗ ╚████╔╝ ██████╔╝${c.yellow}██║   ██║███████╗${c.reset}`,
        `${c.bold}${c.cyan} ██║╚██╗██║██╔══╝   ██╔██╗ ${c.magenta}╚════██║  ╚██╔╝  ██╔══██╗${c.yellow}██║   ██║╚════██║${c.reset}`,
        `${c.bold}${c.cyan} ██║ ╚████║███████╗██╔╝ ██╗${c.magenta}███████║   ██║   ██║  ██║${c.yellow}╚██████╔╝███████║${c.reset}`,
        `${c.bold}${c.cyan} ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝${c.magenta}╚══════╝   ╚═╝   ╚═╝  ╚═╝${c.yellow} ╚═════╝ ╚══════╝${c.reset}`,
    ];

    const dbIcon  = dbOk ? `${c.green}●${c.reset}` : `${c.red}●${c.reset}`;
    const dbLabel = dbOk ? 'ONLINE' : 'OFFLINE';
    const dbColor = dbOk ? c.green : c.red;
    const modeColor = config.isProduction ? c.red : c.green;

    const lines = [
        '',
        ...logo,
        `${c.dim}${'─'.repeat(76)}${c.reset}`,
        `${c.cyan}┌${hr}┐${c.reset}`,
        row(pad(`${c.bold}${c.white}v2.0.0${c.reset}  ${c.dim}·${c.reset}  ${c.gray}API Engine${c.reset}  ${c.dim}·${c.reset}  ${c.gray}${ts}${c.reset}`)),
        `${c.cyan}├${hr}┤${c.reset}`,
        row(`${' '.repeat(W)}`),
        kvRow(`${c.cyan}⬡${c.reset}`, 'PORT ·············', String(port), c.cyan),
        kvRow(`${modeColor}◆${c.reset}`, 'MODE ·············', config.nodeEnv.toUpperCase(), modeColor),
        kvRow(`${c.yellow}◈${c.reset}`, 'LOG LEVEL ········', config.logLevel.toUpperCase(), c.yellow),
        kvRow(dbIcon, 'DATABASE ·········', dbLabel, dbColor),
        kvRow(`${c.magenta}◉${c.reset}`, 'UPTIME ···········', uptimeStr, c.magenta),
        row(`${' '.repeat(W)}`),
        `${c.cyan}├${hr}┤${c.reset}`,
        row(pad(`${c.green}${c.bold}✦  SYSTEM READY  ✦${c.reset}`)),
        `${c.cyan}└${hr}┘${c.reset}`,
        '',
    ];

    // Flush the whole banner at once so nothing interrupts it
    process.stdout.write(lines.join('\n') + '\n');
});

async function shutdown(signal) {
    try {
        logger.info({ signal }, 'Shutdown initiated');
        server.close(() => logger.info('HTTP server closed'));
        await sql.end({ timeout: 5 });
        process.exit(0);
    } catch (err) {
        logger.error({ err }, 'Shutdown error');
        process.exit(1);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));