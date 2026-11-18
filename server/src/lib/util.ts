import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const bad = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details);

/** Money is handled as integer paise to avoid floating point errors. */
export function toPaise(v: string | number): number {
  const s = typeof v === 'number' ? v.toFixed(2) : String(v).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw bad(`Invalid amount: ${v}`);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const p = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -p : p;
}
export function fromPaise(p: number): string {
  const neg = p < 0;
  const a = Math.abs(p);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** Normalise an Indian mobile number to 10 digits. */
export function normaliseMobile(raw: string): string {
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) throw bad('Enter a valid 10-digit Indian mobile number');
  return d;
}

export function sha256(s: string | Buffer) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function tempPassword() {
  // readable, 12 chars, no ambiguous characters
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(12);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}

/** Today's date in Asia/Kolkata as YYYY-MM-DD */
export function istToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function istHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(now));
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
