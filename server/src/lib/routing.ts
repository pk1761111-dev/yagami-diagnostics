import type { Db } from './db.js';
import { activity, audit } from './audit.js';
import { notify, ownerIds } from './notify.js';
import type { AuthUser, Role } from './auth.js';
import { forbidden, bad } from './util.js';

/** Categories that must always be handled by Staff 3 (no minimum quantity). */
export const PRIORITY_CATEGORIES = ['dealer', 'reseller', 'bulk_buyer', 'fleet_owner', 'manufacturer'] as const;
export const isPriorityCategory = (c: string) => (PRIORITY_CATEGORIES as readonly string[]).includes(c);

const OPEN_LEAD = `lead_status NOT IN ('won','lost')`;

/** Least-loaded active user in a role (open leads), or null. */
export async function pickUser(db: Db, role: Role): Promise<string | null> {
  const r = await db.query(
    `SELECT u.id FROM users u
       LEFT JOIN customers c ON c.assigned_to = u.id AND c.${OPEN_LEAD}
      WHERE u.role = $1 AND u.active
      GROUP BY u.id ORDER BY count(c.id), u.created_at LIMIT 1`,
    [role],
  );
  return r.rows[0]?.id ?? null;
}

/** Decide the initial owner of a new customer. */
export async function initialAssignee(db: Db, creator: AuthUser, category: string, source: string): Promise<{ userId: string; reason: string; priority: boolean }> {
  if (isPriorityCategory(category)) {
    const s3 = await pickUser(db, 'staff3');
    if (s3) return { userId: s3, reason: `Auto-routed: ${category.replace('_', ' ')} customers are handled by Staff 3`, priority: true };
    const owner = (await ownerIds(db))[0];
    return { userId: owner, reason: 'Auto-routed to Owner: no active Staff 3 account', priority: true };
  }
  if (creator.role === 'staff1' || creator.role === 'staff2') {
    return { userId: creator.id, reason: 'Created by assigned staff', priority: false };
  }
  const role: Role = source === 'whatsapp' ? 'staff2' : 'staff1';
  const u = (await pickUser(db, role)) ?? (await pickUser(db, role === 'staff1' ? 'staff2' : 'staff1')) ?? creator.id;
  return { userId: u, reason: `Retail ${source} enquiry routed to ${role === 'staff1' ? 'Staff 1' : 'Staff 2'}`, priority: false };
}

/**
 * Move a customer to another user. Always records a transfer row, an audit entry,
 * a timeline entry and notifications — ownership is never changed silently.
 */
export async function transferCustomer(
  db: Db,
  opts: { customerId: string; toUserId: string; reason: string; actor: AuthUser | null; automatic?: boolean; ip?: string },
) {
  const c = (await db.query(`SELECT id, name, mobile, category, assigned_to FROM customers WHERE id=$1 FOR UPDATE`, [opts.customerId])).rows[0];
  if (!c) throw bad('Customer not found');
  if (c.assigned_to === opts.toUserId) return false;
  const target = (await db.query(`SELECT id, name, role, active FROM users WHERE id=$1`, [opts.toUserId])).rows[0];
  if (!target || !target.active) throw bad('Target staff member is not active');

  await db.query(`UPDATE customers SET assigned_to=$1, updated_at=now() WHERE id=$2`, [opts.toUserId, c.id]);
  await db.query(
    `INSERT INTO lead_transfers(customer_id, from_user, to_user, reason, automatic, transferred_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [c.id, c.assigned_to, opts.toUserId, opts.reason, Boolean(opts.automatic), opts.actor?.id ?? null],
  );
  const fromName = c.assigned_to ? (await db.query(`SELECT name FROM users WHERE id=$1`, [c.assigned_to])).rows[0]?.name : 'Unassigned';
  await activity(db, c.id, opts.actor?.id ?? null, 'transfer', `Lead transferred from ${fromName} to ${target.name}. Reason: ${opts.reason}`, {
    from: c.assigned_to,
    to: opts.toUserId,
    automatic: Boolean(opts.automatic),
  });
  await audit(db, {
    actor: opts.actor?.id ?? null,
    action: opts.automatic ? 'lead.auto_transfer' : 'lead.transfer',
    entity: 'customer',
    id: c.id,
    before: { assigned_to: c.assigned_to },
    after: { assigned_to: opts.toUserId },
    reason: opts.reason,
    ip: opts.ip,
  });

  const priority = target.role === 'staff3' || isPriorityCategory(c.category);
  const title = priority ? `Priority lead assigned: ${c.name}` : `Lead assigned to you: ${c.name}`;
  await notify(db, [opts.toUserId], { kind: 'lead_assigned', title, body: opts.reason, priority: priority ? 'high' : 'normal', customerId: c.id, link: `/customers/${c.id}` });
  // Owner gets all transfers; previous owner is told the lead left them.
  await notify(db, await ownerIds(db), {
    kind: 'lead_transfer',
    title: `${priority ? 'Priority lead' : 'Lead'} moved to ${target.name}: ${c.name}`,
    body: `From ${fromName}. ${opts.reason}`,
    priority: priority ? 'high' : 'normal',
    customerId: c.id,
    link: `/customers/${c.id}`,
  });
  if (c.assigned_to && c.assigned_to !== opts.actor?.id) {
    await notify(db, [c.assigned_to], { kind: 'lead_removed', title: `${c.name} moved to ${target.name}`, body: opts.reason, customerId: c.id, link: `/customers/${c.id}` });
  }
  return true;
}

/** Permission rules for manual transfers. */
export async function assertCanTransfer(db: Db, actor: AuthUser, customer: { assigned_to: string | null }, toUserId: string) {
  if (actor.role === 'owner') return;
  const target = (await db.query(`SELECT role FROM users WHERE id=$1 AND active`, [toUserId])).rows[0];
  if (!target) throw bad('Target staff member is not active');
  if ((actor.role === 'staff1' || actor.role === 'staff2') && customer.assigned_to === actor.id && target.role === 'staff3') return;
  throw forbidden('Only the Owner can reassign this lead. Staff 1 and Staff 2 can transfer their own leads to Staff 3.');
}
