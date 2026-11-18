export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'yagami',
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, (data as any)?.error ?? `Request failed (${res.status})`, (data as any)?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(u: string) => request<T>('GET', u),
  post: <T = any>(u: string, b?: unknown) => request<T>('POST', u, b ?? {}),
  patch: <T = any>(u: string, b?: unknown) => request<T>('PATCH', u, b ?? {}),
  upload: <T = any>(u: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<T>('POST', u, fd);
  },
};

// ---------- formatting (always India / IST) ----------
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const money = (v: string | number | null | undefined) => inr.format(Number(v ?? 0));
export const dateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
export const dateOnly = (v?: string | null) => {
  if (!v) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00+05:30') : new Date(v);
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
};
export const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const nowLocalIST = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
};
export const addDaysIST = (n: number) => {
  const d = new Date(todayIST() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const CATEGORY: Record<string, string> = {
  retail: 'Retail', dealer: 'Dealer', reseller: 'Reseller', bulk_buyer: 'Bulk Buyer', fleet_owner: 'Fleet Owner', manufacturer: 'Manufacturer',
};
export const SOURCE: Record<string, string> = { phone: 'Phone call', whatsapp: 'WhatsApp', walk_in: 'Walk-in', website: 'Website', referral: 'Referral', other: 'Other' };
export const LEAD_STATUS: Record<string, string> = { new: 'New', contacted: 'Contacted', interested: 'Interested', quoted: 'Quoted', won: 'Won', lost: 'Lost' };
export const ORDER_STATUS: Record<string, string> = { quoted: 'Quoted', confirmed: 'Confirmed', in_production: 'In production', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
export const PAY_METHOD: Record<string, string> = { upi: 'UPI', bank_transfer: 'Bank transfer', cash: 'Cash' };
export const PAY_STATUS: Record<string, string> = { recorded: 'Awaiting verification', verified: 'Verified', disputed: 'Disputed', reversed: 'Reversed', deleted: 'Deleted' };
export const isPriority = (c: string) => c !== 'retail';
