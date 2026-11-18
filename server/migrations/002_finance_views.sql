-- Business-day helpers (Asia/Kolkata) and balance views.

CREATE OR REPLACE FUNCTION ist_today() RETURNS date AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date
$$ LANGUAGE sql STABLE;

-- Start of an IST calendar day as an absolute timestamp
CREATE OR REPLACE FUNCTION ist_day_start(d date) RETURNS timestamptz AS $$
  SELECT (d::timestamp AT TIME ZONE 'Asia/Kolkata')
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION ist_date(ts timestamptz) RETURNS date AS $$
  SELECT (ts AT TIME ZONE 'Asia/Kolkata')::date
$$ LANGUAGE sql IMMUTABLE;

-- A payment counts as collected only while it is 'recorded' or 'verified'.
-- Disputed, reversed and deleted payments are NEVER counted.
CREATE OR REPLACE FUNCTION payment_counts(s payment_status) RETURNS boolean AS $$
  SELECT s IN ('recorded', 'verified')
$$ LANGUAGE sql IMMUTABLE;

-- Orders that create a receivable (quoted and cancelled do not).
CREATE OR REPLACE FUNCTION order_billable(s order_status) RETURNS boolean AS $$
  SELECT s IN ('confirmed', 'in_production', 'dispatched', 'delivered')
$$ LANGUAGE sql IMMUTABLE;

CREATE VIEW order_balances AS
SELECT o.id AS order_id,
       o.customer_id,
       o.amount,
       o.status,
       o.payment_due_date,
       COALESCE(SUM(p.amount) FILTER (WHERE payment_counts(p.status)), 0)::numeric(14,2) AS received,
       COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'verified'), 0)::numeric(14,2)  AS received_verified,
       CASE WHEN order_billable(o.status)
            THEN o.amount - COALESCE(SUM(p.amount) FILTER (WHERE payment_counts(p.status)), 0)
            ELSE 0 END::numeric(14,2) AS balance
FROM orders o
LEFT JOIN payments p ON p.order_id = o.id
GROUP BY o.id;

CREATE VIEW customer_balances AS
SELECT c.id AS customer_id,
       COALESCE((SELECT SUM(o.amount) FROM orders o
                 WHERE o.customer_id = c.id AND order_billable(o.status)), 0)::numeric(14,2) AS total_orders,
       COALESCE((SELECT SUM(p.amount) FROM payments p
                 WHERE p.customer_id = c.id AND payment_counts(p.status)), 0)::numeric(14,2) AS total_received,
       COALESCE((SELECT SUM(p.amount) FROM payments p
                 WHERE p.customer_id = c.id AND p.status = 'recorded'), 0)::numeric(14,2) AS unverified_received,
       COALESCE((SELECT SUM(ob.balance) FROM order_balances ob
                 WHERE ob.customer_id = c.id AND ob.balance > 0), 0)::numeric(14,2) AS outstanding,
       COALESCE((SELECT SUM(ob.balance) FROM order_balances ob
                 WHERE ob.customer_id = c.id AND ob.balance > 0
                   AND ob.payment_due_date IS NOT NULL AND ob.payment_due_date < ist_today()), 0)::numeric(14,2) AS overdue,
       (SELECT MIN(ob.payment_due_date) FROM order_balances ob
                 WHERE ob.customer_id = c.id AND ob.balance > 0) AS earliest_due
FROM customers c;
