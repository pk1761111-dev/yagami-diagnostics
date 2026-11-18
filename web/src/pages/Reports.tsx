import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateOnly, dateTime, money, todayIST } from '../api';
import { Empty, ErrorBox, Icon, Loading, Stat, useLoad, useToast } from '../ui';
import { StaffTable } from './Dashboard';

export function Reports() {
  const { data, error, loading, reload } = useLoad(() => api.get('/reports'), []);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    try {
      await api.post('/reports/generate', { date: todayIST() });
      toast('Report generated');
      reload();
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1>Daily reports</h1>
        <Link className="btn sm" to={`/reports/${todayIST()}`}>Today (live)</Link>
        <button className="btn sm primary" onClick={gen} disabled={busy}>Generate now</button>
        <a className="btn sm" href="/api/backup/export"><Icon name="download" size={16} /> Full data backup</a>
      </div>
      <div className="alert info small">The server saves a report automatically every day at 6:00 PM IST, even when nobody has the app open. You also get a notification when it’s ready. Download a full data backup every week and keep it safe (Google Drive / laptop).</div>
      {error && <ErrorBox msg={error} />}
      <div className="card" style={{ padding: '4px 14px' }}>
        {loading && !data ? <Loading /> : data.reports.length === 0 ? <Empty>No saved reports yet. The first one is created today at 6:00 PM.</Empty> : (
          <div className="list">
            {data.reports.map((r: any) => (
              <Link key={r.report_date} to={`/reports/${r.report_date}`} className="row">
                <div className="grow">
                  <div className="title">{dateOnly(r.report_date)}</div>
                  <div className="meta">Enquiries {r.enquiries} · Orders {money(r.order_value)} · Collected {money(r.collected)}</div>
                  <div className="badges">
                    <span className="badge yellow">Outstanding {money(r.outstanding)}</span>
                    {Number(r.missed) > 0 && <span className="badge red">{r.missed} missed follow-ups</span>}
                    <span className="badge">{r.trigger === 'manual' ? 'manual' : 'auto'} · {dateTime(r.generated_at)}</span>
                  </div>
                </div>
                <a className="icon-btn" href={`/api/reports/${r.report_date}/csv`} onClick={(e) => e.stopPropagation()} aria-label="Download CSV"><Icon name="download" size={18} /></a>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportView() {
  const { date } = useParams();
  const { data, error, loading } = useLoad(async () => {
    try {
      return (await api.get(`/reports/${date}`)).report;
    } catch {
      return (await api.get(`/reports/live?date=${date}`)).report;
    }
  }, [date]);
  if (loading && !data) return <Loading />;
  if (error) return <div className="page"><ErrorBox msg={error} /></div>;
  const s = data.data;
  return (
    <div className="page">
      <div className="page-head">
        <Link to="/reports" className="icon-btn" aria-label="Back"><Icon name="back" /></Link>
        <div style={{ flex: 1 }}>
          <h1>Report · {dateOnly(date!)}</h1>
          <div className="muted small">{data.live ? 'Live figures (not yet saved)' : `Saved ${dateTime(data.generated_at)}`}</div>
        </div>
        <a className="btn sm primary" href={`/api/reports/${date}/csv`}><Icon name="download" size={16} /> CSV</a>
      </div>
      <div className="grid stats">
        <Stat label="Phone calls" value={s.enquiries.calls} tone="blue" />
        <Stat label="WhatsApp enquiries" value={s.enquiries.whatsapp} tone="blue" />
        <Stat label="New leads" value={s.leads.total} sub={`${s.leads.important} important · ${s.leads.normal} normal`} />
        <Stat label="Orders confirmed" value={s.orders.count} sub={money(s.orders.value)} tone="green" />
        <Stat label="Advance collected" value={money(s.collections.advance)} tone="green" />
        <Stat label="Old pending collected" value={money(s.collections.old_pending)} tone="green" />
        <Stat label="Outstanding" value={money(s.outstanding.total)} tone="yellow" />
        <Stat label="Overdue" value={money(s.outstanding.overdue)} sub={`${s.outstanding.overdue_customers} customers`} tone="red" />
      </div>
      {Number(s.collections.excluded) > 0 && <div className="alert warn mt small">{money(s.collections.excluded)} of disputed / reversed / deleted payments on this day is excluded from collections.</div>}
      <div className="card mt"><h3 className="mb">Staff activity</h3><StaffTable staff={s.staff} /></div>
      <div className="card">
        <h3 className="mb">Missed follow-ups ({s.missedFollowups.length})</h3>
        {s.missedFollowups.length === 0 ? <Empty>None 🎉</Empty> : (
          <div className="list">
            {s.missedFollowups.map((m: any) => (
              <Link key={m.id + m.type} to={`/customers/${m.id}`} className="row">
                <div className="grow">
                  <div className="title">{m.name}</div>
                  <div className="meta">{m.mobile} · {m.type === 'payment' ? 'Payment' : 'Lead'} follow-up due {dateOnly(m.due)} · {m.assigned_name ?? '—'}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
