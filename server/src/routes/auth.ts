import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { one, q } from '../lib/db.js';
import { COOKIE, createSession, hashPassword, requireAuth, ROLE_LABEL, validatePasswordStrength, verifyPassword } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { HttpError, sha256 } from '../lib/util.js';

export const authRouter = Router();
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 12);

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.isTest ? 1000 : 20, standardHeaders: 'draft-8', legacyHeaders: false });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }).parse(req.body);
  const u = await one(`SELECT * FROM users WHERE lower(username)=lower($1)`, [body.username.trim()]);
  const fail = () => new HttpError(401, 'Wrong username or password');
  if (!u || !u.active) {
    await verifyPassword(body.password, DUMMY_HASH); // timing equaliser
    throw fail();
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, 'Account temporarily locked after failed attempts. Try again in 15 minutes.');
  const ok = await verifyPassword(body.password, u.password_hash);
  if (!ok) {
    const fails = u.failed_logins + 1;
    await q(`UPDATE users SET failed_logins=$1, locked_until = CASE WHEN $1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END WHERE id=$2`, [fails >= 5 ? 5 : fails, u.id]);
    if (fails >= 5) {
      await q(`UPDATE users SET failed_logins=0 WHERE id=$1`, [u.id]);
      await audit(null, { actor: null, action: 'auth.locked', entity: 'user', id: u.id, ip: req.ip });
    }
    throw fail();
  }
  await q(`UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1`, [u.id]);
  await createSession(u.id, req, res);
  await audit(null, { actor: u.id, action: 'auth.login', entity: 'user', id: u.id, ip: req.ip });
  res.json({ user: publicUser(u) });
});

authRouter.post('/logout', async (req, res) => {
  const t = req.cookies?.[COOKIE];
  if (t) await q(`UPDATE sessions SET revoked_at=now() WHERE token_hash=$1`, [sha256(t)]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth(), async (req, res) => {
  const u = await one(`SELECT * FROM users WHERE id=$1`, [req.user!.id]);
  res.json({ user: publicUser(u), demoMode: config.demoMode });
});

authRouter.post('/change-password', requireAuth(), async (req, res) => {
  const body = z.object({ currentPassword: z.string(), newPassword: z.string() }).parse(req.body);
  const u = await one(`SELECT * FROM users WHERE id=$1`, [req.user!.id]);
  if (!(await verifyPassword(body.currentPassword, u.password_hash))) throw new HttpError(400, 'Current password is wrong');
  validatePasswordStrength(body.newPassword);
  if (body.newPassword === body.currentPassword) throw new HttpError(400, 'Choose a different password');
  await q(`UPDATE users SET password_hash=$1, must_change_password=false, updated_at=now() WHERE id=$2`, [await hashPassword(body.newPassword), u.id]);
  // sign out every other device
  await q(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`, [u.id, req.user!.session_id]);
  await audit(null, { actor: u.id, action: 'auth.password_changed', entity: 'user', id: u.id, ip: req.ip });
  res.json({ ok: true });
});

export function publicUser(u: any) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    mobile: u.mobile,
    role: u.role,
    roleLabel: ROLE_LABEL[u.role as keyof typeof ROLE_LABEL],
    active: u.active,
    whatsapp_alerts: u.whatsapp_alerts,
    must_change_password: u.must_change_password,
    is_demo: u.is_demo,
    created_at: u.created_at,
  };
}
