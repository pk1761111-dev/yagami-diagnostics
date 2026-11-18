import type { Db } from './db.js';
import { pool } from './db.js';

export async function audit(
  db: Db | null | undefined,
  a: { actor: string | null; action: string; entity: string; id?: string | null; before?: unknown; after?: unknown; reason?: string | null; ip?: string | null },
) {
  await (db ?? pool).query(
    `INSERT INTO audit_log(actor_id, action, entity_type, entity_id, before, after, reason, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.actor, a.action, a.entity, a.id ?? null, a.before ? JSON.stringify(a.before) : null, a.after ? JSON.stringify(a.after) : null, a.reason ?? null, a.ip ?? null],
  );
}

export async function activity(db: Db, customerId: string, userId: string | null, kind: string, message: string, meta?: unknown) {
  await db.query(`INSERT INTO activities(customer_id, user_id, kind, message, meta) VALUES ($1,$2,$3,$4,$5)`, [
    customerId,
    userId,
    kind,
    message,
    meta ? JSON.stringify(meta) : null,
  ]);
}
