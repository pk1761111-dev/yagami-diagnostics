import { useState } from 'react';
import { api, money, todayIST, addDaysIST } from '../api';
import { Empty, ErrorBox, Loading, Stat, useLoad } from '../ui';
import { PaymentRow } from './paymentParts';

export function Payments() {
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'all'>('today');
  const from = range === 'today' ? todayIST() : range === '7d' ? addDaysIST(-6) : range === '30d' ? addDaysIST(-29) : '';
  const qs = new URLSearchParams({ ...(status && { status }), ...(kind && { kind }), ...(from && { from, to: todayIST() }) });
  const { data, error, loading, reload } = useLoad(() => api.get(`/payments?${qs}`), [qs.toString()]);
  const t = data?.totals;
  return (
    <div className="page">
      <div className="page-head"><h1>Payments</h1></div>
      <div className="filters">
        {(['today', '7d', '30d', 'all'] as const).map((r) => (
          <button key={r} className={`chip ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>{{ today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' }[r]}</button>
        ))}
      </div>
      <div className="filters">
        {[['', 'All'], ['recorded', 'Awaiting verification'], ['verified', 'Verified'], ['disputed', 'Disputed'], ['reversed', 'Reversed'], ['deleted', 'Deleted']].map(([k, l]) => (
          <button key={k} className={`chip ${status === k ? 'on' : ''}`} onClick={() => setStatus(k)}>{l}</button>
        ))}
        <select className="input" style={{ width: 'auto', minHeight: 42 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
          <option value="">Advance + old pending</option>
          <option value="advance">Advance only</option>
          <option value="old_pending">Old pending only</option>
        </select>
      </div>
      {t && (
        <div className="grid stats mb">
          <Stat label="Collected" value={money(t.collected)} tone="green" sub="recorded + verified" />
          <Stat label="Verified" value={money(t.verified)} tone="green" />
          <Stat label="Awaiting verification" value={money(t.unverified)} tone="orange" />
          <Stat label="Not counted" value={money(t.excluded)} tone="red" sub="disputed / reversed / deleted" />
        </div>
      )}
      {error && <ErrorBox msg={error} />}
      <div className="card" style={{ padding: '4px 14px' }}>
        {loading && !data ? <Loading /> : data.payments.length === 0 ? <Empty>No payments in this view. Record payments from a customer’s order.</Empty> : (
          <div className="list">{data.payments.map((p: any) => <PaymentRow key={p.id} p={p} onDone={reload} showCustomer />)}</div>
        )}
      </div>
    </div>
  );
}
