// Manual / system-cron fallback: npm run report:generate [YYYY-MM-DD]
import { pool } from '../lib/db.js';
import { generateReport } from '../lib/reports.js';
import { istToday } from '../lib/util.js';
const d = process.argv[2] ?? istToday();
const r = await generateReport(d, 'scheduler');
console.log(`Report generated for ${r.report_date}`);
await pool.end();
