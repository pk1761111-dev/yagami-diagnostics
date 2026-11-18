import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateTime, money } from '../api';
import { Empty, ErrorBox, Loading, Modal, useLoad } from '../ui';

const LABEL: Record<string, string> = {
  'payment.record': 'Payment recorded', 'payment.verified': 'Payment verified', 'payment.disputed': 'Payment disputed', 'payment.reversed': 'Payment reversed',
  'payment.deleted': 'Payment entry deleted', 'payment.reinstate': 'Payment reinstated', 'payment.attach_proof': 'Proof attached',
  'lead.transfer': 'Lead transferred', 'lead.auto_transfer': 'Lead auto-routed', 'order.create': 'Order created', 'order.update': 'Order changed',
  'customer.create': 'Customer created', 'customer.update': 'Customer edited', 'user.create': 'User created', 'user.update': 'User changed',
  'user.reset_password': 'Password reset', 'auth.login': 'Login', 'auth.locked': 'Account locked', 'auth.password_changed': 'Password changed', 'file.upload': 'File uploaded',
};
const FILTERS: [string, string][] = [['', 'All'], ['payment', 'Payments'], ['customer', 'Leads & customers'], ['order', 'Orders'], ['user', 'Users & logins']];

export function Audit() {
  const [type, setType] = useState('');
  const { data, error, loading } = useLoad(() => api.get(`/audit${type ? `?entity_type=${type}` : ''}`), [type]);
  const [open, setOpen] = useState<any>(null);
  return (
    <div className="page">
      <div className="page-head"><h1>Audit log</h1><span className="muted small">Permanent – cannot be edited or deleted</span></div>
      <div className="filters">{FILTERS.map(([k, l]) => <button key={k} className={`chip ${type === k ? 'on' : ''}`} onClick={() => setType(k)}>{l}</button>)}</div>
      {error && <ErrorBox msg={error} />}
      <div className="card" style={{ padding: '4px 14px' }}>
        {loading && !data ? <Loading /> : data.entries.length === 0 ? <Empty>No entries.</Empty> : (
          <div className="list">
            {data.entries.map((e: any) => (
              <div key={e.id} className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(e)}>
                <div className="grow">
                  <div className="title">{LABEL[e.action] ?? e.action}{e.after?.amount ? ` · ${money(e.after.amount)}` : e.before?.amount ? ` · ${money(e.before.amount)}` : ''}</div>
                  <div className="meta">{e.actor_name ?? 'System'} · {dateTime(e.created_at)}{e.reason ? ` · “${e.reason}”` : ''}</div>
                </div>
                {e.entity_type === 'customer' && <Link className="btn sm ghost" to={`/customers/${e.entity_id}`} onClick={(ev) => ev.stopPropagation()}>Open</Link>}
              </div>
            ))}
          </div>
        )}
      </div>
      {open && (
        <Modal title={LABEL[open.action] ?? open.action} onClose={() => setOpen(null)}>
          <div className="muted small mb">#{open.id} · {open.actor_name ?? 'System'} · {dateTime(open.created_at)} · IP {open.ip ?? '—'}</div>
          {open.reason && <p>Reason: <b>{open.reason}</b></p>}
          {open.before && <><h3>Before</h3><pre className="card small" style={{ overflowX: 'auto' }}>{JSON.stringify(open.before, null, 2)}</pre></>}
          {open.after && <><h3 className="mt">After</h3><pre className="card small" style={{ overflowX: 'auto' }}>{JSON.stringify(open.after, null, 2)}</pre></>}
        </Modal>
      )}
    </div>
  );
}
