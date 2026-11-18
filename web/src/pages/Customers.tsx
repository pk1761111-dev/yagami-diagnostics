import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, dateOnly, todayIST, CATEGORY, LEAD_STATUS, SOURCE } from '../api';
import { useSession } from '../session';
import { CallButtons, CategoryBadge, Empty, ErrorBox, Icon, Loading, Money, initials } from '../ui';

export function Customers() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const finance = user!.role === 'owner' || user!.role === 'staff3';

  // debounce search box into the URL
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams(params);
      if (q) p.set('q', q); else p.delete('q');
      if (p.toString() !== params.toString()) setParams(p, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const load = (pg: number) => {
    setLoading(true);
    const p = new URLSearchParams(params);
    p.set('page', String(pg));
    api.get(`/customers?${p}`)
      .then((r) => { setRows((prev) => (pg === 1 ? r.customers : [...prev, ...r.customers])); setHasMore(r.hasMore); setPage(pg); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(1), [params]);

  const toggle = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (p.get(k) === v) p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  };
  const sel = (k: string) => params.get(k) ?? '';
  const setSel = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };
  const today = todayIST();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Customers</h1>
        <Link to="/customers/new" className="btn primary sm"><Icon name="plus" size={18} /> New</Link>
      </div>
      <div className="searchbar">
        <span className="ic"><Icon name="search" size={18} /></span>
        <input className="input" type="search" placeholder="Search name, mobile, city, vehicle, code…" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
      </div>
      <div className="filters">
        <button className={`chip ${sel('assigned') === 'me' ? 'on' : ''}`} onClick={() => toggle('assigned', 'me')}>My customers</button>
        <button className={`chip ${sel('followup') === 'today' ? 'on' : ''}`} onClick={() => toggle('followup', 'today')}>Follow-up today</button>
        <button className={`chip ${sel('followup') === 'overdue' ? 'on' : ''}`} onClick={() => toggle('followup', 'overdue')}>Overdue follow-up</button>
        <button className={`chip ${sel('important') ? 'on' : ''}`} onClick={() => toggle('important', '1')}>Important</button>
        {finance && <button className={`chip ${sel('outstanding') ? 'on' : ''}`} onClick={() => toggle('outstanding', '1')}>Payment pending</button>}
      </div>
      <div className="filters">
        <select className="input" style={{ width: 'auto', minHeight: 42 }} value={sel('category')} onChange={(e) => setSel('category', e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" style={{ width: 'auto', minHeight: 42 }} value={sel('status')} onChange={(e) => setSel('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" style={{ width: 'auto', minHeight: 42 }} value={sel('source')} onChange={(e) => setSel('source', e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {params.toString() && <button className="chip" onClick={() => { setQ(''); setParams({}, { replace: true }); }}><Icon name="x" size={16} /> Clear</button>}
      </div>
      {error && <ErrorBox msg={error} />}
      <div className="card" style={{ padding: '4px 14px' }}>
        {loading && page === 1 ? <Loading /> : rows.length === 0 ? <Empty>No customers match.</Empty> : (
          <div className="list">
            {rows.map((c) => {
              const due = c.follow_up_date && c.follow_up_date <= today && !['won', 'lost'].includes(c.lead_status);
              return (
                <Link to={`/customers/${c.id}`} className="row" key={c.id}>
                  <div className={`avatar ${c.category !== 'retail' || c.important ? 'priority' : ''}`}>{initials(c.name)}</div>
                  <div className="grow">
                    <div className="title">{c.name}</div>
                    <div className="meta">{c.mobile}{c.city ? ` · ${c.city}` : ''}{c.vehicle_model ? ` · ${c.vehicle_model}` : ''}</div>
                    <div className="badges">
                      <CategoryBadge c={c.category} />
                      <span className={`badge ${c.lead_status === 'won' ? 'green' : c.lead_status === 'lost' ? 'red' : ''}`}>{LEAD_STATUS[c.lead_status]}</span>
                      {due && <span className="badge orange">Follow-up {dateOnly(c.follow_up_date)}</span>}
                      {!finance && c.has_outstanding && <span className="badge red">Payment pending</span>}
                      <span className="badge">{c.assigned_name ?? 'Unassigned'}</span>
                    </div>
                  </div>
                  {finance && Number(c.outstanding) > 0 ? (
                    <div className="right"><Money v={c.outstanding} tone={Number(c.overdue) > 0 ? 'red' : 'yellow'} /><div className="muted small">{Number(c.overdue) > 0 ? 'overdue' : 'due'}</div></div>
                  ) : (
                    <CallButtons mobile={c.mobile} />
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
      {hasMore && <button className="btn block mt" onClick={() => load(page + 1)} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>}
    </div>
  );
}
