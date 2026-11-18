import cron from 'node-cron';
import { config } from '../config.js';
import { pool, one, tx } from './db.js';
import { dayStats } from './stats.js';
import { notify, ownerIds } from './notify.js';
import { addDays, istHour, istToday } from './util.js';

const LOCK_REPORT = 7_310_001;
const LOCK_REMIND = 7_310_002;

export async function generateReport(date: string, trigger: 'scheduler' | 'catch_up' | 'manual') {
  return tx(async (c) => {
    const data = await dayStats(c, date);
    const r = await c.query(
      `INSERT INTO daily_reports(report_date, data, trigger) VALUES ($1,$2,$3)
       ON CONFLICT (report_date) DO UPDATE SET data=EXCLUDED.data, trigger=EXCLUDED.trigger, generated_at=now()
       RETURNING id, report_date, generated_at, trigger`,
      [date, JSON.stringify(data), trigger],
    );
    if (trigger !== 'manual') {
      const s = data;
      await notify(c, await ownerIds(c), {
        kind: 'daily_report',
        title: `Daily report ready – ${date}`,
        body: `Enquiries ${s.enquiries.total} · Orders ₹${s.orders.value} · Collected ₹${s.collections.total} · Outstanding ₹${s.outstanding.total} · Missed follow-ups ${s.followups.missed}`,
        priority: 'high',
        link: `/reports/${date}`,
      });
    }
    return r.rows[0];
  });
}

/** Run fn only if this process wins a Postgres advisory lock (safe with several server instances). */
async function withLock<T>(key: number, fn: () => Promise<T>): Promise<T | undefined> {
  const c = await pool.connect();
  try {
    const got = (await c.query(`SELECT pg_try_advisory_lock($1) AS ok`, [key])).rows[0].ok;
    if (!got) return undefined;
    try {
      return await fn();
    } finally {
      await c.query(`SELECT pg_advisory_unlock($1)`, [key]);
    }
  } finally {
    c.release();
  }
}

/** On boot, fill in any report the server missed while it was down (last 7 days). */
export async function catchUpReports(now = new Date()) {
  return withLock(LOCK_REPORT, async () => {
    const today = istToday(now);
    const out: string[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = addDays(today, -i);
      if (d === today && istHour(now) < 18) continue;
      const exists = await one(`SELECT 1 FROM daily_reports WHERE report_date=$1`, [d]);
      // don't backfill before the system existed
      const started = await one(`SELECT 1 FROM users WHERE created_at < ist_day_start($1::date + 1) LIMIT 1`, [d]);
      if (!exists && started) {
        await generateReport(d, 'catch_up');
        out.push(d);
      }
    }
    return out;
  });
}

export async function sendDailyReminders(date = istToday()) {
  return withLock(LOCK_REMIND, async () => {
    const key = `reminders:${date}`;
    const done = await one(`SELECT 1 FROM app_settings WHERE key=$1`, [key]);
    if (done) return 0;
    let sent = 0;
    await tx(async (c) => {
      const users = (await c.query(`SELECT id, role FROM users WHERE active`)).rows;
      for (const u of users) {
        const f = (await c.query(
          `SELECT count(*) FILTER (WHERE follow_up_date = $2::date)::int AS today,
                  count(*) FILTER (WHERE follow_up_date < $2::date)::int AS overdue
             FROM customers WHERE assigned_to=$1 AND lead_status NOT IN ('won','lost') AND follow_up_date IS NOT NULL`,
          [u.id, date],
        )).rows[0];
        if (f.today + f.overdue > 0) {
          await notify(c, [u.id], { kind: 'followup_reminder', title: `Follow-ups today: ${f.today}${f.overdue ? ` (+${f.overdue} overdue)` : ''}`, body: 'Open "My follow-ups" to call these customers.', priority: f.overdue ? 'high' : 'normal', link: '/customers?followup=today' });
          sent++;
        }
        if (u.role === 'staff3' || u.role === 'owner') {
          const p = (await c.query(
            `SELECT count(*) FILTER (WHERE c.payment_follow_up_date <= $1::date)::int AS due,
                    count(*) FILTER (WHERE b.overdue > 0)::int AS overdue,
                    COALESCE(SUM(b.overdue),0)::numeric(14,2) AS overdue_amt
               FROM customers c JOIN customer_balances b ON b.customer_id=c.id WHERE b.outstanding > 0`,
            [date],
          )).rows[0];
          if (u.role === 'staff3' && p.due + p.overdue > 0) {
            await notify(c, [u.id], { kind: 'payment_reminder', title: `Payment follow-ups: ${p.due} due · ${p.overdue} overdue`, body: `Overdue amount ₹${p.overdue_amt}`, priority: 'high', link: '/queue' });
            sent++;
          }
        }
      }
      await c.query(`INSERT INTO app_settings(key, value) VALUES ($1, $2)`, [key, JSON.stringify({ at: new Date().toISOString(), sent })]);
    });
    return sent;
  });
}

/**
 * Run whatever is due right now: today's report after 6 PM IST (plus any missed days) and
 * the morning reminders after 9:30 AM IST. Safe to call repeatedly — every job is idempotent.
 * Called on boot and by /api/cron/run, so a free host that sleeps still produces the report
 * as soon as it is woken (e.g. by a free external pinger at 6:05 PM).
 */
export async function runDueJobs(now = new Date()) {
  const reports = (await catchUpReports(now)) ?? [];
  const mins = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(now).replace(':', ''));
  let reminders: number | undefined;
  if (mins >= 930 && mins < 1800) reminders = await sendDailyReminders(istToday(now));
  return { reports, reminders: reminders ?? 0 };
}

export function startScheduler() {
  cron.schedule(config.reportCron, () => {
    withLock(LOCK_REPORT, () => generateReport(istToday(), 'scheduler'))
      .then((r) => r && console.log(`[report] generated ${r.report_date}`))
      .catch((e) => console.error('[report] failed', e));
  }, { timezone: config.timezone, name: 'daily-report' });

  cron.schedule(config.reminderCron, () => {
    sendDailyReminders().catch((e) => console.error('[reminders] failed', e));
  }, { timezone: config.timezone, name: 'daily-reminders' });

  runDueJobs().then((r) => r.reports.length && console.log(`[report] caught up ${r.reports.join(', ')}`)).catch((e) => console.error('[jobs] catch-up failed', e));
  console.log(`[scheduler] daily report "${config.reportCron}" and reminders "${config.reminderCron}" (${config.timezone})`);
}

export function reportToCsv(data: any): string {
  const rows: (string | number)[][] = [];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // guard against spreadsheet formula injection
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  rows.push(['YAGAMI WIRE HARNESS – Daily Sales & Payment Report'], ['Date', data.date], []);
  rows.push(['ENQUIRIES'], ['Total', data.enquiries.total], ['Phone calls', data.enquiries.calls], ['WhatsApp', data.enquiries.whatsapp], ['Other', data.enquiries.other], ['Complaints', data.enquiries.complaints], []);
  rows.push(['LEADS'], ['New leads', data.leads.total], ['Important leads', data.leads.important], ['Normal leads', data.leads.normal], ['Dealer/bulk leads', data.leads.dealer_bulk], []);
  rows.push(['ORDERS'], ['Orders confirmed', data.orders.count], ['Order value (INR)', data.orders.value], []);
  rows.push(['COLLECTIONS (INR) – excludes disputed/reversed/deleted'], ['Advance payments', data.collections.advance], ['Old pending payments', data.collections.old_pending], ['Total collected', data.collections.total], ['of which verified', data.collections.verified], ['of which awaiting verification', data.collections.unverified], []);
  rows.push(['OUTSTANDING (INR)'], ['Total outstanding', data.outstanding.total], ['Customers with balance', data.outstanding.customers], ['Overdue amount', data.outstanding.overdue], ['Overdue orders', data.outstanding.overdue_orders], []);
  rows.push(['FOLLOW-UPS'], ['Lead follow-ups due', data.followups.leads_due], ['Payment follow-ups due', data.followups.payments_due], ['Missed follow-ups', data.followups.missed], []);
  rows.push(['STAFF ACTIVITY'], ['Staff', 'Role', 'Enquiries', 'Leads created', 'Actions', 'Transfers', 'Orders confirmed', 'Order value', 'Collected', 'Verified', 'Follow-ups due', 'Missed', 'Open leads']);
  for (const s of data.staff) rows.push([s.name, s.role, s.enquiries, s.leads_created, s.actions, s.transfers, s.orders_confirmed, s.order_value, s.collected, s.verified, s.followups_due, s.missed_followups, s.open_leads]);
  rows.push([], ['MISSED FOLLOW-UPS'], ['Customer', 'Mobile', 'Type', 'Due date', 'Assigned to']);
  for (const m of data.missedFollowups) rows.push([m.name, m.mobile, m.type, m.due, m.assigned_name ?? '']);
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
