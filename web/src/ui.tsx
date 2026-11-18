import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORY, PAY_STATUS, money } from './api';

// ---------- Icons (inline SVG, no external assets) ----------
const P: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  plus: 'M12 5v14M5 12h14',
  flag: 'M4 21V4m0 0h13l-2 4 2 4H4',
  rupee: 'M6 4h12M6 9h12M6 4c6 0 8 2 8 5s-3 5-8 5l8 7',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  team: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21v-1a6 6 0 0112 0v1M19 8v6M22 11h-6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  phone: 'M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z',
  chat: 'M21 11.5a8.4 8.4 0 01-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1121 11.5z',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  back: 'M15 18l-6-6 6-6',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  more: 'M4 6h16M4 12h16M4 18h16',
  sound: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14',
  mute: 'M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
};
export function Icon({ name, size = 22 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.more} />
    </svg>
  );
}

// ---------- Toasts ----------
type Toast = { msg: string; kind: 'ok' | 'err' } | null;
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Toast>(null);
  const show = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => setT({ msg, kind }), []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), t.kind === 'err' ? 5000 : 2800);
    return () => clearTimeout(id);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast ${t.kind}`} role="status">{t.msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Data loading hook ----------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((x) => x + 1) };
}

// ---------- Small components ----------
export function Stat({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; to?: string }) {
  const inner = (
    <>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </>
  );
  return to ? <Link to={to} className={`stat ${tone ?? ''}`}>{inner}</Link> : <div className={`stat ${tone ?? ''}`}>{inner}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, required, children, hint, className }: { label: string; required?: boolean; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}{required && <em> *</em>}</span>
      {children}
      {hint}
    </label>
  );
}

export const Loading = () => <div className="spinner" aria-label="Loading" />;
export const ErrorBox = ({ msg }: { msg: string }) => <div className="alert err">{msg}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Money = ({ v, tone }: { v: string | number | null | undefined; tone?: string }) => <span className={`money ${tone ?? ''}`}>{money(v)}</span>;

export function CategoryBadge({ c }: { c: string }) {
  return <span className={`badge ${c === 'retail' ? '' : 'yellow'}`}>{CATEGORY[c] ?? c}</span>;
}
export function PayStatusBadge({ s }: { s: string }) {
  const tone = { verified: 'green', recorded: 'orange', disputed: 'red', reversed: 'red', deleted: '' }[s] ?? '';
  return <span className={`badge ${tone}`}>{PAY_STATUS[s] ?? s}</span>;
}
export const initials = (n: string) => n.replace(/\[DEMO\]\s*/, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function CallButtons({ mobile }: { mobile: string }) {
  return (
    <>
      <a className="call-btn" href={`tel:+91${mobile}`} aria-label="Call" onClick={(e) => e.stopPropagation()}><Icon name="phone" size={19} /></a>
      <a className="call-btn wa-btn" href={`https://wa.me/91${mobile}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" onClick={(e) => e.stopPropagation()}><Icon name="chat" size={19} /></a>
    </>
  );
}
