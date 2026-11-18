import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorBox, Loading, useLoad } from '../ui';
import { QueueList } from './Dashboard';

const FILTERS: [string, string, (r: any) => boolean][] = [
  ['all', 'All', () => true],
  ['complaints', 'Complaints', (r) => r.complaints > 0],
  ['overdue', 'Overdue payments', (r) => Number(r.overdue) > 0],
  ['pending', 'Pending payments', (r) => Number(r.outstanding) > 0],
  ['dealers', 'Dealer / bulk', (r) => r.category !== 'retail' && r.open_lead],
  ['followup', 'Follow-up due', (r) => r.reasons.some((x: string) => /follow-up due/i.test(x))],
];

export function Queue() {
  const { data, error, loading, reload } = useLoad(() => api.get('/queue'), []);
  const [f, setF] = useState('all');
  useEffect(() => {
    const h = () => reload();
    window.addEventListener('yg:notification', h);
    return () => window.removeEventListener('yg:notification', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rows = (data?.queue ?? []).filter(FILTERS.find((x) => x[0] === f)![2]);
  return (
    <div className="page">
      <div className="page-head"><h1>Priority queue</h1><span className="muted small">Most urgent first</span></div>
      <div className="filters">
        {FILTERS.map(([k, l, fn]) => (
          <button key={k} className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>
            {l} <span className="muted">{(data?.queue ?? []).filter(fn).length}</span>
          </button>
        ))}
      </div>
      {error && <ErrorBox msg={error} />}
      <div className="card" style={{ padding: '4px 14px' }}>{loading && !data ? <Loading /> : <QueueList rows={rows} />}</div>
    </div>
  );
}
