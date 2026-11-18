import { useState, type FormEvent } from 'react';
import { api, dateTime, money, nowLocalIST, PAY_METHOD } from '../api';
import { useSession } from '../session';
import { ErrorBox, Field, Icon, Modal, PayStatusBadge, useToast } from '../ui';

const MAX_MB = 5;

/** Shrink phone photos/screenshots before upload (saves data and free database space). */
async function compressImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 350 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.78));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function ProofPicker({ onUploaded }: { onUploaded: (f: { id: string; original_name: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const pick = async (picked?: File) => {
    if (!picked) return;
    const file = await compressImage(picked);
    setErr(null);
    if (file.size > MAX_MB * 1024 * 1024) return setErr(`File too large (max ${MAX_MB} MB)`);
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) return setErr('Use a JPG, PNG, WEBP photo/screenshot or a PDF');
    setBusy(true);
    try {
      const r = await api.upload('/files', file);
      setName(r.file.original_name);
      onUploaded(r.file);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <label className="btn block" style={{ cursor: 'pointer' }}>
        <Icon name="file" size={18} /> {busy ? 'Uploading…' : name ? `✓ ${name}` : 'Add screenshot / receipt'}
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {err && <div className="hint err" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}

export function RecordPaymentModal({ order, customerName, onClose, onDone }: { order: any; customerName: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const due = Number(order.balance);
  const [f, setF] = useState({
    amount: '', method: 'upi', paid_at: nowLocalIST(), txn_ref: '', remarks: '',
    kind: ['dispatched', 'delivered'].includes(order.status) ? 'old_pending' : 'advance', proof_file_id: '' as string,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (Number(f.amount) > due) return setErr(`Amount is more than balance due (${money(due)})`);
    setBusy(true);
    try {
      await api.post('/payments', { ...f, order_id: order.id, proof_file_id: f.proof_file_id || null, txn_ref: f.txn_ref || null, remarks: f.remarks || null });
      toast('Payment recorded');
      onDone();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Record payment" onClose={onClose}>
      <div className="muted mb">{customerName} · {order.order_no}{order.invoice_ref ? ` · Inv ${order.invoice_ref}` : ''}<br />Balance due <b style={{ color: 'var(--yellow)' }}>{money(due)}</b></div>
      <form onSubmit={submit}>
        {err && <ErrorBox msg={err} />}
        <Field label="Amount received (₹)" required>
          <input className="input" type="number" inputMode="decimal" step="0.01" min="0.01" max={due} value={f.amount} onChange={(e) => set('amount', e.target.value)} required autoFocus />
        </Field>
        <Field label="Payment method" required>
          <div className="chips">
            {Object.entries(PAY_METHOD).map(([k, v]) => <button type="button" key={k} className={`chip ${f.method === k ? 'on' : ''}`} onClick={() => set('method', k)}>{v}</button>)}
          </div>
        </Field>
        {f.method !== 'cash' && (
          <Field label="UTR / transaction reference" required>
            <input className="input" value={f.txn_ref} onChange={(e) => set('txn_ref', e.target.value)} required autoCapitalize="characters" />
          </Field>
        )}
        <Field label="Type" required>
          <div className="chips">
            <button type="button" className={`chip ${f.kind === 'advance' ? 'on' : ''}`} onClick={() => set('kind', 'advance')}>Advance</button>
            <button type="button" className={`chip ${f.kind === 'old_pending' ? 'on' : ''}`} onClick={() => set('kind', 'old_pending')}>Old pending</button>
          </div>
        </Field>
        <Field label="Date & time received (IST)" required>
          <input className="input" type="datetime-local" value={f.paid_at} max={nowLocalIST()} onChange={(e) => set('paid_at', e.target.value)} required />
        </Field>
        <Field label="Proof (needed for verification)">
          <ProofPicker onUploaded={(file) => set('proof_file_id', file.id)} />
        </Field>
        <Field label="Remarks">
          <input className="input" value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
        <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : `Save ${f.amount ? money(f.amount) : 'payment'}`}</button>
      </form>
    </Modal>
  );
}

type Act = 'verify' | 'dispute' | 'reverse' | 'reinstate' | 'delete' | 'proof' | 'history' | null;

export function PaymentRow({ p, onDone, showCustomer }: { p: any; onDone: () => void; showCustomer?: boolean }) {
  const { user } = useSession();
  const toast = useToast();
  const [act, setAct] = useState<Act>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const owner = user!.role === 'owner';
  const mineRecent = p.recorded_by === user!.id && p.status === 'recorded' && Date.now() - new Date(p.recorded_at).getTime() < 86400_000;
  const counted = p.status === 'recorded' || p.status === 'verified';

  const run = async (path: string, body: any, msg: string) => {
    setErr(null);
    try {
      await api.post(`/payments/${p.id}/${path}`, body);
      toast(msg);
      setAct(null);
      setReason('');
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const openHistory = async () => {
    setAct('history');
    setHistory((await api.get(`/payments/${p.id}/history`)).history);
  };
  const needsReason = act === 'dispute' || act === 'reverse' || act === 'reinstate' || act === 'delete';
  const titles: Record<string, string> = { verify: 'Verify payment', dispute: 'Dispute payment', reverse: 'Reverse payment', reinstate: 'Reinstate payment', delete: 'Delete wrong entry', proof: 'Attach proof', history: 'Payment history' };

  return (
    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="grow">
        <div className="title" style={{ textDecoration: counted ? 'none' : 'line-through', opacity: counted ? 1 : 0.6 }}>
          {money(p.amount)} <span className="muted small">· {PAY_METHOD[p.method]} · {p.kind === 'advance' ? 'Advance' : 'Old pending'}</span>
        </div>
        <div className="meta">
          {showCustomer && <b>{p.customer_name} · </b>}{p.order_no}{p.txn_ref ? ` · UTR ${p.txn_ref}` : ''} · {dateTime(p.paid_at)}
        </div>
        <div className="meta">By {p.recorded_by_name}{p.verified_by_name ? ` · verified by ${p.verified_by_name} ${dateTime(p.verified_at)}` : ''}</div>
        {p.status_reason && !counted && <div className="hint err">{p.status_reason}</div>}
        {p.remarks && <div className="meta" style={{ whiteSpace: 'normal' }}>{p.remarks}</div>}
        <div className="badges">
          <PayStatusBadge s={p.status} />
          {p.proof_file_id ? <a className="badge blue" href={`/api/files/${p.proof_file_id}`} target="_blank" rel="noreferrer">View proof</a> : counted && <span className="badge orange">No proof yet</span>}
        </div>
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        {p.status === 'recorded' && !p.proof_file_id && <button className="btn sm" onClick={() => setAct('proof')}>Add proof</button>}
        {p.status === 'recorded' && p.proof_file_id && <button className="btn sm primary" onClick={() => setAct('verify')}><Icon name="check" size={16} /> Verify</button>}
        {owner && counted && <button className="btn sm danger" onClick={() => setAct('dispute')}>Dispute</button>}
        {owner && p.status === 'disputed' && <button className="btn sm" onClick={() => setAct('reinstate')}>Reinstate</button>}
        {owner && ['recorded', 'verified', 'disputed'].includes(p.status) && <button className="btn sm danger" onClick={() => setAct('reverse')}>Reverse</button>}
        {(owner ? ['recorded', 'disputed'].includes(p.status) : mineRecent) && <button className="btn sm ghost" onClick={() => setAct('delete')}>Delete</button>}
        <button className="btn sm ghost" onClick={openHistory}>History</button>
      </div>

      {act && (
        <Modal title={titles[act]} onClose={() => { setAct(null); setErr(null); }}>
          {err && <ErrorBox msg={err} />}
          <div className="muted mb">{money(p.amount)} · {p.customer_name ?? ''} · {p.order_no}</div>
          {act === 'proof' && <ProofPicker onUploaded={(f) => run('attach-proof', { file_id: f.id }, 'Proof attached')} />}
          {act === 'verify' && (
            <>
              <p>Confirm you checked the screenshot/receipt and the money is in the account.</p>
              <Field label="Verification remarks"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Matched in HDFC statement" /></Field>
              <button className="btn primary block" onClick={() => run('verify', { remarks: reason || null }, 'Payment verified')}>Mark verified</button>
            </>
          )}
          {needsReason && (
            <>
              <div className="alert warn small">
                {act === 'reverse' && 'Reversal is permanent. The amount stops counting as collected. Use it for bounced/failed payments or wrong entries.'}
                {act === 'dispute' && 'A disputed payment is NOT counted as collected until reinstated.'}
                {act === 'delete' && 'The entry stays in the audit history but will not be counted.'}
                {act === 'reinstate' && 'The payment will count as collected again.'}
              </div>
              <Field label="Reason" required><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <button className={`btn block ${act === 'reinstate' ? 'primary' : 'danger'}`} disabled={reason.trim().length < 3} onClick={() => run(act, { reason }, 'Done')}>Confirm {act}</button>
            </>
          )}
          {act === 'history' && (
            history ? (
              <div className="timeline">
                {history.map((h) => (
                  <div className="tl-item payment" key={h.id}>
                    <b>{h.action.replace('payment.', '').replace('_', ' ')}</b> by {h.actor_name ?? 'system'}
                    {h.reason && <div className="small">“{h.reason}”</div>}
                    <div className="when">{dateTime(h.created_at)}</div>
                  </div>
                ))}
              </div>
            ) : <div className="spinner" />
          )}
        </Modal>
      )}
    </div>
  );
}
