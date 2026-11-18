import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { config } from './config.js';
import { csrfGuard, loadSession } from './lib/auth.js';
import { HttpError } from './lib/util.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { customersRouter } from './routes/customers.js';
import { ordersRouter } from './routes/orders.js';
import { paymentsRouter } from './routes/payments.js';
import { filesRouter } from './routes/files.js';
import { auditRouter, backupRouter, cronRouter, dashboardRouter, notificationsRouter, queueRouter, reportsRouter, whatsappRouter } from './routes/misc.js';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Webhook needs the raw body for signature verification, so mount it before JSON parsing.
  app.use('/api/whatsapp', whatsappRouter);

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', loadSession, csrfGuard);

  app.get('/api/health', async (_req, res) => res.json({ ok: true, demoMode: config.demoMode, time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/queue', queueRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/cron', cronRouter);
  app.use('/api/backup', backupRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // Serve the built PWA
  const dist = path.resolve(config.webDist);
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('sw.js') || p.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return res.status(400).json({ error: `${first.path.join('.') || 'input'}: ${first.message}`, issues: err.issues });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err?.code === '23505') return res.status(409).json({ error: 'Duplicate entry' });
    if (err?.code === '22P02') return res.status(400).json({ error: 'Invalid identifier' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
