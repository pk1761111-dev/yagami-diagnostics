-- YAGAMI AI – Sales & Payment Control : initial schema
-- All timestamps are timestamptz (stored UTC). Business-day logic uses Asia/Kolkata.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Enums ----------
CREATE TYPE user_role AS ENUM ('owner', 'staff1', 'staff2', 'staff3');
CREATE TYPE customer_category AS ENUM ('retail', 'dealer', 'reseller', 'bulk_buyer', 'fleet_owner', 'manufacturer');
CREATE TYPE enquiry_source AS ENUM ('phone', 'whatsapp', 'walk_in', 'website', 'referral', 'other');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'interested', 'quoted', 'won', 'lost');
CREATE TYPE order_status AS ENUM ('quoted', 'confirmed', 'in_production', 'dispatched', 'delivered', 'cancelled');
CREATE TYPE payment_method AS ENUM ('upi', 'bank_transfer', 'cash');
CREATE TYPE payment_kind AS ENUM ('advance', 'old_pending');
CREATE TYPE payment_status AS ENUM ('recorded', 'verified', 'disputed', 'reversed', 'deleted');
CREATE TYPE delivery_status AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed', 'not_configured');

-- ---------- Users & sessions ----------
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  username        text NOT NULL UNIQUE,
  mobile          text,
  role            user_role NOT NULL,
  password_hash   text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  active          boolean NOT NULL DEFAULT true,
  whatsapp_alerts boolean NOT NULL DEFAULT false,
  failed_logins   int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  ip          text,
  user_agent  text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ---------- Files (payment proofs) ----------
CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name text NOT NULL,
  mime          text NOT NULL,
  size_bytes    int NOT NULL,
  sha256        text NOT NULL,
  storage_name  text NOT NULL UNIQUE,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Customers (one row per customer; carries lead state) ----------
CREATE SEQUENCE customer_code_seq START 1001;
CREATE TABLE customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE DEFAULT ('YC-' || nextval('customer_code_seq')),
  name            text NOT NULL,
  mobile          text NOT NULL UNIQUE,         -- normalised 10-digit Indian mobile
  city            text,
  state           text,
  category        customer_category NOT NULL DEFAULT 'retail',
  vehicle_model   text,
  requirement     text,
  source          enquiry_source NOT NULL,
  assigned_to     uuid REFERENCES users(id),
  lead_status     lead_status NOT NULL DEFAULT 'new',
  important       boolean NOT NULL DEFAULT false,
  notes           text,
  follow_up_date  date,
  payment_follow_up_date date,
  created_by      uuid NOT NULL REFERENCES users(id),
  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_assigned_idx ON customers(assigned_to);
CREATE INDEX customers_followup_idx ON customers(follow_up_date);
CREATE INDEX customers_name_idx ON customers(lower(name));

-- Each incoming call / WhatsApp / complaint is logged as an enquiry
CREATE TABLE enquiries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES customers(id),
  source       enquiry_source NOT NULL,
  is_complaint boolean NOT NULL DEFAULT false,
  urgent       boolean NOT NULL DEFAULT false,
  notes        text,
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users(id),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enquiries_created_idx ON enquiries(created_at);
CREATE INDEX enquiries_customer_idx ON enquiries(customer_id);

-- Customer timeline (non-financial activity: notes, calls, status changes, transfers)
CREATE TABLE activities (
  id          bigserial PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  user_id     uuid REFERENCES users(id),
  kind        text NOT NULL,
  message     text NOT NULL,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_customer_idx ON activities(customer_id, created_at DESC);
CREATE INDEX activities_user_day_idx ON activities(user_id, created_at);

CREATE TABLE lead_transfers (
  id            bigserial PRIMARY KEY,
  customer_id   uuid NOT NULL REFERENCES customers(id),
  from_user     uuid REFERENCES users(id),
  to_user       uuid NOT NULL REFERENCES users(id),
  reason        text NOT NULL,
  automatic     boolean NOT NULL DEFAULT false,
  transferred_by uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Orders ----------
CREATE SEQUENCE order_no_seq START 5001;
CREATE TABLE orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no      text NOT NULL UNIQUE DEFAULT ('YO-' || nextval('order_no_seq')),
  invoice_ref   text,
  customer_id   uuid NOT NULL REFERENCES customers(id),
  description   text NOT NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount >= 0),
  status        order_status NOT NULL DEFAULT 'confirmed',
  payment_due_date date,
  confirmed_at  timestamptz,
  created_by    uuid NOT NULL REFERENCES users(id),
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON orders(customer_id);

-- ---------- Payments ----------
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id),
  order_id        uuid NOT NULL REFERENCES orders(id),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_at         timestamptz NOT NULL,
  method          payment_method NOT NULL,
  kind            payment_kind NOT NULL,
  txn_ref         text,
  proof_file_id   uuid REFERENCES files(id),
  recorded_by     uuid NOT NULL REFERENCES users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  status          payment_status NOT NULL DEFAULT 'recorded',
  verified_by     uuid REFERENCES users(id),
  verified_at     timestamptz,
  status_changed_by uuid REFERENCES users(id),
  status_changed_at timestamptz,
  status_reason   text,
  remarks         text,
  is_demo         boolean NOT NULL DEFAULT false
);
CREATE INDEX payments_customer_idx ON payments(customer_id);
CREATE INDEX payments_order_idx ON payments(order_id);
CREATE INDEX payments_paid_idx ON payments(paid_at);
-- Duplicate guard: the same non-cash transaction reference cannot be counted twice
CREATE UNIQUE INDEX payments_txn_unique ON payments(method, lower(txn_ref))
  WHERE txn_ref IS NOT NULL AND status IN ('recorded', 'verified');

-- Financial core fields are immutable. Corrections = reverse + re-enter.
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted; change status instead';
  END IF;
  IF NEW.customer_id <> OLD.customer_id OR NEW.order_id <> OLD.order_id
     OR NEW.amount <> OLD.amount OR NEW.paid_at <> OLD.paid_at
     OR NEW.method <> OLD.method OR NEW.kind <> OLD.kind
     OR NEW.recorded_by <> OLD.recorded_by OR NEW.recorded_at <> OLD.recorded_at
     OR COALESCE(NEW.txn_ref,'') <> COALESCE(OLD.txn_ref,'') THEN
    RAISE EXCEPTION 'Payment financial fields are immutable';
  END IF;
  IF OLD.status IN ('reversed', 'deleted') THEN
    RAISE EXCEPTION 'Payment % is final and cannot change', OLD.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER payments_guard_trg BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- ---------- Audit log (append-only) ----------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log(entity_type, entity_id);
CREATE INDEX audit_created_idx ON audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();

-- ---------- Notifications ----------
CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  priority    text NOT NULL DEFAULT 'normal',  -- normal | high
  customer_id uuid REFERENCES customers(id),
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE notification_deliveries (
  id                  bigserial PRIMARY KEY,
  notification_id     bigint NOT NULL REFERENCES notifications(id),
  channel             text NOT NULL DEFAULT 'whatsapp',
  to_number           text,
  status              delivery_status NOT NULL DEFAULT 'queued',
  provider_message_id text UNIQUE,
  attempts            int NOT NULL DEFAULT 0,
  last_error          text,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_queue_idx ON notification_deliveries(status, next_attempt_at);

-- ---------- Daily reports ----------
CREATE TABLE daily_reports (
  id           bigserial PRIMARY KEY,
  report_date  date NOT NULL UNIQUE,
  data         jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  trigger      text NOT NULL            -- scheduler | catch_up | manual
);

-- Single settings row (demo flag etc.)
CREATE TABLE app_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
