import type { Db } from './db.js';

/**
 * All figures for one IST business day. Used by the live dashboard and the 6 PM report,
 * so both always agree. Collected = payments in status recorded/verified only.
 */
export async function dayStats(db: Db, date: string) {
  const D = [date];
  const enq = (await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE source='phone')::int AS calls,
            count(*) FILTER (WHERE source='whatsapp')::int AS whatsapp,
            count(*) FILTER (WHERE source NOT IN ('phone','whatsapp'))::int AS other,
            count(*) FILTER (WHERE is_complaint)::int AS complaints,
            count(*) FILTER (WHERE is_complaint AND urgent)::int AS urgent_complaints
       FROM enquiries WHERE created_at >= ist_day_start($1::date) AND created_at < ist_day_start($1::date + 1)`, D)).rows[0];

  const leads = (await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE important)::int AS important,
            count(*) FILTER (WHERE NOT important)::int AS normal,
            count(*) FILTER (WHERE category <> 'retail')::int AS dealer_bulk
       FROM customers WHERE created_at >= ist_day_start($1::date) AND created_at < ist_day_start($1::date + 1)`, D)).rows[0];

  const orders = (await db.query(
    `SELECT count(*)::int AS count, COALESCE(SUM(amount),0)::numeric(14,2) AS value
       FROM orders WHERE status <> 'cancelled' AND confirmed_at >= ist_day_start($1::date) AND confirmed_at < ist_day_start($1::date + 1)`, D)).rows[0];

  const pay = (await db.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE kind='advance' AND payment_counts(status)),0)::numeric(14,2) AS advance,
            COALESCE(SUM(amount) FILTER (WHERE kind='old_pending' AND payment_counts(status)),0)::numeric(14,2) AS old_pending,
            COALESCE(SUM(amount) FILTER (WHERE payment_counts(status)),0)::numeric(14,2) AS total,
            COALESCE(SUM(amount) FILTER (WHERE status='verified'),0)::numeric(14,2) AS verified,
            COALESCE(SUM(amount) FILTER (WHERE status='recorded'),0)::numeric(14,2) AS unverified,
            count(*) FILTER (WHERE payment_counts(status))::int AS count,
            COALESCE(SUM(amount) FILTER (WHERE NOT payment_counts(status)),0)::numeric(14,2) AS excluded
       FROM payments WHERE paid_at >= ist_day_start($1::date) AND paid_at < ist_day_start($1::date + 1)`, D)).rows[0];

  const outstanding = (await db.query(
    `SELECT COALESCE(SUM(balance) FILTER (WHERE balance > 0),0)::numeric(14,2) AS total,
            count(DISTINCT customer_id) FILTER (WHERE balance > 0)::int AS customers,
            COALESCE(SUM(balance) FILTER (WHERE balance > 0 AND payment_due_date < $1::date),0)::numeric(14,2) AS overdue,
            count(*) FILTER (WHERE balance > 0 AND payment_due_date < $1::date)::int AS overdue_orders,
            count(DISTINCT customer_id) FILTER (WHERE balance > 0 AND payment_due_date < $1::date)::int AS overdue_customers
       FROM order_balances`, D)).rows[0];

  const followups = (await db.query(
    `SELECT count(*) FILTER (WHERE c.follow_up_date = $1::date AND c.lead_status NOT IN ('won','lost'))::int AS leads_due,
            count(*) FILTER (WHERE c.payment_follow_up_date = $1::date AND b.outstanding > 0)::int AS payments_due
       FROM customers c JOIN customer_balances b ON b.customer_id=c.id`, D)).rows[0];

  const missed = (await db.query(missedSql, D)).rows;

  const staff = (await db.query(
    `SELECT u.id, u.name, u.role,
       (SELECT count(*) FROM enquiries e WHERE e.created_by=u.id AND e.created_at >= ist_day_start($1::date) AND e.created_at < ist_day_start($1::date+1))::int AS enquiries,
       (SELECT count(*) FROM customers c WHERE c.created_by=u.id AND c.created_at >= ist_day_start($1::date) AND c.created_at < ist_day_start($1::date+1))::int AS leads_created,
       (SELECT count(*) FROM activities a WHERE a.user_id=u.id AND a.created_at >= ist_day_start($1::date) AND a.created_at < ist_day_start($1::date+1))::int AS actions,
       (SELECT count(*) FROM lead_transfers t WHERE t.transferred_by=u.id AND NOT t.automatic AND t.created_at >= ist_day_start($1::date) AND t.created_at < ist_day_start($1::date+1))::int AS transfers,
       (SELECT count(*) FROM orders o WHERE o.created_by=u.id AND o.status<>'cancelled' AND o.confirmed_at >= ist_day_start($1::date) AND o.confirmed_at < ist_day_start($1::date+1))::int AS orders_confirmed,
       (SELECT COALESCE(SUM(o.amount),0) FROM orders o WHERE o.created_by=u.id AND o.status<>'cancelled' AND o.confirmed_at >= ist_day_start($1::date) AND o.confirmed_at < ist_day_start($1::date+1))::numeric(14,2) AS order_value,
       (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.recorded_by=u.id AND payment_counts(p.status) AND p.paid_at >= ist_day_start($1::date) AND p.paid_at < ist_day_start($1::date+1))::numeric(14,2) AS collected,
       (SELECT count(*) FROM payments p WHERE p.verified_by=u.id AND p.verified_at >= ist_day_start($1::date) AND p.verified_at < ist_day_start($1::date+1))::int AS verified,
       (SELECT count(*) FROM customers c WHERE c.assigned_to=u.id AND c.follow_up_date=$1::date AND c.lead_status NOT IN ('won','lost'))::int AS followups_due,
       (SELECT count(*) FROM customers c WHERE c.assigned_to=u.id AND c.lead_status NOT IN ('won','lost'))::int AS open_leads
     FROM users u WHERE u.active ORDER BY u.role, u.name`, D)).rows.map((s) => ({ ...s, missed_followups: missed.filter((m) => m.assigned_to === s.id).length }));

  return {
    date,
    enquiries: enq,
    leads,
    orders,
    collections: pay,
    outstanding,
    followups: { ...followups, missed: missed.length },
    missedFollowups: missed,
    staff,
  };
}

/**
 * A follow-up is "missed" when it was due on or before the day and nobody logged any
 * activity on that customer between the due date and the end of the day.
 */
const missedSql = `
  SELECT c.id, c.name, c.mobile, c.assigned_to, u.name AS assigned_name, 'lead' AS type, c.follow_up_date AS due
    FROM customers c LEFT JOIN users u ON u.id=c.assigned_to
   WHERE c.lead_status NOT IN ('won','lost') AND c.follow_up_date <= $1::date
     AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.customer_id=c.id AND a.user_id IS NOT NULL
                      AND a.created_at >= ist_day_start(c.follow_up_date) AND a.created_at < ist_day_start($1::date + 1))
  UNION ALL
  SELECT c.id, c.name, c.mobile, c.assigned_to, u.name, 'payment', c.payment_follow_up_date
    FROM customers c JOIN customer_balances b ON b.customer_id=c.id LEFT JOIN users u ON u.id=c.assigned_to
   WHERE b.outstanding > 0 AND c.payment_follow_up_date <= $1::date
     AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.customer_id=c.id AND a.user_id IS NOT NULL
                      AND a.created_at >= ist_day_start(c.payment_follow_up_date) AND a.created_at < ist_day_start($1::date + 1))
  ORDER BY due`;

/** Staff 3's priority queue: dealers/bulk, pending & overdue payments, urgent complaints. */
export async function priorityQueue(db: Db, limit = 200) {
  const r = await db.query(
    `WITH comp AS (
       SELECT customer_id, count(*)::int AS n, bool_or(urgent) AS urgent FROM enquiries
        WHERE is_complaint AND resolved_at IS NULL GROUP BY customer_id
     ), base AS (
       SELECT c.id, c.code, c.name, c.mobile, c.city, c.category, c.lead_status, c.important,
              c.follow_up_date, c.payment_follow_up_date, c.assigned_to, u.name AS assigned_name,
              b.outstanding, b.overdue, b.earliest_due, COALESCE(comp.n,0) AS complaints, COALESCE(comp.urgent,false) AS urgent_complaint,
              (c.lead_status NOT IN ('won','lost')) AS open_lead
         FROM customers c JOIN customer_balances b ON b.customer_id=c.id
         LEFT JOIN users u ON u.id=c.assigned_to LEFT JOIN comp ON comp.customer_id=c.id
     )
     SELECT *,
       array_remove(ARRAY[
         CASE WHEN urgent_complaint THEN 'Urgent complaint' WHEN complaints > 0 THEN 'Open complaint' END,
         CASE WHEN overdue > 0 THEN 'Overdue payment' END,
         CASE WHEN outstanding > 0 AND overdue = 0 THEN 'Pending payment' END,
         CASE WHEN outstanding > 0 AND payment_follow_up_date <= ist_today() THEN 'Payment follow-up due' END,
         CASE WHEN category <> 'retail' AND open_lead THEN initcap(replace(category::text,'_',' ')) || ' enquiry' END,
         CASE WHEN important AND category = 'retail' AND open_lead THEN 'Important lead' END,
         CASE WHEN open_lead AND follow_up_date <= ist_today() THEN 'Follow-up due' END
       ], NULL) AS reasons,
       ( CASE WHEN urgent_complaint THEN 1000 WHEN complaints > 0 THEN 500 ELSE 0 END
       + CASE WHEN overdue > 0 THEN 400 + LEAST(ist_today() - earliest_due, 100) ELSE 0 END
       + CASE WHEN outstanding > 0 AND payment_follow_up_date <= ist_today() THEN 300 ELSE 0 END
       + CASE WHEN category <> 'retail' AND lead_status = 'new' THEN 250 ELSE 0 END
       + CASE WHEN outstanding > 0 THEN 150 ELSE 0 END
       + CASE WHEN (category <> 'retail' OR important) AND open_lead THEN 100 ELSE 0 END
       + CASE WHEN open_lead AND follow_up_date <= ist_today() THEN 50 ELSE 0 END ) AS urgency
     FROM base
     WHERE complaints > 0 OR outstanding > 0 OR ((category <> 'retail' OR important) AND open_lead)
     ORDER BY urgency DESC, LEAST(follow_up_date, payment_follow_up_date) ASC NULLS LAST, name
     LIMIT $1`,
    [limit],
  );
  return r.rows;
}
