# YAGAMI AI – Sales & Payment Control

CRM for **YAGAMI WIRE HARNESS, Delhi**: leads, dealer routing, orders, payment collection with proof, daily 6 PM report.
Currency INR · Timezone Asia/Kolkata · Mobile-first PWA (installable on Android) + desktop.

**Stack:** React + TypeScript (Vite) PWA · Node.js + Express + TypeScript · PostgreSQL 16

---

**Free hosting (Render + Neon):** see FREE_HOSTING_GUIDE.md.

## 1. Run it on a server (Docker)

You need a small Linux VPS (1 GB RAM is enough) with Docker, and a domain/sub-domain (e.g. `crm.yagami.in`).

```bash
cp .env.example .env            # then edit: set POSTGRES_PASSWORD (long random)
docker compose up -d --build    # starts database, app, nightly backups

# create YOUR owner login (once)
docker compose exec -e OWNER_NAME="Your Name" -e OWNER_USERNAME="owner" \
  -e OWNER_PASSWORD="a-strong-password-123" -e OWNER_MOBILE="98xxxxxxxx" app npm run create-owner
```

Put HTTPS in front (required – login cookies are `Secure`). Easiest is Caddy:

```
crm.yagami.in {
    reverse_proxy 127.0.0.1:8080
}
```

Open `https://crm.yagami.in`, log in as owner → **Team** → **Add staff** for each of your 3 employees.
Each gets a one-time temporary password and must set their own at first login (no shared passwords).

On Android: open the site in Chrome → menu → **Add to Home screen**. It opens like an app.

## 2. Roles

| | Owner | Staff 1 (calls) | Staff 2 (WhatsApp) | Staff 3 (dealers & payments) |
|---|---|---|---|---|
| Create customers / log enquiries & notes | ✓ | ✓ | ✓ | ✓ |
| Edit customer | all | own | own | own (+ payment follow-up on any) |
| Transfer lead | any → anyone | own → Staff 3 | own → Staff 3 | – |
| See amounts / payments | ✓ | “payment pending” flag only | flag only | ✓ |
| Record payment, upload proof, verify | ✓ | – | – | ✓ |
| Delete wrong entry | ✓ | – | – | own unverified, within 24 h |
| Dispute / reverse / reinstate payment | ✓ | – | – | – |
| Change confirmed order value | ✓ (reason required) | – | – | – |
| Priority queue | ✓ | – | – | ✓ |
| Reports, CSV, Team, Audit log | ✓ | – | – | – |

All rules are enforced in the backend APIs, not just hidden in the screens.

## 3. Business rules built in

- **Routing:** Dealer, Reseller, Bulk Buyer, Fleet Owner, Manufacturer → always Staff 3 (no minimum quantity), on creation **and** if a customer is later re-categorised. Retail phone → Staff 1, retail WhatsApp → Staff 2.
- **Never silent:** every ownership change writes a transfer record, timeline entry, audit entry, and notifies the new owner + Owner (high priority for Staff 3).
- **Money is counted only when** a payment is `recorded` or `verified`. Disputed, reversed and deleted payments are never counted. Quotations and cancelled orders are not receivables.
- **Outstanding** = confirmed order value − counted payments. **Overdue** = outstanding past the order's “payment due by” date.
- **Advance vs old pending:** suggested automatically (before dispatch = advance, after dispatch/delivery = old pending), editable when recording.
- **Safeguards:** can't pay more than the order balance; UTR required for UPI/bank; duplicate UTR blocked; future dates blocked; verification requires a proof file.
- **Immutable history:** PostgreSQL triggers block editing amount/date/method of any payment, block deleting payments, and make the audit log append-only. Corrections are done by reversing and re-entering.
- **Missed follow-up:** due on/before the day with no staff action on that customer since the due date.

## 4. Daily report & reminders

- Server generates and saves the report **every day at 6:00 PM IST** (node-cron in the server process, Asia/Kolkata). If the server was down, it back-fills missed days (last 7) on start-up. A Postgres advisory lock prevents duplicates if you ever run two instances.
- Owner is notified when it's ready; **Reports** page shows every day with CSV download.
- 9:30 AM IST: each staff member gets their follow-ups for the day; Staff 3 gets payment follow-ups/overdue reminders.
- Fallback if you prefer system cron: `docker compose exec app npm run report:generate`.

## 5. Notifications & WhatsApp

In-app alerts are live (Server-Sent Events) with a sound + vibration, read/unread and history. Tap the speaker icon once on each phone to enable sound (browsers require one tap).

WhatsApp Cloud API is **prepared but off until you add credentials** in `.env`:
1. In Meta Business → WhatsApp → create an **approved Utility template** (e.g. name `crm_alert`, body: `YAGAMI CRM alert: {{1}}`).
2. Fill `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
3. Set the webhook URL to `https://crm.yagami.in/api/whatsapp/webhook` with your verify token and subscribe to `messages`.
4. In **Team**, add each person's mobile and tick “WhatsApp alerts”.

Statuses shown are honest: `not configured` → nothing sent; `sent` → Meta accepted it; `delivered`/`read` only after Meta's signed webhook confirms; failures retry 5× with back-off and show the error.

## 6. Security

Individual accounts (bcrypt), server-side sessions in httpOnly/SameSite=strict/Secure cookies, 5-attempt lockout, login rate-limit, anti-CSRF header, strict CSP via Helmet, Zod validation on every input, upload type checked from file bytes (JPG/PNG/WEBP/PDF only, 5 MB max), proofs served only to Owner/Staff 3, all secrets server-side env vars only.

## 7. Backups

The `backup` service dumps the database and payment-proof files at start-up and every night at 23:30 IST into `./backups/`, keeping 30 days. **Copy that folder off the server** regularly (Google Drive / another machine) — a backup on the same disk doesn't protect against losing the server.

Restore: `docker compose exec -T db pg_restore -U yagami -d yagami_crm --clean --if-exists < backups/yagami_crm_<date>.dump`

## 8. Demo mode (separate database only)

```bash
DEMO_MODE=true DATABASE_URL=postgres://.../yagami_demo npm --prefix server run seed:demo
```
Refuses to run unless `DEMO_MODE=true` **and** the database has no real records. Demo customers are named `[DEMO] …`, flagged `is_demo`, and the app shows a striped DEMO MODE banner. Logins: `demo.owner`, `demo.staff1`, `demo.staff2`, `demo.staff3` / `DemoPass123`. Production has no sample data.

## 9. Development & tests

```bash
# Postgres running locally, DB yagami_crm + yagami_test owned by yagami/yagami
cd server && npm i && npm run dev        # API on :8080 (runs migrations automatically)
cd web && npm i && npm run dev           # UI on :5173, proxies /api
cd server && npm test                    # 26 integration tests against real Postgres
```

Tests cover: login/lockout/forced password change/CSRF, every role restriction, all 5 priority categories routing to Staff 3, re-categorisation auto-transfer, transfer permissions, money hidden from Staff 1/2, paise-exact balances, over-payment / duplicate UTR / missing UTR / future-date rejection, proof-required verification, fake-file and oversize upload rejection, dispute/reinstate/reverse/delete effects on totals, DB-level immutability, advance vs old-pending split on the dashboard, order-value change rules, priority-queue ranking, missed follow-ups, report + CSV, report catch-up idempotency, notification read/unread, and WhatsApp honest delivery states with signed webhooks.
