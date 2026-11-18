import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, dateTime } from '../api';
import { useSession } from '../session';
import { Empty, ErrorBox, Loading, useLoad } from '../ui';

const WA: Record<string, [string, string]> = {
  queued: ['WhatsApp queued', ''], sent: ['WhatsApp sent', 'blue'], delivered: ['WhatsApp delivered', 'green'], read: ['WhatsApp read', 'green'],
  failed: ['WhatsApp failed', 'red'], not_configured: ['WhatsApp not set up', ''],
};

export function Notifications() {
  const { refreshUnread, user } = useSession();
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.get('/notifications'), []);
  useEffect(() => {
    const h = () => reload();
    window.addEventListener('yg:notification', h);
    return () => window.removeEventListener('yg:notification', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const open = async (n: any) => {
    if (!n.read_at) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    refreshUnread();
    if (n.link) nav(n.link);
    else if (n.customer_id) nav(`/customers/${n.customer_id}`);
    else reload();
  };
  const toggle = async (n: any) => {
    await api.post(`/notifications/${n.id}/${n.read_at ? 'unread' : 'read'}`);
    refreshUnread();
    reload();
  };
  const readAll = async () => {
    await api.post('/notifications/read-all');
    refreshUnread();
    reload();
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1>Alerts</h1>
        <button className="btn sm" onClick={readAll}>Mark all read</button>
      </div>
      {user!.role === 'owner' && <WhatsAppStatus />}
      {error && <ErrorBox msg={error} />}
      <div className="card" style={{ padding: '4px 14px' }}>
        {loading && !data ? <Loading /> : data.notifications.length === 0 ? <Empty>No alerts yet.</Empty> : (
          <div className="list">
            {data.notifications.map((n: any) => (
              <div key={n.id} className="row" style={{ cursor: 'pointer', opacity: n.read_at ? 0.6 : 1 }} onClick={() => open(n)}>
                <span className={`urgency ${n.priority === 'high' ? 'u3' : 'u1'}`} style={{ background: n.read_at ? undefined : undefined }} />
                <div className="grow">
                  <div className="title" style={{ whiteSpace: 'normal' }}>{!n.read_at && <span style={{ color: 'var(--yellow)' }}>● </span>}{n.title}</div>
                  {n.body && <div className="meta" style={{ whiteSpace: 'normal' }}>{n.body}</div>}
                  <div className="badges">
                    <span className="badge">{dateTime(n.created_at)}</span>
                    {(n.deliveries ?? []).map((d: any, i: number) => <span key={i} className={`badge ${WA[d.status]?.[1] ?? ''}`} title={d.error ?? ''}>{WA[d.status]?.[0] ?? d.status}</span>)}
                  </div>
                </div>
                <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); toggle(n); }}>{n.read_at ? 'Unread' : 'Read'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WhatsAppStatus() {
  const { data } = useLoad(() => api.get('/notifications/deliveries'), []);
  if (!data) return null;
  const counts = data.deliveries.reduce((a: any, d: any) => ((a[d.status] = (a[d.status] ?? 0) + 1), a), {});
  return (
    <div className={`alert ${data.configured ? 'info' : 'warn'} small`}>
      WhatsApp Cloud API: <b>{data.configured ? 'connected' : 'not configured'}</b>.{' '}
      {Object.keys(counts).length > 0 && `Recent: ${Object.entries(counts).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ')}.`}{' '}
      “Sent” means Meta accepted it; “delivered” is shown only after Meta confirms.
    </div>
  );
}
