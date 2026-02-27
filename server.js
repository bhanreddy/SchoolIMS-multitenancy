import express from 'express';
import fs from 'fs'; // Trigger Restart 2
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import config from './config/env.js';
// Forced restart to pick up route changes
import { identifyUser } from './middleware/auth.js';
import { auditLogger } from './middleware/audit.js';
import { errorHandler } from './utils/asyncHandler.js';
import sql from './db.js';

const app = express();
const port = config.port;

// Security Middleware
app.set('trust proxy', 1);
app.use(helmet());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.nodeEnv === 'production' ? 100 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/api/v1/health' // Allow monitoring without rate limit
});
app.use('/api/', limiter);

// Logging
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

// CORS - Allow all origins for mobile app (Restrict in production if possible)
app.use(cors({
  origin: config.nodeEnv === 'production' ? process.env.ALLOWED_ORIGINS?.split(',') || '*' : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id']
}));

// Middleware
app.use(express.json());

// Auth & Audit Middleware (Global)
app.use(identifyUser);
app.use(auditLogger);

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
import adminNotificationRoutes from './routes/adminNotificationRoutes.js';
import invoicesRouter from './routes/invoicesRoutes.js';
import expensesRouter from './routes/expensesRoutes.js';
import payrollRouter from './routes/payrollRoutes.js';
import logRouter from './routes/logRoutes.js';
import schoolSettingsRouter from './routes/schoolSettingsRoutes.js';

// Health check endpoint
app.get('/api/v1/health', async (req, res) => {
  try {
    // Check DB connectivity
    await sql`SELECT 1`;
    res.json({
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
      health: '/api/v1/health'
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
app.use('/api/v1/admin/notifications', adminNotificationRoutes);
app.use('/api/v1/invoices', invoicesRouter);
app.use('/api/v1/expenses', expensesRouter);
app.use('/api/v1/payroll', payrollRouter);
app.use('/api/v1/log', logRouter);
app.use('/api/v1/school-settings', schoolSettingsRouter);

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
  console.error(`[${new Date().toISOString()}] [ERROR] ${req.method} ${req.url} - ${err.stack || err.message}`);

  // Call the original errorHandler utility
  errorHandler(err, req, res, next);
});

// Prevent server crash on unhandled promise rejection (e.g. transient DB ECONNRESET)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  // Do NOT exit — let the server keep running for transient errors
});

app.listen(port, async () => {
  console.log(`🚀 Server listening on port ${port}`);
  console.log(`📚 API Docs: http://localhost:${port}/`);

  try {
    await sql`SELECT 1`;
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed at startup:', error);
  }
});
