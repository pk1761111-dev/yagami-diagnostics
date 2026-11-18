import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { activity, audit } from '../lib/audit.js';
import { notify, ownerIds } from '../lib/notify.js';
import { bad, forbidden, fromPaise, notFound, toPaise } from '../lib/util.js';

export const ordersRouter = Router();

const statusEnum = z.enum(['quoted', 'confirmed', 'in_production', 'dispatched', 'delivered', 'cancelled']);
const money = z.union([z.string(), z.number()]).transform((v) => toPaise(v));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

ordersRouter.get('/', requireAuth('owner', 'staff3'), async (req, res) => {
  const f = z.object({ status: statusEnum.optional(), customer_id: z.string().uuid().optional() }).parse(req.query);
  const p: unknown[] = [];
  const w: string[] = [];
  if (f.status) { p.push(f.status); w.push(`o.status=$${p.length}`); }
  if (f.customer_id) { p.push(f.customer_id); w.push(`o.customer_id=$${p.length}`); }
  const r = await q(
    `SELECT o.*, ob.received, ob.balance, c.name AS customer_name, c.mobile
       FROM orders o JOIN order_balances ob ON ob.order_id=o.id JOIN customers c ON c.id=o.customer_id
      ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT 200`,
    p,
  );
  res.json({ orders: r.rows });
});

ordersRouter.post('/', requireAuth(), async (req, res) => {
  const u = req.user!;
  const b = z
    .object({
      customer_id: z.string().uuid(),
      description: z.string().trim().min(2).max(1000),
      amount: money,
      status: z.enum(['quoted', 'confirmed']).default('confirmed'),
      invoice_ref: z.string().trim().max(60).optional().nullable(),
      payment_due_date: dateStr.optional().nullable(),
    })
    .parse(req.body);
  if (b.amount <= 0) throw bad('Order amount must be more than zero');
  const order = await tx(async (c) => {
    const cust = (await c.query(`SELECT * FROM customers WHERE id=$1`, [b.customer_id])).rows[0];
    if (!cust) throw notFound('Customer not found');
    if (!(u.role === 'owner' || u.role === 'staff3' || cust.assigned_to === u.id)) throw forbidden('You can only create orders for your own customers');
    const r = await c.query(
      `INSERT INTO orders(customer_id, description, amount, status, invoice_ref, payment_due_date, confirmed_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $4::order_status='confirmed' THEN now() END, $7) RETURNING *`,
      [cust.id, b.description, fromPaise(b.amount), b.status, b.invoice_ref || null, b.payment_due_date ?? null, u.id],
    );
    const o = r.rows[0];
    await activity(c, cust.id, u.id, 'order', `Order ${o.order_no} ${b.status}: ₹${fromPaise(b.amount)} – ${b.description}`);
    await audit(c, { actor: u.id, action: 'order.create', entity: 'order', id: o.id, after: o, ip: req.ip });
    if (b.status === 'confirmed') {
      await c.query(`UPDATE customers SET lead_status='won', updated_at=now() WHERE id=$1 AND lead_status<>'won'`, [cust.id]);
      await notify(c, await ownerIds(c), { kind: 'order_confirmed', title: `Order confirmed: ${cust.name} ₹${fromPaise(b.amount)}`, body: `${o.order_no} by ${u.name}`, priority: 'high', customerId: cust.id, link: `/customers/${cust.id}` });
    }
    return o;
  });
  res.status(201).json({ order });
});

ordersRouter.patch('/:id', requireAuth('owner', 'staff3'), async (req, res) => {
  const u = req.user!;
  const b = z
    .object({
      status: statusEnum.optional(),
      invoice_ref: z.string().trim().max(60).optional().nullable(),
      payment_due_date: dateStr.optional().nullable(),
      description: z.string().trim().min(2).max(1000).optional(),
      amount: money.optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .parse(req.body);
  const out = await tx(async (c) => {
    const before = (await c.query(`SELECT o.*, ob.received FROM orders o JOIN order_balances ob ON ob.order_id=o.id WHERE o.id=$1`, [req.params.id])).rows[0];
    if (!before) throw notFound();
    await c.query(`SELECT 1 FROM orders WHERE id=$1 FOR UPDATE`, [before.id]);
    const receivedP = toPaise(before.received);
    let amount = toPaise(before.amount);
    if (b.amount !== undefined && b.amount !== amount) {
      // Changing a confirmed order value is a financial correction: owner only, with reason.
      if (before.status !== 'quoted' && u.role !== 'owner') throw forbidden('Only the Owner can change the value of a confirmed order');
      if (before.status !== 'quoted' && !b.reason) throw bad('A reason is required to change a confirmed order amount');
      if (b.amount < receivedP) throw bad(`Amount cannot be below the ₹${before.received} already received`);
      if (b.amount <= 0) throw bad('Amount must be more than zero');
      amount = b.amount;
    }
    const status = b.status ?? before.status;
    if (status === 'cancelled' && before.status !== 'cancelled' && receivedP > 0 && u.role !== 'owner') {
      throw forbidden('This order has payments. Only the Owner can cancel it.');
    }
    if (before.status === 'cancelled' && status !== 'cancelled' && u.role !== 'owner') throw forbidden('Only the Owner can reopen a cancelled order');
    const r = await c.query(
      `UPDATE orders SET status=$1, invoice_ref=$2, payment_due_date=$3, description=$4, amount=$5,
              confirmed_at = CASE WHEN confirmed_at IS NULL AND $1::order_status IN ('confirmed','in_production','dispatched','delivered') THEN now() ELSE confirmed_at END,
              updated_at=now() WHERE id=$6 RETURNING *`,
      [status, b.invoice_ref === undefined ? before.invoice_ref : b.invoice_ref || null, b.payment_due_date === undefined ? before.payment_due_date : b.payment_due_date, b.description ?? before.description, fromPaise(amount), before.id],
    );
    const after = r.rows[0];
    const cust = (await c.query(`SELECT id, name FROM customers WHERE id=$1`, [after.customer_id])).rows[0];
    const parts: string[] = [];
    if (before.status !== after.status) parts.push(`status ${before.status} → ${after.status}`);
    if (before.amount !== after.amount) parts.push(`amount ₹${before.amount} → ₹${after.amount}`);
    if (before.payment_due_date !== after.payment_due_date) parts.push(`payment due ${before.payment_due_date ?? '—'} → ${after.payment_due_date ?? '—'}`);
    if (before.invoice_ref !== after.invoice_ref) parts.push(`invoice ${before.invoice_ref ?? '—'} → ${after.invoice_ref ?? '—'}`);
    if (parts.length) {
      await activity(c, after.customer_id, u.id, 'order', `Order ${after.order_no}: ${parts.join(', ')}${b.reason ? ` (${b.reason})` : ''}`);
      await audit(c, { actor: u.id, action: 'order.update', entity: 'order', id: after.id, before, after, reason: b.reason, ip: req.ip });
    }
    if (before.status === 'quoted' && after.status !== 'quoted' && after.status !== 'cancelled') {
      await c.query(`UPDATE customers SET lead_status='won', updated_at=now() WHERE id=$1`, [after.customer_id]);
      await notify(c, await ownerIds(c), { kind: 'order_confirmed', title: `Order confirmed: ${cust.name} ₹${after.amount}`, body: `${after.order_no} by ${u.name}`, priority: 'high', customerId: cust.id, link: `/customers/${cust.id}` });
    }
    if (before.amount !== after.amount && u.role !== 'owner') {
      await notify(c, await ownerIds(c), { kind: 'order_amount_changed', title: `Order value changed: ${cust.name}`, body: parts.join(', '), priority: 'high', customerId: cust.id });
    }
    return after;
  });
  res.json({ order: out });
});

ordersRouter.get('/:id', requireAuth('owner', 'staff3'), async (req, res) => {
  const o = await one(`SELECT o.*, ob.received, ob.balance FROM orders o JOIN order_balances ob ON ob.order_id=o.id WHERE o.id=$1`, [req.params.id]);
  if (!o) throw notFound();
  res.json({ order: o });
});
