// Demo data — ONLY runs with DEMO_MODE=true and only on a database without real records.
// Every demo customer is named "[DEMO] …" and flagged is_demo so it can never be mistaken for real data.
import type { AddressInfo } from 'node:net';
import { config } from '../config.js';
import { migrate, one, pool, q } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { buildApp } from '../app.js';
import { addDays, istToday } from '../lib/util.js';

if (!config.demoMode) {
  console.error('Refusing to seed: set DEMO_MODE=true. Demo data must never be loaded into production.');
  process.exit(1);
}
await migrate(false);
const real = await one(`SELECT (SELECT count(*) FROM users WHERE NOT is_demo) + (SELECT count(*) FROM customers WHERE NOT is_demo) AS n`);
if (Number(real.n) > 0) {
  console.error('Refusing to seed: this database already contains real (non-demo) records.');
  process.exit(1);
}

const PASS = 'DemoPass123';
const people = [
  ['Demo Owner', 'demo.owner', 'owner'],
  ['Demo Staff 1 (Calls)', 'demo.staff1', 'staff1'],
  ['Demo Staff 2 (WhatsApp)', 'demo.staff2', 'staff2'],
  ['Demo Staff 3 (Dealers)', 'demo.staff3', 'staff3'],
] as const;
const hash = await hashPassword(PASS);
for (const [name, username, role] of people) {
  await q(`INSERT INTO users(name, username, role, password_hash, must_change_password, is_demo) VALUES ($1,$2,$3,$4,false,true) ON CONFLICT (username) DO NOTHING`, [name, username, role, hash]);
}

const server = buildApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
async function login(username: string) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'yagami' }, body: JSON.stringify({ username, password: PASS }) });
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'yagami', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const j: any = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${j.error}`);
    return j;
  };
}
const s1 = await login('demo.staff1');
const s2 = await login('demo.staff2');
const s3 = await login('demo.staff3');
const today = istToday();

const mk = (api: any, b: any) => api('POST', '/customers', b).then((r: any) => r.customer);
const c1 = await mk(s1, { name: '[DEMO] Sharma Auto Parts', mobile: '9810000001', city: 'Delhi', state: 'Delhi', category: 'dealer', vehicle_model: 'Maruti Swift', requirement: 'Full dashboard harness x 20', source: 'phone' });
const c2 = await mk(s2, { name: '[DEMO] Rahul Verma', mobile: '9810000002', city: 'Gurugram', state: 'Haryana', category: 'retail', vehicle_model: 'Hyundai Creta', requirement: 'Headlight wiring kit', source: 'whatsapp', follow_up_date: today });
const c3 = await mk(s1, { name: '[DEMO] Singh Fleet Services', mobile: '9810000003', city: 'Noida', state: 'Uttar Pradesh', category: 'fleet_owner', vehicle_model: 'Tata Ace', requirement: 'Rear lamp harness x 50', source: 'phone' });
await mk(s1, { name: '[DEMO] Priya Mehta', mobile: '9810000004', city: 'Delhi', category: 'retail', vehicle_model: 'Honda City', requirement: 'Fog lamp wiring', source: 'phone', follow_up_date: addDays(today, -1) });
const c5 = await mk(s2, { name: '[DEMO] Gupta Motors (Reseller)', mobile: '9810000005', city: 'Faridabad', state: 'Haryana', category: 'reseller', requirement: 'Mixed harness stock', source: 'whatsapp', is_complaint: true, urgent: true, enquiry_notes: 'Last batch connector loose' });

const o1 = (await s3('POST', '/orders', { customer_id: c1.id, description: '20 x dashboard harness (Swift)', amount: '84000', payment_due_date: addDays(today, -3), invoice_ref: 'DEMO-INV-001' })).order;
await s3('POST', '/payments', { order_id: o1.id, amount: '30000', paid_at: new Date().toISOString(), method: 'upi', txn_ref: 'DEMO-UTR-0001', remarks: 'Advance (demo)' });
const o2 = (await s3('POST', '/orders', { customer_id: c3.id, description: '50 x rear lamp harness (Ace)', amount: '62500', payment_due_date: addDays(today, 7), invoice_ref: 'DEMO-INV-002' })).order;
await s3('PATCH', `/orders/${o2.id}`, { status: 'delivered' });
await s3('POST', '/payments', { order_id: o2.id, amount: '12500', paid_at: new Date().toISOString(), method: 'cash', remarks: 'Old pending (demo)' });
await s3('PATCH', `/customers/${c5.id}`, { payment_follow_up_date: today });
void c2;

await q(`UPDATE customers SET is_demo=true`);
await q(`UPDATE orders SET is_demo=true`);
await q(`UPDATE payments SET is_demo=true`);
await q(`INSERT INTO app_settings(key, value) VALUES ('demo_seeded', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ at: new Date().toISOString() })]);
server.close();
console.log(`Demo data loaded. Logins (password ${PASS}): ${people.map((p) => p[1]).join(', ')}`);
await pool.end();
