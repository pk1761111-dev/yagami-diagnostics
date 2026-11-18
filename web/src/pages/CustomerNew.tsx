import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, addDaysIST, CATEGORY, SOURCE } from '../api';
import { useSession } from '../session';
import { ErrorBox, Field, Icon, useToast } from '../ui';

export const STATES = ['Delhi', 'Haryana', 'Uttar Pradesh', 'Rajasthan', 'Punjab', 'Uttarakhand', 'Himachal Pradesh', 'Jammu & Kashmir', 'Madhya Pradesh', 'Bihar', 'Gujarat', 'Maharashtra', 'West Bengal', 'Jharkhand', 'Chhattisgarh', 'Odisha', 'Karnataka', 'Tamil Nadu', 'Telangana', 'Andhra Pradesh', 'Kerala', 'Assam', 'Goa', 'Chandigarh', 'Other'];

export function CustomerNew() {
  const { user } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({
    name: '', mobile: '', city: '', state: 'Delhi', category: 'retail', vehicle_model: '', requirement: '',
    source: user!.role === 'staff2' ? 'whatsapp' : 'phone', notes: '', follow_up_date: addDaysIST(1), important: false, is_complaint: false, urgent: false,
  });
  const [dup, setDup] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const digits = f.mobile.replace(/\D/g, '');
    if (digits.length < 10) return setDup(null);
    const t = setTimeout(() => api.get(`/customers/check-mobile?mobile=${encodeURIComponent(f.mobile)}`).then((r) => setDup(r.exists ? r.customer : null)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [f.mobile]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post('/customers', { ...f, follow_up_date: f.follow_up_date || null });
      toast(f.category !== 'retail' ? 'Saved – sent to Staff 3 (priority lead)' : 'Customer saved');
      nav(`/customers/${r.customer.id}`, { replace: true });
    } catch (e: any) {
      setErr(e.message);
      if (e.details?.customerId) setDup({ id: e.details.customerId });
    } finally {
      setBusy(false);
    }
  };

  const logOnExisting = async () => {
    try {
      await api.post(`/customers/${dup.id}/enquiries`, { source: f.source, notes: f.requirement || f.notes || null, is_complaint: f.is_complaint, urgent: f.urgent });
      toast('Enquiry logged on existing customer');
      nav(`/customers/${dup.id}`);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const priority = f.category !== 'retail';
  return (
    <div className="page">
      <div className="page-head">
        <Link to="/customers" className="icon-btn" aria-label="Back"><Icon name="back" /></Link>
        <h1>New enquiry</h1>
      </div>
      <form onSubmit={submit} className="card" style={{ maxWidth: 820 }}>
        {err && <ErrorBox msg={err} />}
        <Field label="How did they contact us?" required>
          <div className="chips">
            {Object.entries(SOURCE).map(([k, v]) => (
              <button type="button" key={k} className={`chip ${f.source === k ? 'on' : ''}`} onClick={() => set('source', k)}>{v}</button>
            ))}
          </div>
        </Field>
        <div className="form-grid">
          <Field label="Mobile number" required hint={dup ? (
            <div className="alert warn" style={{ marginTop: 6, marginBottom: 0 }}>
              Already saved as <b>{dup.name ?? 'existing customer'}</b>{dup.assigned_name ? ` (with ${dup.assigned_name})` : ''}.
              <div className="btn-row mt">
                <button type="button" className="btn sm primary" onClick={logOnExisting}>Log enquiry on existing</button>
                <Link className="btn sm" to={`/customers/${dup.id}`}>Open customer</Link>
              </div>
            </div>
          ) : undefined}>
            <input className="input" type="tel" inputMode="numeric" placeholder="98xxxxxxxx" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} required autoFocus />
          </Field>
          <Field label="Customer / business name" required>
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required minLength={2} />
          </Field>
          <Field label="Customer type" required className="full" hint={priority ? <span className="hint warn">This customer will be assigned to Staff 3 automatically, and Staff 3 + Owner will be alerted.</span> : undefined}>
            <div className="chips">
              {Object.entries(CATEGORY).map(([k, v]) => (
                <button type="button" key={k} className={`chip ${f.category === k ? 'on' : ''}`} onClick={() => set('category', k)}>{v}</button>
              ))}
            </div>
          </Field>
          <Field label="City">
            <input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="State">
            <select className="input" value={f.state} onChange={(e) => set('state', e.target.value)}>
              {STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Vehicle model">
            <input className="input" placeholder="e.g. Maruti Swift 2019" value={f.vehicle_model} onChange={(e) => set('vehicle_model', e.target.value)} />
          </Field>
          <Field label="Follow-up date">
            <input className="input" type="date" value={f.follow_up_date} onChange={(e) => set('follow_up_date', e.target.value)} />
          </Field>
          <Field label="Product / wiring requirement" className="full">
            <textarea className="input" placeholder="What do they need? Quantity, harness type…" value={f.requirement} onChange={(e) => set('requirement', e.target.value)} />
          </Field>
          <Field label="Call / chat notes" className="full">
            <textarea className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.important || priority} disabled={priority} onChange={(e) => set('important', e.target.checked)} /> Important lead</label>
        <label className="check"><input type="checkbox" checked={f.is_complaint} onChange={(e) => set('is_complaint', e.target.checked)} /> This is a complaint</label>
        {f.is_complaint && <label className="check"><input type="checkbox" checked={f.urgent} onChange={(e) => set('urgent', e.target.checked)} /> Urgent – alert Staff 3 and Owner now</label>}
        <button className="btn primary block mt" disabled={busy || Boolean(dup)}>{busy ? 'Saving…' : 'Save customer'}</button>
      </form>
    </div>
  );
}
