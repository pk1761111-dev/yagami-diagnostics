import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import request from 'supertest';
import { app, agentFor, makeUser, resetDb, PNG } from './helpers.js';
import { pool } from '../src/lib/db.js';
import { config } from '../src/config.js';
import { processOutbox } from '../src/lib/whatsapp.js';
import { catchUpReports } from '../src/lib/reports.js';
import { addDays, istToday } from '../src/lib/util.js';

let owner: any, s1: any, s2: any, s3: any;
let ids: Record<string, string> = {};
const today = istToday();

beforeAll(async () => {
  await resetDb();
  ids.owner = await makeUser('Owner', 'owner', 'owner');
  ids.s1 = await makeUser('Asha (Calls)', 'staff1', 'staff1');
  ids.s2 = await makeUser('Bilal (WhatsApp)', 'staff2', 'staff2');
  ids.s3 = await makeUser('Charan (Dealers)', 'staff3', 'staff3');
  owner = await agentFor('owner');
  s1 = await agentFor('staff1');
  s2 = await agentFor('staff2');
  s3 = await agentFor('staff3');
});
afterAll(async () => {
  await pool.end();
});

const balance = async (customerId: string) => (await pool.query(`SELECT * FROM customer_balances WHERE customer_id=$1`, [customerId])).rows[0];
const notes = async (userId: string, kind: string) => (await pool.query(`SELECT * FROM notifications WHERE user_id=$1 AND kind=$2`, [userId, kind])).rows;

describe('authentication & security', () => {
  it('rejects wrong password and unauthenticated requests', async () => {
    const r = await request(app).post('/api/auth/login').set('X-Requested-With', 'yagami').send({ username: 'staff1', password: 'nope' });
    expect(r.status).toBe(401);
    expect((await request(app).get('/api/customers')).status).toBe(401);
  });

  it('requires the anti-CSRF header on writes', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'staff1', password: 'x' });
    expect(r.status).toBe(403);
  });

  it('locks an account after 5 failed attempts', async () => {
    await makeUser('Locky', 'locky', 'staff1');
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').set('X-Requested-With', 'yagami').send({ username: 'locky', password: 'bad' });
    const r = await request(app).post('/api/auth/login').set('X-Requested-With', 'yagami').send({ username: 'locky', password: 'TestPass12345' });
    expect(r.status).toBe(423);
  });

  it('forces a temporary password to be changed before using the app', async () => {
    const r = await owner.post('/api/users', { name: 'New Staff', username: 'newstaff', role: 'staff2' });
    expect(r.status).toBe(201);
    const tmp = r.body.temporaryPassword;
    const a = await agentFor('newstaff', tmp);
    expect((await a.get('/api/customers')).status).toBe(403);
    expect((await a.post('/api/auth/change-password', { currentPassword: tmp, newPassword: 'short' })).status).toBe(400);
    expect((await a.post('/api/auth/change-password', { currentPassword: tmp, newPassword: 'BrandNew12345' })).status).toBe(200);
    expect((await a.get('/api/customers')).status).toBe(200);
    // deactivate again so routing tests are deterministic
    await owner.patch(`/api/users/${r.body.user.id}`, { active: false });
    expect((await a.get('/api/customers')).status).toBe(401);
  });

  it('staff cannot manage users, see reports, audit log, queue or payments', async () => {
    for (const api of [s1, s2]) {
      expect((await api.post('/api/users', { name: 'X', username: 'xyz', role: 'owner' })).status).toBe(403);
      expect((await api.get('/api/reports')).status).toBe(403);
      expect((await api.get('/api/audit')).status).toBe(403);
      expect((await api.get('/api/queue')).status).toBe(403);
      expect((await api.get('/api/payments')).status).toBe(403);
    }
    expect((await s3.get('/api/reports')).status).toBe(403);
    expect((await s3.post('/api/users', { name: 'X', username: 'xyz', role: 'owner' })).status).toBe(403);
    expect((await s3.get('/api/queue')).status).toBe(200);
  });
});

describe('lead routing', () => {
  it('keeps retail phone enquiries with Staff 1 and WhatsApp with Staff 2', async () => {
    const a = await s1.post('/api/customers', { name: 'Retail Ravi', mobile: '+91 98111 00001', category: 'retail', source: 'phone' });
    expect(a.status).toBe(201);
    expect(a.body.customer.assigned_to).toBe(ids.s1);
    expect(a.body.customer.mobile).toBe('9811100001');
    ids.retail1 = a.body.customer.id;
    const b = await s2.post('/api/customers', { name: 'Retail Wasim', mobile: '9811100002', source: 'whatsapp' });
    expect(b.body.customer.assigned_to).toBe(ids.s2);
    ids.retail2 = b.body.customer.id;
    const c = await owner.post('/api/customers', { name: 'Owner-entered WA', mobile: '9811100009', source: 'whatsapp' });
    expect(c.body.customer.assigned_to).toBe(ids.s2);
  });

  it('rejects duplicate mobile numbers', async () => {
    const r = await s2.post('/api/customers', { name: 'Dup', mobile: '09811100001', source: 'whatsapp' });
    expect(r.status).toBe(409);
    expect(r.body.details.customerId).toBe(ids.retail1);
  });

  it('routes every dealer-type category to Staff 3 regardless of quantity and notifies Staff 3 + Owner', async () => {
    const cats = ['dealer', 'reseller', 'bulk_buyer', 'fleet_owner', 'manufacturer'];
    for (let i = 0; i < cats.length; i++) {
      const r = await s1.post('/api/customers', { name: `Co ${cats[i]}`, mobile: `98222000${10 + i}`, category: cats[i], source: 'phone', requirement: '1 piece' });
      expect(r.status).toBe(201);
      expect(r.body.customer.assigned_to).toBe(ids.s3);
      expect(r.body.customer.important).toBe(true);
      ids[cats[i]] = r.body.customer.id;
    }
    const s3n = await notes(ids.s3, 'priority_lead');
    const own = await notes(ids.owner, 'priority_lead');
    expect(s3n.length).toBe(5);
    expect(own.length).toBe(5);
    expect(s3n[0].priority).toBe('high');
    const t = await pool.query(`SELECT * FROM lead_transfers WHERE customer_id=$1`, [ids.dealer]);
    expect(t.rows[0].automatic).toBe(true);
  });

  it('auto-transfers (visibly) when a retail customer is re-categorised as bulk buyer', async () => {
    const r = await s1.patch(`/api/customers/${ids.retail1}`, { category: 'bulk_buyer' });
    expect(r.status).toBe(200);
    const c = (await pool.query(`SELECT assigned_to FROM customers WHERE id=$1`, [ids.retail1])).rows[0];
    expect(c.assigned_to).toBe(ids.s3);
    const tl = (await pool.query(`SELECT * FROM activities WHERE customer_id=$1 AND kind='transfer'`, [ids.retail1])).rows;
    expect(tl.length).toBe(1);
    const aud = (await pool.query(`SELECT * FROM audit_log WHERE entity_id=$1 AND action='lead.auto_transfer'`, [ids.retail1])).rows;
    expect(aud.length).toBe(1);
    expect((await notes(ids.s1, 'lead_removed')).length).toBe(0); // actor themselves isn't spammed
    expect((await notes(ids.owner, 'lead_transfer')).length).toBeGreaterThan(0);
  });

  it('enforces transfer permissions', async () => {
    // Staff 1 cannot edit or transfer Staff 2's lead
    expect((await s1.patch(`/api/customers/${ids.retail2}`, { notes: 'x' })).status).toBe(403);
    expect((await s1.post(`/api/customers/${ids.retail2}/transfer`, { to_user_id: ids.s3, reason: 'pending pay' })).status).toBe(403);
    // Staff 2 can only send own lead to Staff 3
    expect((await s2.post(`/api/customers/${ids.retail2}/transfer`, { to_user_id: ids.s1, reason: 'swap' })).status).toBe(403);
    expect((await s2.post(`/api/customers/${ids.retail2}/transfer`, { to_user_id: ids.s3, reason: 'Payment pending' })).status).toBe(200);
    // Staff 3 cannot hand leads back; owner can reassign anything with a reason
    expect((await s3.post(`/api/customers/${ids.retail2}/transfer`, { to_user_id: ids.s2, reason: 'back' })).status).toBe(403);
    expect((await owner.post(`/api/customers/${ids.retail2}/transfer`, { to_user_id: ids.s2, reason: 'Owner correction' })).status).toBe(200);
    const tr = (await pool.query(`SELECT count(*)::int n FROM lead_transfers WHERE customer_id=$1`, [ids.retail2])).rows[0];
    expect(tr.n).toBe(2);
  });

  it('hides money from Staff 1/2 but shows a payment-pending flag', async () => {
    const r = await s1.get(`/api/customers/${ids.dealer}`);
    expect(r.status).toBe(200);
    expect(r.body.customer.outstanding).toBeUndefined();
    expect(r.body.payments).toEqual([]);
    const o = await s3.get(`/api/customers/${ids.dealer}`);
    expect(o.body.customer.outstanding).toBe('0.00');
  });
});

describe('orders & payments', () => {
  let order: any;
  let p1: any;

  it('Staff 1/2 cannot record payments', async () => {
    order = (await s3.post('/api/orders', { customer_id: ids.dealer, description: 'Swift harness x 10', amount: '10000.50', payment_due_date: addDays(today, -2) })).body.order;
    expect(order.amount).toBe('10000.50');
    expect((await s1.post('/api/payments', { order_id: order.id, amount: 100, paid_at: new Date().toISOString(), method: 'cash' })).status).toBe(403);
    expect((await s2.post('/api/payments', { order_id: order.id, amount: 100, paid_at: new Date().toISOString(), method: 'cash' })).status).toBe(403);
  });

  it('calculates balance with paise precision and blocks over-payment', async () => {
    const r = await s3.post('/api/payments', { order_id: order.id, amount: '4000.25', paid_at: new Date().toISOString(), method: 'upi', txn_ref: 'UTR111' });
    expect(r.status).toBe(201);
    p1 = r.body.payment;
    expect(p1.kind).toBe('advance');
    let b = await balance(ids.dealer);
    expect(b.total_orders).toBe('10000.50');
    expect(b.total_received).toBe('4000.25');
    expect(b.outstanding).toBe('6000.25');
    expect(b.overdue).toBe('6000.25');
    const over = await s3.post('/api/payments', { order_id: order.id, amount: '6000.26', paid_at: new Date().toISOString(), method: 'cash' });
    expect(over.status).toBe(400);
    const dupUtr = await s3.post('/api/payments', { order_id: order.id, amount: '1', paid_at: new Date().toISOString(), method: 'upi', txn_ref: 'utr111' });
    expect(dupUtr.status).toBe(409);
    const noUtr = await s3.post('/api/payments', { order_id: order.id, amount: '1', paid_at: new Date().toISOString(), method: 'bank_transfer' });
    expect(noUtr.status).toBe(400);
    const future = await s3.post('/api/payments', { order_id: order.id, amount: '1', paid_at: new Date(Date.now() + 86400_000).toISOString(), method: 'cash' });
    expect(future.status).toBe(400);
    expect((await notes(ids.owner, 'payment_recorded')).length).toBe(1);
  });

  it('requires valid proof before verification and records who verified', async () => {
    expect((await s3.post(`/api/payments/${p1.id}/verify`, {})).status).toBe(400);
    const fake = await s3.upload('/api/files', Buffer.from('MZ\x90\x00 this is an exe'), 'proof.png');
    expect(fake.status).toBe(400);
    const big = await s3.upload('/api/files', Buffer.concat([PNG, Buffer.alloc(1.2 * 1024 * 1024)]), 'big.png');
    expect(big.status).toBe(400);
    expect((await s1.upload('/api/files', PNG, 'p.png')).status).toBe(403);
    const f = await s3.upload('/api/files', PNG, 'gpay screenshot.png');
    expect(f.status).toBe(201);
    expect((await s3.post(`/api/payments/${p1.id}/attach-proof`, { file_id: f.body.file.id })).status).toBe(200);
    const v = await s3.post(`/api/payments/${p1.id}/verify`, { remarks: 'Matched bank statement' });
    expect(v.status).toBe(200);
    expect(v.body.payment.status).toBe('verified');
    expect(v.body.payment.verified_by).toBe(ids.s3);
    expect(v.body.payment.verified_at).toBeTruthy();
    expect((await s1.get(`/api/files/${f.body.file.id}`)).status).toBe(403);
    expect((await owner.get(`/api/files/${f.body.file.id}`)).status).toBe(200);
  });

  it('only Owner can dispute / reverse; disputed and reversed are never counted', async () => {
    expect((await s3.post(`/api/payments/${p1.id}/dispute`, { reason: 'hmm' })).status).toBe(403);
    expect((await owner.post(`/api/payments/${p1.id}/dispute`, { reason: 'Not in bank statement' })).status).toBe(200);
    let b = await balance(ids.dealer);
    expect(b.total_received).toBe('0.00');
    expect(b.outstanding).toBe('10000.50');
    // reinstate restores verified state
    const re = await owner.post(`/api/payments/${p1.id}/reinstate`, { reason: 'Found it' });
    expect(re.body.payment.status).toBe('verified');
    b = await balance(ids.dealer);
    expect(b.outstanding).toBe('6000.25');
    // reverse is final
    expect((await owner.post(`/api/payments/${p1.id}/reverse`, { reason: 'Cheque bounced' })).status).toBe(200);
    b = await balance(ids.dealer);
    expect(b.total_received).toBe('0.00');
    expect((await owner.post(`/api/payments/${p1.id}/dispute`, { reason: 'again' })).status).toBe(400);
    // same UTR may be re-entered once the bad one is reversed
    expect((await s3.post('/api/payments', { order_id: order.id, amount: '500', paid_at: new Date().toISOString(), method: 'upi', txn_ref: 'UTR111' })).status).toBe(201);
  });

  it('Staff 3 can delete only own unverified entry; deleted is not counted', async () => {
    const p = (await s3.post('/api/payments', { order_id: order.id, amount: '1000', paid_at: new Date().toISOString(), method: 'cash' })).body.payment;
    let b = await balance(ids.dealer);
    expect(b.total_received).toBe('1500.00');
    expect((await s3.post(`/api/payments/${p.id}/delete`, { reason: 'Typed wrong amount' })).status).toBe(200);
    b = await balance(ids.dealer);
    expect(b.total_received).toBe('500.00');
    expect(b.outstanding).toBe('9500.50');
  });

  it('database refuses to edit or delete financial history', async () => {
    const p = (await pool.query(`SELECT id FROM payments LIMIT 1`)).rows[0];
    await expect(pool.query(`UPDATE payments SET amount=1 WHERE id=$1`, [p.id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`DELETE FROM payments WHERE id=$1`, [p.id])).rejects.toThrow(/cannot be deleted/);
    await expect(pool.query(`UPDATE payments SET status='recorded' WHERE status='reversed'`)).rejects.toThrow(/final/);
    await expect(pool.query(`UPDATE audit_log SET action='x'`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
    const hist = await owner.get(`/api/payments/${p1.id}/history`);
    expect(hist.body.history.map((h: any) => h.action)).toEqual(['payment.record', 'payment.attach_proof', 'payment.verified', 'payment.disputed', 'payment.reinstate', 'payment.reversed']);
  });

  it('classifies payments on delivered orders as old pending and splits dashboard totals', async () => {
    const o = (await s3.post('/api/orders', { customer_id: ids.fleet_owner, description: 'Lamp harness x 5', amount: 2500 })).body.order;
    expect((await s3.patch(`/api/orders/${o.id}`, { status: 'delivered' })).status).toBe(200);
    const p = await s3.post('/api/payments', { order_id: o.id, amount: 1000, paid_at: new Date().toISOString(), method: 'cash' });
    expect(p.body.payment.kind).toBe('old_pending');
    const d = await owner.get('/api/dashboard');
    expect(d.body.stats.collections.advance).toBe('500.00');
    expect(d.body.stats.collections.old_pending).toBe('1000.00');
    expect(d.body.stats.collections.total).toBe('1500.00');
    expect(d.body.stats.outstanding.total).toBe('11000.50'); // 9500.50 + 1500
    expect(d.body.stats.outstanding.overdue).toBe('9500.50');
    expect(d.body.stats.orders.count).toBe(2);
    expect(d.body.stats.orders.value).toBe('12500.50');
  });

  it('only Owner may change a confirmed order value, and never below received', async () => {
    const o = (await pool.query(`SELECT id FROM orders WHERE customer_id=$1`, [ids.fleet_owner])).rows[0];
    expect((await s3.patch(`/api/orders/${o.id}`, { amount: 3000 })).status).toBe(403);
    expect((await owner.patch(`/api/orders/${o.id}`, { amount: 900, reason: 'discount' })).status).toBe(400);
    expect((await owner.patch(`/api/orders/${o.id}`, { amount: 3000 })).status).toBe(400); // reason required
    expect((await owner.patch(`/api/orders/${o.id}`, { amount: 3000, reason: 'Extra 2 units' })).status).toBe(200);
    expect((await balance(ids.fleet_owner)).outstanding).toBe('2000.00');
  });

  it('cannot pay against quoted or cancelled orders', async () => {
    const q1 = (await s3.post('/api/orders', { customer_id: ids.reseller, description: 'Quote', amount: 999, status: 'quoted' })).body.order;
    expect((await s3.post('/api/payments', { order_id: q1.id, amount: 100, paid_at: new Date().toISOString(), method: 'cash' })).status).toBe(400);
    expect((await balance(ids.reseller)).total_orders).toBe('0.00'); // quotes are not receivables
  });
});

describe('priority queue, reports and notifications', () => {
  it('ranks urgent complaints first, then overdue payments', async () => {
    await s2.post(`/api/customers/${ids.retail2}/enquiries`, { source: 'whatsapp', is_complaint: true, urgent: true, notes: 'Harness burnt' });
    expect((await notes(ids.s3, 'urgent_complaint')).length).toBe(1);
    const q = (await s3.get('/api/queue')).body.queue;
    expect(q[0].id).toBe(ids.retail2);
    expect(q[0].reasons).toContain('Urgent complaint');
    const dealer = q.find((x: any) => x.id === ids.dealer);
    expect(dealer.reasons).toContain('Overdue payment');
    expect(q.findIndex((x: any) => x.id === ids.dealer)).toBeLessThan(q.findIndex((x: any) => x.id === ids.manufacturer));
  });

  it('counts missed follow-ups and generates the report + CSV', async () => {
    const c = (await s1.post('/api/customers', { name: 'Forgetful Lead', mobile: '9833300001', source: 'phone' })).body.customer;
    await pool.query(`UPDATE customers SET follow_up_date=$1 WHERE id=$2`, [addDays(today, -3), c.id]);
    await pool.query(`UPDATE activities SET created_at = now() - interval '5 days' WHERE customer_id=$1`, [c.id]);
    const gen = await owner.post('/api/reports/generate', { date: today });
    expect(gen.status).toBe(200);
    const rep = (await owner.get(`/api/reports/${today}`)).body.report.data;
    expect(rep.missedFollowups.map((m: any) => m.id)).toContain(c.id);
    expect(rep.staff.find((s: any) => s.id === ids.s1).missed_followups).toBe(1);
    expect(rep.collections.total).toBe('1500.00');
    expect(rep.collections.excluded).not.toBe('0.00');
    const csv = await owner.get(`/api/reports/${today}/csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Old pending payments,1000.00');
    expect(csv.text).toContain('Forgetful Lead');
    // logging an action clears the missed follow-up
    await s1.post(`/api/customers/${c.id}/notes`, { note: 'Called, no answer', kind: 'call' });
    const live = (await owner.get(`/api/reports/live?date=${today}`)).body.report.data;
    expect(live.missedFollowups.map((m: any) => m.id)).not.toContain(c.id);
  });

  it('scheduler catch-up fills missing past reports exactly once', async () => {
    await pool.query(`UPDATE users SET created_at = now() - interval '3 days'`);
    const first = await catchUpReports();
    expect(first).toContain(addDays(today, -1));
    const second = await catchUpReports();
    expect(second).toEqual([]);
    const n = (await pool.query(`SELECT count(*)::int n FROM daily_reports WHERE report_date=$1`, [addDays(today, -1)])).rows[0].n;
    expect(n).toBe(1);
  });

  it('notification read / unread works per user', async () => {
    const list = (await s3.get('/api/notifications')).body;
    expect(list.unread).toBeGreaterThan(0);
    const id = list.notifications[0].id;
    await s3.post(`/api/notifications/${id}/read`);
    await s1.post(`/api/notifications/${id}/unread`); // someone else's — no effect
    const r = (await pool.query(`SELECT read_at FROM notifications WHERE id=$1`, [id])).rows[0];
    expect(r.read_at).not.toBeNull();
    await s3.post('/api/notifications/read-all');
    expect((await s3.get('/api/notifications')).body.unread).toBe(0);
  });

  it('WhatsApp: never claims delivery without Meta confirmation', async () => {
    await pool.query(`UPDATE users SET mobile='9876543210', whatsapp_alerts=true WHERE id=$1`, [ids.s3]);
    await s1.post('/api/customers', { name: 'WA Test Dealer', mobile: '9844400001', category: 'dealer', source: 'phone' });
    // Not configured -> honest status
    await processOutbox();
    let d = (await pool.query(`SELECT * FROM notification_deliveries ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(d.status).toBe('not_configured');

    Object.assign(config.whatsapp, { token: 't', phoneNumberId: '123', templateName: 'crm_alert', appSecret: 'shh' });
    await s1.post('/api/customers', { name: 'WA Test Dealer 2', mobile: '9844400002', category: 'dealer', source: 'phone' });
    const fakeFetch: any = async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.to).toBe('919876543210');
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST1' }] }), { status: 200 });
    };
    await processOutbox(fakeFetch);
    d = (await pool.query(`SELECT * FROM notification_deliveries WHERE provider_message_id='wamid.TEST1'`)).rows[0];
    expect(d.status).toBe('sent'); // accepted by API, NOT delivered

    const payload = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.TEST1', status: 'delivered' }] } }] }] });
    const bad = await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=deadbeef').send(payload);
    expect(bad.status).toBe(401);
    const sig = 'sha256=' + crypto.createHmac('sha256', 'shh').update(payload).digest('hex');
    const ok = await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(payload);
    expect(ok.status).toBe(200);
    d = (await pool.query(`SELECT * FROM notification_deliveries WHERE provider_message_id='wamid.TEST1'`)).rows[0];
    expect(d.status).toBe('delivered');

    // API failure is retried, not marked sent
    await s1.post('/api/customers', { name: 'WA Test Dealer 3', mobile: '9844400003', category: 'dealer', source: 'phone' });
    await processOutbox((async () => new Response(JSON.stringify({ error: { message: 'Template not approved' } }), { status: 400 })) as any);
    d = (await pool.query(`SELECT * FROM notification_deliveries ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(d.status).toBe('queued');
    expect(d.attempts).toBe(1);
    expect(d.last_error).toBe('Template not approved');
    Object.assign(config.whatsapp, { token: '', phoneNumberId: '', templateName: '', appSecret: '' });
  });

  it('records lead transfers and payment changes in the owner audit log', async () => {
    const r = await owner.get('/api/audit');
    const actions = r.body.entries.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['lead.transfer', 'lead.auto_transfer', 'payment.reversed', 'payment.deleted', 'order.update']));
  });

  it('free-hosting mode: proofs stored in the database, cron trigger, owner export', async () => {
    (config as any).fileStorage = 'db';
    const f = await s3.upload('/api/files', PNG, 'db-proof.png');
    expect(f.status).toBe(201);
    const row = (await pool.query(`SELECT storage_name, length(data) AS n FROM files WHERE id=$1`, [f.body.file.id])).rows[0];
    expect(row.storage_name).toBeNull();
    expect(row.n).toBe(PNG.length);
    const got = await owner.get(`/api/files/${f.body.file.id}`);
    expect(got.status).toBe(200);
    expect(Buffer.from(got.body).equals(PNG)).toBe(true);
    (config as any).fileStorage = 'disk';

    expect((await request(app).get('/api/cron/run')).status).toBe(403);
    (config as any).cronSecret = 'ping-secret-123';
    expect((await request(app).get('/api/cron/run?key=wrong-secret-12')).status).toBe(403);
    const ok = await request(app).get('/api/cron/run?key=ping-secret-123');
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    (config as any).cronSecret = '';

    expect((await s3.get('/api/backup/export')).status).toBe(403);
    const ex = await owner.get('/api/backup/export').buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(ex.status).toBe(200);
    const data = JSON.parse(zlib.gunzipSync(ex.body).toString());
    expect(data.payments.length).toBeGreaterThan(0);
    expect(JSON.stringify(data.users)).not.toContain('password_hash');
  });
});
