import { Router, raw } from 'express';
import { z } from 'zod';
import { one, pool, q } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { dayStats, priorityQueue } from '../lib/stats.js';
import { addStream } from '../lib/notify.js';
import { generateReport, reportToCsv, runDueJobs } from '../lib/reports.js';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { applyWebhook, verifySignature } from '../lib/whatsapp.js';
import { config, whatsappConfigured } from '../config.js';
import { bad, istToday, notFound } from '../lib/util.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------------- Dashboard ----------------
export const dashboardRouter = Router();

dashboardRouter.get('/', requireAuth(), async (req, res) => {
  const u = req.user!;
  const today = istToday();
  const stats = await dayStats(pool, today);
  const mine = (await q(
    `SELECT count(*) FILTER (WHERE c.follow_up_date = ist_today() AND c.lead_status NOT IN ('won','lost'))::int AS followups_today,
            count(*) FILTER (WHERE c.follow_up_date < ist_today() AND c.lead_status NOT IN ('won','lost'))::int AS followups_overdue,
            count(*) FILTER (WHERE c.lead_status NOT IN ('won','lost'))::int AS open_leads,
            count(*) FILTER (WHERE c.lead_status = 'new')::int AS new_leads,
            count(*) FILTER (WHERE c.important AND c.lead_status NOT IN ('won','lost'))::int AS important_open
       FROM customers c WHERE c.assigned_to=$1`, [u.id])).rows[0];
  const myToday = stats.staff.find((s: any) => s.id === u.id) ?? null;

  if (u.role === 'owner') {
    const queue = await priorityQueue(pool, 8);
    return res.json({ role: u.role, today, stats, mine, queue, whatsappConfigured: whatsappConfigured() });
  }
  if (u.role === 'staff3') {
    const queue = await priorityQueue(pool, 15);
    return res.json({
      role: u.role, today, mine, myToday, queue,
      stats: { collections: stats.collections, outstanding: stats.outstanding, followups: { payments_due: stats.followups.payments_due }, orders: stats.orders },
    });
  }
  const followups = (await q(
    `SELECT id, name, mobile, city, category, lead_status, follow_up_date, important FROM customers
      WHERE assigned_to=$1 AND lead_status NOT IN ('won','lost') AND follow_up_date <= ist_today()
      ORDER BY follow_up_date, name LIMIT 50`, [u.id])).rows;
  res.json({ role: u.role, today, mine, myToday, followups });
});

// ---------------- Priority queue ----------------
export const queueRouter = Router();
queueRouter.get('/', requireAuth('owner', 'staff3'), async (_req, res) => {
  res.json({ queue: await priorityQueue(pool) });
});

// ---------------- Notifications ----------------
export const notificationsRouter = Router();

notificationsRouter.get('/', requireAuth(), async (req, res) => {
  const f = z.object({ unread: z.literal('1').optional(), before: z.coerce.number().optional() }).parse(req.query);
  const r = await q(
    `SELECT n.*, (SELECT json_agg(json_build_object('status', d.status, 'error', d.last_error)) FROM notification_deliveries d WHERE d.notification_id=n.id) AS deliveries
       FROM notifications n WHERE n.user_id=$1 ${f.unread ? 'AND n.read_at IS NULL' : ''} ${f.before ? 'AND n.id < ' + Math.floor(f.before) : ''}
      ORDER BY n.id DESC LIMIT 50`,
    [req.user!.id],
  );
  const unread = await one(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [req.user!.id]);
  res.json({ notifications: r.rows, unread: unread.n });
});

notificationsRouter.post('/:id/read', requireAuth(), async (req, res) => {
  await q(`UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2 AND read_at IS NULL`, [req.params.id, req.user!.id]);
  res.json({ ok: true });
});
notificationsRouter.post('/:id/unread', requireAuth(), async (req, res) => {
  await q(`UPDATE notifications SET read_at=NULL WHERE id=$1 AND user_id=$2`, [req.params.id, req.user!.id]);
  res.json({ ok: true });
});
notificationsRouter.post('/read-all', requireAuth(), async (req, res) => {
  await q(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`, [req.user!.id]);
  res.json({ ok: true });
});

notificationsRouter.get('/stream', requireAuth(), (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  addStream(req.user!.id, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => clearInterval(ping));
});

notificationsRouter.get('/deliveries', requireAuth('owner'), async (_req, res) => {
  const r = await q(
    `SELECT d.*, n.title, u.name AS user_name FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=n.user_id
      ORDER BY d.id DESC LIMIT 100`,
  );
  res.json({ deliveries: r.rows, configured: whatsappConfigured() });
});

// ---------------- Reports (owner) ----------------
export const reportsRouter = Router();

reportsRouter.get('/', requireAuth('owner'), async (_req, res) => {
  const r = await q(
    `SELECT report_date, generated_at, trigger,
            data->'enquiries'->>'total' AS enquiries, data->'orders'->>'value' AS order_value,
            data->'collections'->>'total' AS collected, data->'outstanding'->>'total' AS outstanding,
            data->'followups'->>'missed' AS missed
       FROM daily_reports ORDER BY report_date DESC LIMIT 120`,
  );
  res.json({ reports: r.rows });
});

reportsRouter.get('/live', requireAuth('owner'), async (req, res) => {
  const d = dateStr.default(istToday()).parse(req.query.date ?? undefined);
  res.json({ report: { report_date: d, live: true, data: await dayStats(pool, d) } });
});

reportsRouter.post('/generate', requireAuth('owner'), async (req, res) => {
  const d = dateStr.default(istToday()).parse(req.body?.date ?? undefined);
  if (d > istToday()) throw bad('Cannot generate a report for a future date');
  const r = await generateReport(d, 'manual');
  res.json({ report: r });
});

reportsRouter.get('/:date', requireAuth('owner'), async (req, res) => {
  const d = dateStr.parse(req.params.date);
  const r = await one(`SELECT * FROM daily_reports WHERE report_date=$1`, [d]);
  if (!r) throw notFound('No saved report for this date');
  res.json({ report: r });
});

reportsRouter.get('/:date/csv', requireAuth('owner'), async (req, res) => {
  const d = dateStr.parse(req.params.date);
  const r = await one(`SELECT data FROM daily_reports WHERE report_date=$1`, [d]);
  const data = r?.data ?? (await dayStats(pool, d));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="yagami-report-${d}.csv"`);
  res.send(reportToCsv(data));
});

// ---------------- Audit log (owner) ----------------
export const auditRouter = Router();
auditRouter.get('/', requireAuth('owner'), async (req, res) => {
  const f = z.object({ entity_type: z.string().max(30).optional(), entity_id: z.string().max(60).optional(), before: z.coerce.number().optional() }).parse(req.query);
  const p: unknown[] = [];
  const w: string[] = [];
  if (f.entity_type) { p.push(f.entity_type); w.push(`a.entity_type=$${p.length}`); }
  if (f.entity_id) { p.push(f.entity_id); w.push(`a.entity_id=$${p.length}`); }
  if (f.before) { p.push(f.before); w.push(`a.id < $${p.length}`); }
  const r = await q(`SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 100`, p);
  res.json({ entries: r.rows });
});

// ---------------- WhatsApp webhook (Meta) ----------------
export const whatsappRouter = Router();
whatsappRouter.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && config.whatsapp.verifyToken && req.query['hub.verify_token'] === config.whatsapp.verifyToken) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
});
whatsappRouter.post('/webhook', raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const body = req.body as Buffer;
  if (!verifySignature(body, req.headers['x-hub-signature-256'] as string | undefined)) return res.sendStatus(401);
  try {
    await applyWebhook(JSON.parse(body.toString('utf8')));
  } catch (e) {
    console.error('[whatsapp] webhook parse error', e);
  }
  res.sendStatus(200);
});

// ---------------- External cron trigger (for hosts that sleep) ----------------
export const cronRouter = Router();
cronRouter.get('/run', async (req, res) => {
  const key = String(req.query.key ?? '');
  const secret = config.cronSecret;
  if (!secret || key.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(secret))) return res.sendStatus(403);
  res.json({ ok: true, ...(await runDueJobs()) });
});

// ---------------- Full data export (owner) ----------------
export const backupRouter = Router();
backupRouter.get('/export', requireAuth('owner'), async (req, res) => {
  const tables: Record<string, string> = {
    users: `SELECT id, name, username, mobile, role, active, whatsapp_alerts, created_at FROM users`,
    customers: `SELECT * FROM customers`,
    enquiries: `SELECT * FROM enquiries`,
    activities: `SELECT * FROM activities`,
    lead_transfers: `SELECT * FROM lead_transfers`,
    orders: `SELECT * FROM orders`,
    payments: `SELECT * FROM payments`,
    files: `SELECT id, original_name, mime, size_bytes, sha256, uploaded_by, created_at FROM files`,
    audit_log: `SELECT * FROM audit_log`,
    daily_reports: `SELECT * FROM daily_reports`,
  };
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), app: 'YAGAMI AI – Sales & Payment Control' };
  for (const [k, sql] of Object.entries(tables)) out[k] = (await q(sql)).rows;
  await q(`INSERT INTO audit_log(actor_id, action, entity_type, ip) VALUES ($1,'backup.export','system',$2)`, [req.user!.id, req.ip]);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="yagami-crm-backup-${istToday()}.json.gz"`);
  res.end(zlib.gzipSync(JSON.stringify(out)));
});
