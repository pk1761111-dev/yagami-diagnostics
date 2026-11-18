import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../lib/db.js';
import { requireAuth, type AuthUser } from '../lib/auth.js';
import { activity, audit } from '../lib/audit.js';
import { notify, ownerIds } from '../lib/notify.js';
import { bad, conflict, forbidden, fromPaise, notFound, toPaise } from '../lib/util.js';

export const paymentsRouter = Router();

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

paymentsRouter.get('/', requireAuth('owner', 'staff3'), async (req, res) => {
  const f = z
    .object({
      status: z.enum(['recorded', 'verified', 'disputed', 'reversed', 'deleted']).optional(),
      kind: z.enum(['advance', 'old_pending']).optional(),
      customer_id: z.string().uuid().optional(),
      from: dateStr.optional(),
      to: dateStr.optional(),
    })
    .parse(req.query);
  const p: unknown[] = [];
  const w: string[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (f.status) add('p.status = ?', f.status);
  if (f.kind) add('p.kind = ?', f.kind);
  if (f.customer_id) add('p.customer_id = ?', f.customer_id);
  if (f.from) add('p.paid_at >= ist_day_start(?::date)', f.from);
  if (f.to) add('p.paid_at < ist_day_start(?::date + 1)', f.to);
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const r = await q(
    `SELECT p.*, c.name AS customer_name, c.mobile, o.order_no, o.invoice_ref, r.name AS recorded_by_name, v.name AS verified_by_name
       FROM payments p JOIN customers c ON c.id=p.customer_id JOIN orders o ON o.id=p.order_id
       JOIN users r ON r.id=p.recorded_by LEFT JOIN users v ON v.id=p.verified_by
       ${where} ORDER BY p.paid_at DESC LIMIT 300`,
    p,
  );
  const totals = await q(
    `SELECT COALESCE(SUM(p.amount) FILTER (WHERE payment_counts(p.status)),0) AS collected,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status='verified'),0) AS verified,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status='recorded'),0) AS unverified,
            COALESCE(SUM(p.amount) FILTER (WHERE NOT payment_counts(p.status)),0) AS excluded
       FROM payments p ${where}`,
    p,
  );
  res.json({ payments: r.rows, totals: totals.rows[0] });
});

const createSchema = z.object({
  order_id: z.string().uuid(),
  amount: z.union([z.string(), z.number()]).transform((v) => toPaise(v)),
  paid_at: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
  method: z.enum(['upi', 'bank_transfer', 'cash']),
  kind: z.enum(['advance', 'old_pending']).optional(),
  txn_ref: z.string().trim().max(80).optional().nullable(),
  proof_file_id: z.string().uuid().optional().nullable(),
  remarks: z.string().trim().max(1000).optional().nullable(),
});

/** Parse a datetime; bare "YYYY-MM-DDTHH:mm" (from a phone picker) is treated as IST. */
function parsePaidAt(s: string): Date {
  const d = /Z|[+-]\d{2}:\d{2}$/.test(s) ? new Date(s) : new Date(`${s}:00+05:30`);
  if (isNaN(d.getTime())) throw bad('Invalid payment date/time');
  if (d.getTime() > Date.now() + 5 * 60_000) throw bad('Payment date cannot be in the future');
  return d;
}

paymentsRouter.post('/', requireAuth('owner', 'staff3'), async (req, res) => {
  const u = req.user!;
  const b = createSchema.parse(req.body);
  if (b.amount <= 0) throw bad('Amount must be more than zero');
  const paidAt = parsePaidAt(b.paid_at);
  const txnRef = b.txn_ref ? b.txn_ref : null;
  if (b.method !== 'cash' && !txnRef) throw bad('UTR / transaction reference is required for UPI and bank transfers');

  const pay = await tx(async (c) => {
    // Lock the order so two simultaneous entries can't both pass the balance check.
    const o = (await c.query(`SELECT o.*, c.name AS customer_name, c.assigned_to FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=$1 FOR UPDATE OF o`, [b.order_id])).rows[0];
    if (!o) throw notFound('Order not found');
    if (o.status === 'quoted') throw bad('Confirm the order before recording a payment against it');
    if (o.status === 'cancelled') throw bad('Cannot record payment against a cancelled order');
    const bal = (await c.query(`SELECT balance FROM order_balances WHERE order_id=$1`, [o.id])).rows[0];
    const balanceP = toPaise(bal.balance);
    if (b.amount > balanceP) throw bad(`Amount ₹${fromPaise(b.amount)} is more than the balance due ₹${fromPaise(balanceP)} on ${o.order_no}`);
    if (txnRef) {
      const dup = (await c.query(`SELECT 1 FROM payments WHERE method=$1 AND lower(txn_ref)=lower($2) AND status IN ('recorded','verified')`, [b.method, txnRef])).rows[0];
      if (dup) throw conflict('This transaction reference is already recorded');
    }
    if (b.proof_file_id) await assertFile(c, b.proof_file_id);
    // advance = before goods dispatched; old_pending = balance on already dispatched/delivered goods
    const kind = b.kind ?? (['dispatched', 'delivered'].includes(o.status) ? 'old_pending' : 'advance');
    const r = await c.query(
      `INSERT INTO payments(customer_id, order_id, amount, paid_at, method, kind, txn_ref, proof_file_id, recorded_by, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [o.customer_id, o.id, fromPaise(b.amount), paidAt, b.method, kind, txnRef, b.proof_file_id ?? null, u.id, b.remarks ?? null],
    );
    const p = r.rows[0];
    await audit(c, { actor: u.id, action: 'payment.record', entity: 'payment', id: p.id, after: p, ip: req.ip });
    await activity(c, o.customer_id, u.id, 'payment', `Payment recorded ₹${p.amount} via ${b.method.replace('_', ' ')} (${kind.replace('_', ' ')}) on ${o.order_no}`);
    await notify(c, await ownerIds(c), {
      kind: 'payment_recorded', title: `₹${p.amount} received from ${o.customer_name}`, body: `${b.method.toUpperCase()} · ${kind.replace('_', ' ')} · by ${u.name}${p.proof_file_id ? '' : ' · proof pending'}`,
      priority: 'high', customerId: o.customer_id, link: `/payments`,
    });
    return p;
  });
  res.status(201).json({ payment: pay });
});

async function assertFile(c: any, id: string) {
  const f = (await c.query(`SELECT 1 FROM files WHERE id=$1`, [id])).rows[0];
  if (!f) throw bad('Proof file not found – upload it again');
}

async function lockPayment(c: any, id: string) {
  const p = (await c.query(`SELECT p.*, c.name AS customer_name FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1 FOR UPDATE OF p`, [id])).rows[0];
  if (!p) throw notFound('Payment not found');
  return p;
}

async function changeStatus(
  c: any, u: AuthUser, p: any, status: string, reason: string | null, ip: string | undefined, extra: Record<string, unknown> = {}, action?: string,
) {
  const sets = ['status=$1', 'status_changed_by=$2', 'status_changed_at=now()', 'status_reason=$3'];
  const vals: unknown[] = [status, u.id, reason];
  for (const [k, v] of Object.entries(extra)) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
  vals.push(p.id);
  const r = await c.query(`UPDATE payments SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  const after = r.rows[0];
  const { customer_name, ...before } = p;
  await audit(c, { actor: u.id, action: action ?? `payment.${status}`, entity: 'payment', id: p.id, before, after, reason, ip });
  await activity(c, p.customer_id, u.id, 'payment', `Payment ₹${p.amount} ${action === 'payment.reinstate' ? 'reinstated' : status}${reason ? ': ' + reason : ''}`);
  return after;
}

paymentsRouter.post('/:id/attach-proof', requireAuth('owner', 'staff3'), async (req, res) => {
  const b = z.object({ file_id: z.string().uuid() }).parse(req.body);
  const out = await tx(async (c) => {
    const p = await lockPayment(c, req.params.id as string);
    if (p.status !== 'recorded') throw bad('Proof can only be attached to unverified payments');
    await assertFile(c, b.file_id);
    const r = await c.query(`UPDATE payments SET proof_file_id=$1 WHERE id=$2 RETURNING *`, [b.file_id, p.id]);
    await audit(c, { actor: req.user!.id, action: 'payment.attach_proof', entity: 'payment', id: p.id, before: { proof_file_id: p.proof_file_id }, after: { proof_file_id: b.file_id }, ip: req.ip });
    return r.rows[0];
  });
  res.json({ payment: out });
});

paymentsRouter.post('/:id/verify', requireAuth('owner', 'staff3'), async (req, res) => {
  const b = z.object({ remarks: z.string().trim().max(1000).optional().nullable() }).parse(req.body ?? {});
  const u = req.user!;
  const out = await tx(async (c) => {
    const p = await lockPayment(c, req.params.id as string);
    if (p.status !== 'recorded') throw bad(`Payment is ${p.status}; only recorded payments can be verified`);
    if (!p.proof_file_id) throw bad('Attach payment proof (screenshot / receipt) before verifying');
    const remarks = b.remarks ? (p.remarks ? `${p.remarks}\nVerification: ${b.remarks}` : `Verification: ${b.remarks}`) : p.remarks;
    const after = await changeStatus(c, u, p, 'verified', b.remarks ?? null, req.ip, { verified_by: u.id, verified_at: new Date(), remarks });
    await notify(c, await ownerIds(c), { kind: 'payment_verified', title: `Payment verified: ₹${p.amount} – ${p.customer_name}`, body: `Verified by ${u.name}`, customerId: p.customer_id, link: '/payments' });
    return after;
  });
  res.json({ payment: out });
});

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(1000) });

paymentsRouter.post('/:id/dispute', requireAuth('owner'), async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  const out = await tx(async (c) => {
    const p = await lockPayment(c, req.params.id as string);
    if (!['recorded', 'verified'].includes(p.status)) throw bad(`Cannot dispute a ${p.status} payment`);
    const after = await changeStatus(c, req.user!, p, 'disputed', reason, req.ip);
    await notify(c, [p.recorded_by, p.verified_by], { kind: 'payment_disputed', title: `Payment disputed: ₹${p.amount} – ${p.customer_name}`, body: reason, priority: 'high', customerId: p.customer_id, link: '/payments' });
    return after;
  });
  res.json({ payment: out });
});

paymentsRouter.post('/:id/reinstate', requireAuth('owner'), async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  const out = await tx(async (c) => {
    const p = await lockPayment(c, req.params.id as string);
    if (p.status !== 'disputed') throw bad('Only disputed payments can be reinstated');
    // reinstating must not push the order over its value
    const bal = (await c.query(`SELECT balance FROM order_balances WHERE order_id=$1`, [p.order_id])).rows[0];
    if (toPaise(p.amount) > toPaise(bal.balance)) throw bad('Reinstating would exceed the order balance; reverse instead');
    // goes back to 'recorded' (or 'verified' if it had been verified)
    return changeStatus(c, req.user!, p, p.verified_at ? 'verified' : 'recorded', reason, req.ip, {}, 'payment.reinstate');
  });
  res.json({ payment: out });
});

paymentsRouter.post('/:id/reverse', requireAuth('owner'), async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  const out = await tx(async (c) => {
    const p = await lockPayment(c, req.params.id as string);
    if (!['recorded', 'verified', 'disputed'].includes(p.status)) throw bad(`Cannot reverse a ${p.status} payment`);
    const after = await changeStatus(c, req.user!, p, 'reversed', reason, req.ip);
    await notify(c, [p.recorded_by], { kind: 'payment_reversed', title: `Payment reversed: ₹${p.amount} – ${p.customer_name}`, body: reason, priority: 'high', customerId: p.customer_id, link: '/payments' });
    return after;
  });
  res.json({ payment: out });
});

/** Void a mistaken entry (soft delete). Owner any time; Staff 3 only their own unverified entry within 24h. */
paymentsRouter.post('/:id/delete', requireAuth('owner', 'staff3'), async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  const u = req.user!;
  const out = await tx(async (c) => {
    const p = await lockPayment(c, req.params.id as string);
    if (u.role !== 'owner') {
      if (p.recorded_by !== u.id || p.status !== 'recorded' || Date.now() - new Date(p.recorded_at).getTime() > 86400_000) {
        throw forbidden('Staff can only delete their own unverified entry within 24 hours. Ask the Owner to reverse it.');
      }
    }
    if (!['recorded', 'disputed'].includes(p.status) && u.role !== 'owner') throw forbidden();
    if (['reversed', 'deleted'].includes(p.status)) throw bad(`Payment already ${p.status}`);
    const after = await changeStatus(c, u, p, 'deleted', reason, req.ip);
    await notify(c, await ownerIds(c), { kind: 'payment_deleted', title: `Payment entry deleted: ₹${p.amount} – ${p.customer_name}`, body: `${u.name}: ${reason}`, priority: 'high', customerId: p.customer_id, link: '/payments' });
    return after;
  });
  res.json({ payment: out });
});

paymentsRouter.get('/:id/history', requireAuth('owner', 'staff3'), async (req, res) => {
  const r = await q(`SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_type='payment' AND a.entity_id=$1 ORDER BY a.id`, [req.params.id]);
  res.json({ history: r.rows });
});
