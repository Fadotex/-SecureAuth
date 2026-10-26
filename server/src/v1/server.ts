import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { prisma, closeDatabase } from './db.js';
import { authRouter } from './routes/auth.js';
import { bookingRouter } from './routes/bookings.js';
import { operationsRouter } from './routes/operations.js';
import { paymentRouter, handlePaystackWebhook } from './routes/payments.js';
import { reportRouter } from './routes/reports.js';
import { roomRouter } from './routes/rooms.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { startEmailWorker } from './services/email.worker.js';
import { startHoldExpiryWorker } from './services/hold-expiry.worker.js';
import { startScheduledNotificationsWorker } from './services/scheduled-notifications.worker.js';

const app = express();
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const paymentLimiter = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });

app.disable('x-powered-by');
app.set('trust proxy', config.NODE_ENV === 'production' ? 1 : false);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.FRONTEND_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.post('/api/v1/payments/paystack/webhook', express.raw({ type: 'application/json', limit: '256kb' }), handlePaystackWebhook);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/v1/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  return res.json({ status: 'ok', database: 'connected' });
});

app.use('/api/v1/auth', authLimiter, authRouter);
app.use('/api/v1', roomRouter);
app.use('/api/v1', bookingRouter);
app.use('/api/v1', paymentLimiter, paymentRouter);
app.use('/api/v1', operationsRouter);
app.use('/api/v1', reportRouter);
app.use(notFound);
app.use(errorHandler);

async function start() {
  await prisma.$connect();
  const server = app.listen(config.HOSTEL_API_PORT, config.HOSTEL_API_HOST, () => {
    console.info(`Hostel Management API listening on ${config.HOSTEL_API_HOST}:${config.HOSTEL_API_PORT}`);
  });
  startEmailWorker();
  startHoldExpiryWorker();
  startScheduledNotificationsWorker();

  const shutdown = async () => {
    server.close();
    await closeDatabase();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch(async (error) => {
  console.error('API startup failed:', error);
  await closeDatabase();
  process.exitCode = 1;
});

export { app };