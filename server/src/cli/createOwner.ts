// Usage: OWNER_NAME="..." OWNER_USERNAME="owner" OWNER_PASSWORD="..." OWNER_MOBILE="98xxxxxxxx" npm run create-owner
import { migrate, one, pool, q } from '../lib/db.js';
import { hashPassword, validatePasswordStrength } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { normaliseMobile } from '../lib/util.js';

const name = process.env.OWNER_NAME;
const username = process.env.OWNER_USERNAME;
const password = process.env.OWNER_PASSWORD;
if (!name || !username || !password) {
  console.error('Set OWNER_NAME, OWNER_USERNAME and OWNER_PASSWORD (and optionally OWNER_MOBILE).');
  process.exit(1);
}
validatePasswordStrength(password);
await migrate(false);
if (await one(`SELECT 1 FROM users WHERE lower(username)=lower($1)`, [username])) {
  console.error(`User "${username}" already exists.`);
  process.exit(1);
}
const mobile = process.env.OWNER_MOBILE ? normaliseMobile(process.env.OWNER_MOBILE) : null;
const r = await q(
  `INSERT INTO users(name, username, mobile, role, password_hash, must_change_password, whatsapp_alerts) VALUES ($1,$2,$3,'owner',$4,false,$5) RETURNING id`,
  [name, username, mobile, await hashPassword(password), Boolean(mobile)],
);
await audit(null, { actor: r.rows[0].id, action: 'user.create_owner_cli', entity: 'user', id: r.rows[0].id });
console.log(`Owner account "${username}" created. Log in and add staff from the Team page.`);
await pool.end();
