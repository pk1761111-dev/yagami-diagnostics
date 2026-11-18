// All secrets come from server-side environment variables only.
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: req('DATABASE_URL', isProd ? undefined : 'postgres://yagami:yagami@localhost:5432/yagami_crm'),
  demoMode: process.env.DEMO_MODE === 'true',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  // 'db' = keep proof files inside PostgreSQL (no persistent disk needed, e.g. free hosting)
  fileStorage: (process.env.FILE_STORAGE ?? 'disk') as 'disk' | 'db',
  cronSecret: process.env.CRON_SECRET ?? '',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 5) * 1024 * 1024,
  sessionDays: Number(process.env.SESSION_DAYS ?? 7),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  webDist: process.env.WEB_DIST ?? '../web/dist',
  enableScheduler: process.env.DISABLE_SCHEDULER !== 'true',
  reportCron: process.env.REPORT_CRON ?? '0 18 * * *',     // 6:00 PM IST
  reminderCron: process.env.REMINDER_CRON ?? '30 9 * * *', // 9:30 AM IST
  timezone: 'Asia/Kolkata',
  whatsapp: {
    token: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME ?? '',
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en',
  },
};

export function whatsappConfigured(): boolean {
  const w = config.whatsapp;
  return Boolean(w.token && w.phoneNumberId && w.templateName);
}
