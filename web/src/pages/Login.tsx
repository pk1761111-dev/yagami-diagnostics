import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { ErrorBox, Field, useToast } from '../ui';

export function Login() {
  const { login } = useSession();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(username, password);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <div className="logo">
          <img src="/icons/icon-512.png" alt="YAGAMI" />
          <h1>YAGAMI <b>AI</b></h1>
          <div className="stripe" />
          <div className="muted">Sales &amp; Payment Control · YAGAMI WIRE HARNESS</div>
        </div>
        <div className="card">
          {err && <ErrorBox msg={err} />}
          <Field label="Username">
            <input className="input" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setU(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required />
          </Field>
          <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
        <p className="muted small" style={{ textAlign: 'center', marginTop: 16 }}>Each staff member has their own login. Never share passwords.</p>
      </form>
    </div>
  );
}

export function ChangePassword({ forced }: { forced?: boolean }) {
  const { refresh, logout, user } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== again) return setErr('New passwords do not match');
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
      toast('Password changed');
      await refresh();
      if (!forced) nav('/');
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const body = (
    <form className="card" onSubmit={submit} style={{ maxWidth: 440 }}>
      {forced && <div className="alert info">Welcome {user?.name}! Please set your own password before continuing.</div>}
      {err && <ErrorBox msg={err} />}
      <Field label={forced ? 'Temporary password' : 'Current password'} required>
        <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
      </Field>
      <Field label="New password" required hint={<span className="hint">At least 10 characters, with letters and numbers.</span>}>
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
      </Field>
      <Field label="Repeat new password" required>
        <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
      </Field>
      <div className="btn-row">
        <button className="btn primary">Save password</button>
        {forced && <button type="button" className="btn ghost" onClick={logout}>Log out</button>}
      </div>
    </form>
  );
  if (forced) return <div className="login-wrap"><div className="login">{body}</div></div>;
  return (
    <div className="page">
      <div className="page-head"><h1>Change password</h1></div>
      {body}
    </div>
  );
}
