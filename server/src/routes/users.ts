import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../lib/db.js';
import { hashPassword, requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { bad, conflict, notFound, normaliseMobile, tempPassword } from '../lib/util.js';
import { publicUser } from './auth.js';

export const usersRouter = Router();

const roleEnum = z.enum(['owner', 'staff1', 'staff2', 'staff3']);

// Everyone can see the active team list (needed for transfers); owner sees full details.
usersRouter.get('/', requireAuth(), async (req, res) => {
  if (req.user!.role === 'owner') {
    const r = await q(`SELECT * FROM users ORDER BY role, name`);
    const open = await q(`SELECT assigned_to, count(*)::int AS n FROM customers WHERE lead_status NOT IN ('won','lost') GROUP BY assigned_to`);
    const counts = Object.fromEntries(open.rows.map((x) => [x.assigned_to, x.n]));
    return res.json({ users: r.rows.map((u) => ({ ...publicUser(u), open_leads: counts[u.id] ?? 0 })) });
  }
  const r = await q(`SELECT id, name, role FROM users WHERE active ORDER BY role, name`);
  res.json({ users: r.rows });
});

usersRouter.post('/', requireAuth('owner'), async (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(2).max(80),
      username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Username: letters, numbers, . _ - only'),
      mobile: z.string().optional().nullable(),
      role: roleEnum,
      whatsapp_alerts: z.boolean().optional(),
    })
    .parse(req.body);
  const mobile = b.mobile ? normaliseMobile(b.mobile) : null;
  const exists = await one(`SELECT 1 FROM users WHERE lower(username)=lower($1)`, [b.username]);
  if (exists) throw conflict('Username already taken');
  const pwd = tempPassword();
  const u = await tx(async (c) => {
    const r = await c.query(
      `INSERT INTO users(name, username, mobile, role, password_hash, must_change_password, whatsapp_alerts)
       VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING *`,
      [b.name, b.username, mobile, b.role, await hashPassword(pwd), Boolean(b.whatsapp_alerts)],
    );
    await audit(c, { actor: req.user!.id, action: 'user.create', entity: 'user', id: r.rows[0].id, after: publicUser(r.rows[0]), ip: req.ip });
    return r.rows[0];
  });
  // Temporary password is shown ONCE to the owner; the staff member must change it on first login.
  res.status(201).json({ user: publicUser(u), temporaryPassword: pwd });
});

usersRouter.patch('/:id', requireAuth('owner'), async (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(2).max(80).optional(),
      mobile: z.string().nullable().optional(),
      role: roleEnum.optional(),
      active: z.boolean().optional(),
      whatsapp_alerts: z.boolean().optional(),
    })
    .parse(req.body);
  const out = await tx(async (c) => {
    const before = (await c.query(`SELECT * FROM users WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!before) throw notFound();
    if (before.id === req.user!.id && (b.active === false || (b.role && b.role !== 'owner'))) throw bad('You cannot deactivate or demote your own owner account');
    const mobile = b.mobile === undefined ? before.mobile : b.mobile ? normaliseMobile(b.mobile) : null;
    const r = await c.query(
      `UPDATE users SET name=$1, mobile=$2, role=$3, active=$4, whatsapp_alerts=$5, updated_at=now() WHERE id=$6 RETURNING *`,
      [b.name ?? before.name, mobile, b.role ?? before.role, b.active ?? before.active, b.whatsapp_alerts ?? before.whatsapp_alerts, before.id],
    );
    if (b.active === false) await c.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [before.id]);
    await audit(c, { actor: req.user!.id, action: 'user.update', entity: 'user', id: before.id, before: publicUser(before), after: publicUser(r.rows[0]), ip: req.ip });
    return r.rows[0];
  });
  // Deactivation never moves leads silently — owner is shown how many need reassigning.
  const open = await one(`SELECT count(*)::int AS n FROM customers WHERE assigned_to=$1 AND lead_status NOT IN ('won','lost')`, [out.id]);
  res.json({ user: publicUser(out), openLeadsNeedingReassignment: out.active ? 0 : open?.n ?? 0 });
});

usersRouter.post('/:id/reset-password', requireAuth('owner'), async (req, res) => {
  const u = await one(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
  if (!u) throw notFound();
  const pwd = tempPassword();
  await tx(async (c) => {
    await c.query(`UPDATE users SET password_hash=$1, must_change_password=true, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$2`, [await hashPassword(pwd), u.id]);
    await c.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [u.id]);
    await audit(c, { actor: req.user!.id, action: 'user.reset_password', entity: 'user', id: u.id, ip: req.ip });
  });
  res.json({ temporaryPassword: pwd });
});
