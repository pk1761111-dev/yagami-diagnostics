import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { one, q } from './db.js';
import { HttpError, randomToken, sha256 } from './util.js';

export type Role = 'owner' | 'staff1' | 'staff2' | 'staff3';
export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: Role;
  must_change_password: boolean;
  session_id: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE = 'yg_session';
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner / Admin',
  staff1: 'Staff 1 – Calls',
  staff2: 'Staff 2 – WhatsApp',
  staff3: 'Staff 3 – Dealers & Payments',
};

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const verifyPassword = (p: string, h: string) => bcrypt.compare(p, h);

export function validatePasswordStrength(p: string) {
  if (typeof p !== 'string' || p.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new HttpError(400, 'Password must contain letters and numbers');
}

export async function createSession(userId: string, req: Request, res: Response) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  await q(
    `INSERT INTO sessions(user_id, token_hash, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)`,
    [userId, sha256(token), expires, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300)],
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    expires,
    path: '/',
  });
}

export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  const row = await one(
    `SELECT s.id AS session_id, u.id, u.name, u.username, u.role, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
  if (row) {
    req.user = row as AuthUser;
    // cheap sliding "last seen" (at most once a minute)
    q(`UPDATE sessions SET last_seen = now() WHERE id=$1 AND last_seen < now() - interval '1 minute'`, [row.session_id]).catch(() => {});
  }
  next();
}

/** Requires a logged-in user; optionally restricts to roles. */
export function requireAuth(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please log in'));
    if (req.user.must_change_password && !req.path.startsWith('/auth') && !req.originalUrl.startsWith('/api/auth')) {
      return next(new HttpError(403, 'Please change your temporary password first'));
    }
    if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to do this'));
    next();
  };
}

/** CSRF defence: state-changing requests must carry a custom header (cannot be set cross-site without CORS). */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/whatsapp/webhook')) return next(); // signed by Meta instead
  if (req.headers['x-requested-with'] !== 'yagami') return next(new HttpError(403, 'Missing request header'));
  next();
}
