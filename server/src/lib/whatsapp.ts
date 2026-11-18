import crypto from 'node:crypto';
import { config, whatsappConfigured } from '../config.js';
import { q } from './db.js';

/**
 * WhatsApp Cloud API delivery worker.
 * Status rules (no faking):
 *  - not_configured : credentials/template missing — nothing was sent
 *  - sent           : Cloud API accepted the message and returned a message id
 *  - delivered/read : only set from Meta's signed webhook status callbacks
 *  - failed         : API error after retries, or webhook reported failure
 */
const MAX_ATTEMPTS = 5;

export async function processOutbox(fetchImpl: typeof fetch = fetch) {
  // Claim a batch with a short lease so parallel workers never double-send.
  const rows = (await q(
    `WITH claimed AS (
       UPDATE notification_deliveries SET next_attempt_at = now() + interval '2 minutes'
        WHERE id IN (SELECT id FROM notification_deliveries WHERE status='queued' AND next_attempt_at <= now()
                      ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
       RETURNING *)
     SELECT d.*, n.title, n.body FROM claimed d JOIN notifications n ON n.id=d.notification_id ORDER BY d.id`,
  )).rows;
  for (const d of rows) {
    if (!whatsappConfigured()) {
      await q(`UPDATE notification_deliveries SET status='not_configured', last_error='WhatsApp Cloud API credentials not set', updated_at=now() WHERE id=$1`, [d.id]);
      continue;
    }
    if (!d.to_number) {
      await q(`UPDATE notification_deliveries SET status='failed', last_error='No mobile number', updated_at=now() WHERE id=$1`, [d.id]);
      continue;
    }
    const text = `${d.title}${d.body ? ' – ' + d.body : ''}`.replace(/\s+/g, ' ').slice(0, 900);
    try {
      const resp = await fetchImpl(`https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: `91${d.to_number}`,
          type: 'template',
          template: { name: config.whatsapp.templateName, language: { code: config.whatsapp.templateLang }, components: [{ type: 'body', parameters: [{ type: 'text', text }] }] },
        }),
      });
      const json: any = await resp.json().catch(() => ({}));
      const id = json?.messages?.[0]?.id;
      if (resp.ok && id) {
        await q(`UPDATE notification_deliveries SET status='sent', provider_message_id=$1, attempts=attempts+1, last_error=NULL, updated_at=now() WHERE id=$2`, [id, d.id]);
      } else {
        throw new Error(json?.error?.message ?? `HTTP ${resp.status}`);
      }
    } catch (e: any) {
      const attempts = d.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await q(
        `UPDATE notification_deliveries SET status=$1, attempts=$2, last_error=$3, next_attempt_at=now() + ($4 || ' minutes')::interval, updated_at=now() WHERE id=$5`,
        [final ? 'failed' : 'queued', attempts, String(e.message).slice(0, 500), String(2 ** attempts), d.id],
      );
    }
  }
  return rows.length;
}

/**
 * Event-driven worker: runs shortly after a WhatsApp alert is queued, plus a slow sweep for retries.
 * It deliberately does NOT poll the database every few seconds, so a scale-to-zero database
 * (e.g. Neon free plan) can sleep when nobody is using the app.
 */
let timer: NodeJS.Timeout | null = null;
export function kickOutbox(delayMs = 2000) {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    try {
      await processOutbox();
      if (whatsappConfigured()) {
        const next = (await q(`SELECT EXTRACT(EPOCH FROM (min(next_attempt_at) - now())) AS s FROM notification_deliveries WHERE status='queued'`)).rows[0]?.s;
        if (next !== null && next !== undefined) kickOutbox(Math.max(5, Number(next)) * 1000 + 500);
      }
    } catch (e: any) {
      console.error('[whatsapp] worker error', e.message);
    }
  }, delayMs);
  timer.unref();
}

export function startOutboxWorker() {
  kickOutbox(5000); // pick up anything left from before a restart
  setInterval(() => whatsappConfigured() && kickOutbox(0), 30 * 60_000).unref();
}

export function verifySignature(raw: Buffer, header: string | undefined): boolean {
  if (!config.whatsapp.appSecret || !header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', config.whatsapp.appSecret).update(raw).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Apply message status callbacks from Meta's webhook. */
export async function applyWebhook(body: any) {
  let n = 0;
  for (const entry of body?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      for (const s of ch?.value?.statuses ?? []) {
        const map: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
        const st = map[s.status];
        if (!st || !s.id) continue;
        const err = s.errors?.[0]?.title ?? null;
        // never move backwards (e.g. read -> delivered)
        const r = await q(
          `UPDATE notification_deliveries SET status=$1::delivery_status, last_error=COALESCE($2, last_error), updated_at=now()
            WHERE provider_message_id=$3 AND (
              ($1 = 'failed') OR
              (array_position(ARRAY['queued','sent','delivered','read']::delivery_status[], status) < array_position(ARRAY['queued','sent','delivered','read']::delivery_status[], $1::delivery_status)))`,
          [st, err, s.id],
        );
        n += r.rowCount ?? 0;
      }
    }
  }
  return n;
}
