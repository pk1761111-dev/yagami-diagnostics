import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './lib/db.js';
import { startScheduler } from './lib/reports.js';
import { startOutboxWorker } from './lib/whatsapp.js';

await migrate();

// First-run bootstrap for hosts without a shell (e.g. Render free): creates the Owner once.
// The password must be changed at first login, so the env value stops being useful afterwards.
if (process.env.BOOTSTRAP_OWNER_USERNAME && process.env.BOOTSTRAP_OWNER_PASSWORD) {
  const { one, q } = await import('./lib/db.js');
  const { hashPassword, validatePasswordStrength } = await import('./lib/auth.js');
  const anyOwner = await one(`SELECT 1 FROM users WHERE role='owner' AND NOT is_demo LIMIT 1`);
  if (!anyOwner) {
    validatePasswordStrength(process.env.BOOTSTRAP_OWNER_PASSWORD);
    await q(`INSERT INTO users(name, username, role, password_hash, must_change_password) VALUES ($1,$2,'owner',$3,true)`, [
      process.env.BOOTSTRAP_OWNER_NAME || 'Owner',
      process.env.BOOTSTRAP_OWNER_USERNAME,
      await hashPassword(process.env.BOOTSTRAP_OWNER_PASSWORD),
    ]);
    console.log(`[bootstrap] Owner account "${process.env.BOOTSTRAP_OWNER_USERNAME}" created – change the password at first login.`);
  }
}
const app = buildApp();
app.listen(config.port, () => {
  console.log(`YAGAMI AI – Sales & Payment Control listening on :${config.port}${config.demoMode ? ' [DEMO MODE]' : ''}`);
});
if (config.enableScheduler) startScheduler();
startOutboxWorker();
