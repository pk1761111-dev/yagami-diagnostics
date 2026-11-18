import { migrate, pool } from '../lib/db.js';
await migrate();
await pool.end();
