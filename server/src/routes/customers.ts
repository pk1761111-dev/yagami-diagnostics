import { Router } from 'express';
import { z } from 'zod';
import { one, pool, q, tx } from '../lib/db.js';
import { requireAuth, type AuthUser } from '../lib/auth.js';
import { activity, audit } from '../lib/audit.js';
import { notify, ownerIds } from '../lib/notify.js';
import { assertCanTransfer, initialAssignee, isPriorityCategory, pickUser, transferCustomer } from '../lib/routing.js';
import { conflict, forbidden, normaliseMobile, notFound } from '../lib/util.js';

export const customersRouter = Router();

export const categoryEnum = z.enum(['retail', 'dealer', 'reseller', 'bulk_buyer', 'fleet_owner', 'manufacturer']);
export const sourceEnum = z.enum(['phone', 'whatsapp', 'walk_in', 'website', 'referral', 'other']);
const statusEnum = z.enum(['new', 'contacted', 'interested', 'quoted', 'won', 'lost']);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

const seesFinance = (u: AuthUser) => u.role === 'owner' || u.role === 'staff3';

/** Strip money details for Staff 1/2 – they only see whether payment is pending. */
function shape(u: AuthUser, c: any) {
  const base = { ...c, has_outstanding: Number(c.outstanding ?? 0) > 0 };
  if (seesFinance(u)) return base;
  delete base.total_orders;
  delete base.total_received;
  delete base.unverified_received;
  delete base.outstanding;
  delete base.overdue;
  return base;
}

const SELECT = `
  SELECT c.*, u.name AS assigned_name, u.role AS assigned_role,
         b.total_orders, b.total_received, b.unverified_received, b.outstanding, b.overdue, b.earliest_due
    FROM customers c
    LEFT JOIN users u ON u.id = c.assigned_to
    JOIN customer_balances b ON b.customer_id = c.id`;

customersRouter.get('/', requireAuth(), async (req, res) => {
  const f = z
    .object({
      q: z.string().trim().max(80).optional(),
      category: categoryEnum.optional(),
      source: sourceEnum.optional(),
      status: statusEnum.optional(),
      assigned: z.string().optional(),
      important: z.literal('1').optional(),
      outstanding: z.literal('1').optional(),
      followup: z.enum(['today', 'overdue', 'upcoming']).optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
    })
    .parse(req.query);
  const where: string[] = [];
  const p: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    p.push(v);
    where.push(sql.replace('?', `$${p.length}`));
  };
  if (f.q) {
    const digits = f.q.replace(/\D/g, '');
    p.push(`%${f.q.toLowerCase()}%`);
    const i = p.length;
    let cond = `(lower(c.name) LIKE $${i} OR lower(c.code) LIKE $${i} OR lower(coalesce(c.city,'')) LIKE $${i} OR lower(coalesce(c.vehicle_model,'')) LIKE $${i}`;
    if (digits.length >= 3) {
      p.push(`%${digits}%`);
      cond += ` OR c.mobile LIKE $${p.length}`;
    }
    where.push(cond + ')');
  }
  if (f.category) add('c.category = ?', f.category);
  if (f.source) add('c.source = ?', f.source);
  if (f.status) add('c.lead_status = ?', f.status);
  if (f.assigned) add('c.assigned_to = ?', f.assigned === 'me' ? req.user!.id : f.assigned);
  if (f.important) where.push(`c.important`);
  if (f.outstanding) where.push(`b.outstanding > 0`);
  if (f.followup === 'today') where.push(`(c.follow_up_date = ist_today() OR c.payment_follow_up_date = ist_today())`);
  if (f.followup === 'overdue') where.push(`((c.follow_up_date < ist_today() AND c.lead_status NOT IN ('won','lost')) OR (c.payment_follow_up_date < ist_today() AND b.outstanding > 0))`);
  if (f.followup === 'upcoming') where.push(`c.follow_up_date > ist_today()`);
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.updated_at DESC LIMIT 31 OFFSET ${(f.page - 1) * 30}`;
  const r = await q(sql, p);
  res.json({ customers: r.rows.slice(0, 30).map((c) => shape(req.user!, c)), hasMore: r.rows.length > 30 });
});

/** Duplicate check while typing a mobile number. */
customersRouter.get('/check-mobile', requireAuth(), async (req, res) => {
  let m: string;
  try {
    m = normaliseMobile(String(req.query.mobile ?? ''));
  } catch {
    return res.json({ valid: false });
  }
  const c = await one(`SELECT c.id, c.name, c.code, u.name AS assigned_name FROM customers c LEFT JOIN users u ON u.id=c.assigned_to WHERE c.mobile=$1`, [m]);
  res.json({ valid: true, exists: Boolean(c), customer: c ?? null });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  mobile: z.string(),
  city: optText(80),
  state: optText(80),
  category: categoryEnum.default('retail'),
  vehicle_model: optText(120),
  requirement: optText(2000),
  source: sourceEnum,
  notes: optText(4000),
  follow_up_date: dateStr.optional().nullable(),
  important: z.boolean().optional(),
  enquiry_notes: optText(2000),
  is_complaint: z.boolean().optional(),
  urgent: z.boolean().optional(),
});

customersRouter.post('/', requireAuth(), async (req, res) => {
  const b = createSchema.parse(req.body);
  const mobile = normaliseMobile(b.mobile);
  const user = req.user!;
  const dup = await one(`SELECT id, name FROM customers WHERE mobile=$1`, [mobile]);
  if (dup) throw conflict(`This mobile already belongs to ${dup.name}. Log the enquiry on the existing customer instead.`, { customerId: dup.id });

  const created = await tx(async (c) => {
    const route = await initialAssignee(c, user, b.category, b.source);
    const important = Boolean(b.important) || route.priority;
    const r = await c.query(
      `INSERT INTO customers(name, mobile, city, state, category, vehicle_model, requirement, source, assigned_to, important, notes, follow_up_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [b.name, mobile, b.city, b.state, b.category, b.vehicle_model, b.requirement, b.source, route.userId, important, b.notes, b.follow_up_date ?? null, user.id],
    );
    const cust = r.rows[0];
    await c.query(`INSERT INTO enquiries(customer_id, source, is_complaint, urgent, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
      cust.id, b.source, Boolean(b.is_complaint), Boolean(b.urgent), b.enquiry_notes ?? b.requirement, user.id,
    ]);
    await activity(c, cust.id, user.id, 'created', `Customer created from ${b.source} enquiry`);
    const assignee = (await c.query(`SELECT name, role FROM users WHERE id=$1`, [route.userId])).rows[0];
    if (route.userId !== user.id) {
      await c.query(`INSERT INTO lead_transfers(customer_id, from_user, to_user, reason, automatic, transferred_by) VALUES ($1,NULL,$2,$3,true,$4)`, [cust.id, route.userId, route.reason, user.id]);
      await activity(c, cust.id, null, 'assigned', `Assigned to ${assignee.name}. ${route.reason}`);
    }
    await audit(c, { actor: user.id, action: 'customer.create', entity: 'customer', id: cust.id, after: { ...cust, routing: route.reason }, ip: req.ip });

    // Notifications
    if (route.priority) {
      const n = { kind: 'priority_lead', title: `New ${b.category.replace('_', ' ')} lead: ${b.name}`, body: `${route.reason}. Mobile ${mobile}${b.city ? ', ' + b.city : ''}`, priority: 'high' as const, customerId: cust.id, link: `/customers/${cust.id}` };
      await notify(c, [route.userId, ...(await ownerIds(c))], n);
    } else {
      if (route.userId !== user.id) await notify(c, [route.userId], { kind: 'lead_assigned', title: `New lead assigned: ${b.name}`, body: route.reason, customerId: cust.id, link: `/customers/${cust.id}` });
      if (important) await notify(c, await ownerIds(c), { kind: 'important_lead', title: `Important lead: ${b.name}`, body: `Assigned to ${assignee.name}`, priority: 'high', customerId: cust.id, link: `/customers/${cust.id}` });
    }
    if (b.is_complaint && b.urgent) await notifyUrgentComplaint(c, cust, b.enquiry_notes);
    return cust;
  });
  res.status(201).json({ customer: created });
});

async function notifyUrgentComplaint(c: any, cust: any, notes?: string | null) {
  const s3 = await pickUser(c, 'staff3');
  await notify(c, [cust.assigned_to, s3, ...(await ownerIds(c))], {
    kind: 'urgent_complaint', title: `URGENT complaint: ${cust.name}`, body: notes ?? undefined, priority: 'high', customerId: cust.id, link: `/customers/${cust.id}`,
  });
}

customersRouter.get('/:id', requireAuth(), async (req, res) => {
  const u = req.user!;
  const c = await one(`${SELECT} WHERE c.id=$1`, [req.params.id]);
  if (!c) throw notFound('Customer not found');
  const timeline = await q(`SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id=a.user_id WHERE a.customer_id=$1 ORDER BY a.created_at DESC LIMIT 200`, [c.id]);
  const enquiries = await q(`SELECT e.*, u.name AS created_by_name FROM enquiries e LEFT JOIN users u ON u.id=e.created_by WHERE e.customer_id=$1 ORDER BY e.created_at DESC`, [c.id]);
  const transfers = await q(`SELECT t.*, f.name AS from_name, tu.name AS to_name, b.name AS by_name FROM lead_transfers t LEFT JOIN users f ON f.id=t.from_user JOIN users tu ON tu.id=t.to_user LEFT JOIN users b ON b.id=t.transferred_by WHERE t.customer_id=$1 ORDER BY t.created_at DESC`, [c.id]);
  let orders: any[] = [];
  let payments: any[] = [];
  if (seesFinance(u) || c.assigned_to === u.id) {
    orders = (await q(`SELECT o.*, ob.received, ob.received_verified, ob.balance FROM orders o JOIN order_balances ob ON ob.order_id=o.id WHERE o.customer_id=$1 ORDER BY o.created_at DESC`, [c.id])).rows;
  }
  if (seesFinance(u)) {
    payments = (await q(
      `SELECT p.*, o.order_no, o.invoice_ref, r.name AS recorded_by_name, v.name AS verified_by_name, s.name AS status_changed_by_name
         FROM payments p JOIN orders o ON o.id=p.order_id JOIN users r ON r.id=p.recorded_by
         LEFT JOIN users v ON v.id=p.verified_by LEFT JOIN users s ON s.id=p.status_changed_by
        WHERE p.customer_id=$1 ORDER BY p.paid_at DESC`,
      [c.id],
    )).rows;
  } else {
    // Staff 1/2 don't see amounts on orders either
    orders = orders.map(({ amount, received, received_verified, balance, ...o }) => ({ ...o, payment_pending: Number(balance) > 0 }));
  }
  res.json({
    customer: shape(u, c),
    canEdit: u.role === 'owner' || c.assigned_to === u.id,
    timeline: timeline.rows,
    enquiries: enquiries.rows,
    transfers: transfers.rows,
    orders,
    payments,
  });
});

const updateSchema = createSchema
  .omit({ mobile: true, enquiry_notes: true, is_complaint: true, urgent: true, source: true })
  .partial()
  .extend({
    mobile: z.string().optional(),
    lead_status: statusEnum.optional(),
    payment_follow_up_date: dateStr.optional().nullable(),
  });

customersRouter.patch('/:id', requireAuth(), async (req, res) => {
  const u = req.user!;
  const b = updateSchema.parse(req.body);
  const result = await tx(async (c) => {
    const before = (await c.query(`SELECT * FROM customers WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!before) throw notFound('Customer not found');
    const isAssignee = before.assigned_to === u.id;
    const keys = Object.keys(b);
    // Staff 3 may set the payment follow-up date on any customer (collections), nothing else unless assigned.
    const paymentOnly = keys.every((k) => k === 'payment_follow_up_date');
    if (!(u.role === 'owner' || isAssignee || (u.role === 'staff3' && paymentOnly))) throw forbidden('Only the assigned staff member or Owner can edit this customer');
    if (b.payment_follow_up_date !== undefined && !(u.role === 'owner' || u.role === 'staff3')) throw forbidden('Only Staff 3 or Owner manage payment follow-ups');

    const next = { ...before };
    for (const k of keys) (next as any)[k] = (b as any)[k];
    if (b.mobile) {
      next.mobile = normaliseMobile(b.mobile);
      const d = (await c.query(`SELECT id FROM customers WHERE mobile=$1 AND id<>$2`, [next.mobile, before.id])).rows[0];
      if (d) throw conflict('Another customer already has this mobile number');
    }
    if (isPriorityCategory(next.category)) next.important = true;

    const r = await c.query(
      `UPDATE customers SET name=$1, mobile=$2, city=$3, state=$4, category=$5, vehicle_model=$6, requirement=$7, notes=$8,
              follow_up_date=$9, payment_follow_up_date=$10, important=$11, lead_status=$12, updated_at=now()
        WHERE id=$13 RETURNING *`,
      [next.name, next.mobile, next.city, next.state, next.category, next.vehicle_model, next.requirement, next.notes, next.follow_up_date, next.payment_follow_up_date, next.important, next.lead_status, before.id],
    );
    const after = r.rows[0];
    const changed = keys.filter((k) => String((before as any)[k] ?? '') !== String((after as any)[k] ?? ''));
    if (changed.length) {
      const nice: Record<string, string> = { follow_up_date: 'Follow-up date', payment_follow_up_date: 'Payment follow-up', lead_status: 'Status', category: 'Category' };
      const msg = changed.map((k) => `${nice[k] ?? k.replace(/_/g, ' ')}: ${(before as any)[k] ?? '—'} → ${(after as any)[k] ?? '—'}`).join('; ');
      await activity(c, before.id, u.id, 'updated', msg, { changed });
      await audit(c, { actor: u.id, action: 'customer.update', entity: 'customer', id: before.id, before, after, ip: req.ip });
    }

    // Lead routing rule: priority categories must sit with Staff 3. Logged + notified, never silent.
    if (isPriorityCategory(after.category)) {
      const cur = (await c.query(`SELECT role FROM users WHERE id=$1`, [after.assigned_to])).rows[0];
      if (cur?.role !== 'staff3') {
        const s3 = await pickUser(c, 'staff3');
        if (s3) await transferCustomer(c, { customerId: after.id, toUserId: s3, reason: `Category set to ${after.category.replace('_', ' ')} – auto-routed to Staff 3`, actor: u, automatic: true, ip: req.ip });
      }
    }
    if (before.lead_status !== 'won' && after.lead_status === 'won') {
      await notify(c, await ownerIds(c), { kind: 'deal_won', title: `Deal closed: ${after.name}`, body: `By ${u.name}`, customerId: after.id, link: `/customers/${after.id}` });
    }
    return after;
  });
  res.json({ customer: result });
});

customersRouter.post('/:id/notes', requireAuth(), async (req, res) => {
  const b = z.object({ note: z.string().trim().min(1).max(4000), kind: z.enum(['note', 'call', 'whatsapp', 'payment_followup']).default('note') }).parse(req.body);
  const c = await one(`SELECT id, assigned_to FROM customers WHERE id=$1`, [req.params.id]);
  if (!c) throw notFound();
  await activity(pool, c.id, req.user!.id, b.kind, b.note);
  await q(`UPDATE customers SET updated_at=now() WHERE id=$1`, [c.id]);
  res.status(201).json({ ok: true });
});

/** Log a new incoming enquiry (call / WhatsApp / complaint) against an existing customer. */
customersRouter.post('/:id/enquiries', requireAuth(), async (req, res) => {
  const b = z.object({ source: sourceEnum, notes: optText(2000), is_complaint: z.boolean().optional(), urgent: z.boolean().optional() }).parse(req.body);
  const u = req.user!;
  await tx(async (c) => {
    const cust = (await c.query(`SELECT * FROM customers WHERE id=$1`, [req.params.id])).rows[0];
    if (!cust) throw notFound();
    await c.query(`INSERT INTO enquiries(customer_id, source, is_complaint, urgent, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [cust.id, b.source, Boolean(b.is_complaint), Boolean(b.urgent), b.notes, u.id]);
    await activity(c, cust.id, u.id, b.is_complaint ? 'complaint' : 'enquiry', `${b.is_complaint ? (b.urgent ? 'URGENT complaint' : 'Complaint') : 'Enquiry'} via ${b.source}${b.notes ? ': ' + b.notes : ''}`);
    await c.query(`UPDATE customers SET updated_at=now() WHERE id=$1`, [cust.id]);
    if (b.is_complaint && b.urgent) await notifyUrgentComplaint(c, cust, b.notes);
    else if (cust.assigned_to && cust.assigned_to !== u.id) {
      await notify(c, [cust.assigned_to], { kind: 'enquiry', title: `${cust.name} contacted again (${b.source})`, body: b.notes ?? `Logged by ${u.name}`, priority: isPriorityCategory(cust.category) ? 'high' : 'normal', customerId: cust.id, link: `/customers/${cust.id}` });
    }
  });
  res.status(201).json({ ok: true });
});

customersRouter.post('/enquiries/:enquiryId/resolve', requireAuth(), async (req, res) => {
  const u = req.user!;
  await tx(async (c) => {
    const e = (await c.query(`SELECT e.*, c.assigned_to FROM enquiries e JOIN customers c ON c.id=e.customer_id WHERE e.id=$1`, [req.params.enquiryId])).rows[0];
    if (!e) throw notFound();
    if (!(u.role === 'owner' || u.role === 'staff3' || e.assigned_to === u.id)) throw forbidden();
    await c.query(`UPDATE enquiries SET resolved_at=now(), resolved_by=$1 WHERE id=$2 AND resolved_at IS NULL`, [u.id, e.id]);
    await activity(c, e.customer_id, u.id, 'resolved', 'Complaint marked resolved');
  });
  res.json({ ok: true });
});

customersRouter.post('/:id/transfer', requireAuth(), async (req, res) => {
  const b = z.object({ to_user_id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const u = req.user!;
  await tx(async (c) => {
    const cust = (await c.query(`SELECT * FROM customers WHERE id=$1`, [req.params.id])).rows[0];
    if (!cust) throw notFound();
    await assertCanTransfer(c, u, cust, b.to_user_id);
    await transferCustomer(c, { customerId: cust.id, toUserId: b.to_user_id, reason: b.reason, actor: u, ip: req.ip });
  });
  res.json({ ok: true });
});
