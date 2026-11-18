import type { Response } from 'express';
import { pool, type Db } from './db.js';
import { config } from '../config.js';
import { kickOutbox } from './whatsapp.js';

// ---- Server-Sent Events hub (in-app real-time alerts) ----
const streams = new Map<string, Set<Response>>();

export function addStream(userId: string, res: Response) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId)!.add(res);
  res.on('close', () => streams.get(userId)?.delete(res));
}

function push(userId: string, payload: unknown) {
  const set = streams.get(userId);
  if (!set) return;
  const data = `event: notification\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const r of set) r.write(data);
}

export interface NotifyInput {
  kind: string;
  title: string;
  body?: string;
  priority?: 'normal' | 'high';
  customerId?: string | null;
  link?: string | null;
}

/**
 * Create in-app notifications for each user. High-priority ones are also queued for
 * WhatsApp delivery for users who opted in. Delivery status is only ever advanced
 * by the real Cloud API response / webhook — never assumed.
 */
export async function notify(db: Db, userIds: (string | null | undefined)[], n: NotifyInput) {
  const unique = [...new Set(userIds.filter(Boolean) as string[])];
  const created: { userId: string; row: any }[] = [];
  for (const uid of unique) {
    const r = await db.query(
      `INSERT INTO notifications(user_id, kind, title, body, priority, customer_id, link)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [uid, n.kind, n.title, n.body ?? null, n.priority ?? 'normal', n.customerId ?? null, n.link ?? null],
    );
    const row = r.rows[0];
    created.push({ userId: uid, row });
    if ((n.priority ?? 'normal') === 'high') {
      await db.query(
        `INSERT INTO notification_deliveries(notification_id, to_number)
         SELECT $1, u.mobile FROM users u WHERE u.id=$2 AND u.whatsapp_alerts AND u.mobile IS NOT NULL`,
        [row.id, uid],
      );
    }
  }
  // Push after the surrounding transaction has had a chance to commit.
  setImmediate(() => created.forEach((c) => push(c.userId, c.row)));
  if (!config.isTest && created.length && (n.priority ?? 'normal') === 'high') kickOutbox();
}

export async function ownerIds(db: Db = pool): Promise<string[]> {
  const r = await db.query(`SELECT id FROM users WHERE role='owner' AND active`);
  return r.rows.map((x) => x.id);
}
