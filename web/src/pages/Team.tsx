import { useState, type FormEvent } from 'react';
import { api, dateOnly } from '../api';
import { useSession } from '../session';
import { Empty, ErrorBox, Field, Loading, Modal, useLoad, useToast } from '../ui';

const ROLES: Record<string, string> = { owner: 'Owner / Admin', staff1: 'Staff 1 – Phone calls', staff2: 'Staff 2 – WhatsApp', staff3: 'Staff 3 – Dealers & payments' };

export function Team() {
  const { user } = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get('/users'), []);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [secret, setSecret] = useState<{ name: string; username: string; pwd: string } | null>(null);

  const reset = async (u: any) => {
    if (!confirm(`Reset password for ${u.name}? They will be logged out everywhere.`)) return;
    const r = await api.post(`/users/${u.id}/reset-password`);
    setSecret({ name: u.name, username: u.username, pwd: r.temporaryPassword });
  };
  const toggleActive = async (u: any) => {
    try {
      const r = await api.patch(`/users/${u.id}`, { active: !u.active });
      toast(u.active ? 'Account disabled' : 'Account enabled');
      if (r.openLeadsNeedingReassignment > 0) toast(`${r.openLeadsNeedingReassignment} open leads still assigned to ${u.name} – please reassign them`, 'err');
      reload();
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Team</h1><button className="btn primary sm" onClick={() => setAdd(true)}>Add staff</button></div>
      <div className="alert info small">Every person gets their own login. Temporary passwords are shown once and must be changed at first login.</div>
      {error && <ErrorBox msg={error} />}
      <div className="card" style={{ padding: '4px 14px' }}>
        {loading && !data ? <Loading /> : data.users.length === 0 ? <Empty>No users.</Empty> : (
          <div className="list">
            {data.users.map((u: any) => (
              <div className="row" key={u.id} style={{ flexWrap: 'wrap', opacity: u.active ? 1 : 0.55 }}>
                <div className="grow">
                  <div className="title">{u.name} <span className="muted small">@{u.username}</span></div>
                  <div className="meta">{ROLES[u.role]} · {u.mobile ?? 'no mobile'} · since {dateOnly(u.created_at)}</div>
                  <div className="badges">
                    {!u.active && <span className="badge red">Disabled</span>}
                    {u.must_change_password && <span className="badge orange">Must set password</span>}
                    {u.whatsapp_alerts && <span className="badge green">WhatsApp alerts</span>}
                    <span className="badge">{u.open_leads} open leads</span>
                    {u.is_demo && <span className="badge yellow">DEMO</span>}
                  </div>
                </div>
                <div className="btn-row">
                  <button className="btn sm" onClick={() => setEdit(u)}>Edit</button>
                  <button className="btn sm" onClick={() => reset(u)}>Reset password</button>
                  {u.id !== user!.id && <button className={`btn sm ${u.active ? 'danger' : ''}`} onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {add && <UserModal onClose={() => setAdd(false)} onDone={(r: any) => { reload(); setSecret({ name: r.user.name, username: r.user.username, pwd: r.temporaryPassword }); }} />}
      {edit && <UserModal u={edit} onClose={() => setEdit(null)} onDone={() => reload()} />}
      {secret && (
        <Modal title="Temporary password" onClose={() => setSecret(null)}>
          <p>Give these details to <b>{secret.name}</b> privately. This password is shown only once.</p>
          <div className="card" style={{ fontFamily: 'monospace', fontSize: 18 }}>
            Username: <b>{secret.username}</b><br />Password: <b style={{ color: 'var(--yellow)' }}>{secret.pwd}</b>
          </div>
          <button className="btn primary block mt" onClick={() => setSecret(null)}>Done</button>
        </Modal>
      )}
    </div>
  );
}

function UserModal({ u, onClose, onDone }: any) {
  const [f, setF] = useState({ name: u?.name ?? '', username: u?.username ?? '', mobile: u?.mobile ?? '', role: u?.role ?? 'staff1', whatsapp_alerts: u?.whatsapp_alerts ?? false });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = u
        ? await api.patch(`/users/${u.id}`, { name: f.name, mobile: f.mobile || null, role: f.role, whatsapp_alerts: f.whatsapp_alerts })
        : await api.post('/users', { ...f, mobile: f.mobile || null });
      onDone(r);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <Modal title={u ? `Edit ${u.name}` : 'Add staff member'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <ErrorBox msg={err} />}
        <Field label="Full name" required><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
        {!u && <Field label="Username" required hint={<span className="hint">Used to log in, e.g. “ravi”</span>}><input className="input" autoCapitalize="none" value={f.username} onChange={(e) => set('username', e.target.value)} required /></Field>}
        <Field label="Mobile (for WhatsApp alerts)"><input className="input" type="tel" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></Field>
        <Field label="Role" required>
          <select className="input" value={f.role} onChange={(e) => set('role', e.target.value)}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <label className="check"><input type="checkbox" checked={f.whatsapp_alerts} onChange={(e) => set('whatsapp_alerts', e.target.checked)} /> Send important alerts on WhatsApp</label>
        <button className="btn primary block mt">{u ? 'Save' : 'Create account'}</button>
      </form>
    </Modal>
  );
}
