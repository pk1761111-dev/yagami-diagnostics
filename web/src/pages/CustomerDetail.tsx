import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, addDaysIST, dateOnly, dateTime, money, todayIST, CATEGORY, LEAD_STATUS, ORDER_STATUS, SOURCE } from '../api';
import { useSession } from '../session';
import { CallButtons, CategoryBadge, Empty, ErrorBox, Field, Icon, Loading, Modal, Money, Stat, useLoad, useToast } from '../ui';
import { PaymentRow, RecordPaymentModal } from './paymentParts';
import { STATES } from './CustomerNew';

type M = null | 'edit' | 'note' | 'enquiry' | 'transfer' | 'order' | { pay: any } | { orderEdit: any };

export function CustomerDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get(`/customers/${id}`), [id]);
  const [tab, setTab] = useState('timeline');
  const [modal, setModal] = useState<M>(null);
  useEffect(() => {
    const h = (e: any) => e.detail?.customer_id === id && reload();
    window.addEventListener('yg:notification', h);
    return () => window.removeEventListener('yg:notification', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (loading && !data) return <Loading />;
  if (error) return <div className="page"><ErrorBox msg={error} /></div>;
  const c = data.customer;
  const role = user!.role;
  const finance = role === 'owner' || role === 'staff3';
  const canEdit = data.canEdit;
  const canOrder = finance || canEdit;
  const today = todayIST();

  const quickFollowUp = async (d: string, field = 'follow_up_date') => {
    try {
      await api.patch(`/customers/${c.id}`, { [field]: d });
      toast(`Follow-up set for ${dateOnly(d)}`);
      reload();
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };
  const setStatus = async (s: string) => {
    try {
      await api.patch(`/customers/${c.id}`, { lead_status: s });
      toast(`Marked ${LEAD_STATUS[s]}`);
      reload();
    } catch (e: any) {
      toast(e.message, 'err');
    }
  };
  const resolve = async (eid: string) => {
    await api.post(`/customers/enquiries/${eid}/resolve`).then(() => { toast('Complaint resolved'); reload(); }).catch((e) => toast(e.message, 'err'));
  };
  const openComplaints = data.enquiries.filter((e: any) => e.is_complaint && !e.resolved_at);

  return (
    <div className="page">
      <div className="page-head">
        <Link to="/customers" className="icon-btn" aria-label="Back"><Icon name="back" /></Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</h1>
          <div className="muted small">{c.code} · {c.mobile}{c.city ? ` · ${c.city}` : ''}{c.state ? `, ${c.state}` : ''}</div>
        </div>
        <CallButtons mobile={c.mobile} />
      </div>
      <div className="badges mb">
        <CategoryBadge c={c.category} />
        <span className={`badge ${c.lead_status === 'won' ? 'green' : c.lead_status === 'lost' ? 'red' : ''}`}>{LEAD_STATUS[c.lead_status]}</span>
        {c.important && <span className="badge yellow">Important</span>}
        <span className="badge blue">With {c.assigned_name ?? 'nobody'}</span>
        <span className="badge">{SOURCE[c.source]}</span>
        {!finance && c.has_outstanding && <span className="badge red">Payment pending</span>}
        {openComplaints.length > 0 && <span className="badge red">{openComplaints.length} open complaint</span>}
      </div>

      {openComplaints.map((e: any) => (
        <div className="alert err" key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>{e.urgent ? 'URGENT complaint' : 'Complaint'} · {dateTime(e.created_at)}<div className="small">{e.notes}</div></div>
          <button className="btn sm" onClick={() => resolve(e.id)}>Resolved</button>
        </div>
      ))}

      {finance && (
        <div className="grid stats mb">
          <Stat label="Total orders" value={money(c.total_orders)} />
          <Stat label="Received" value={money(c.total_received)} tone="green" sub={Number(c.unverified_received) > 0 ? `${money(c.unverified_received)} not yet verified` : undefined} />
          <Stat label="Outstanding" value={money(c.outstanding)} tone={Number(c.outstanding) > 0 ? 'yellow' : ''} />
          <Stat label="Overdue" value={money(c.overdue)} tone={Number(c.overdue) > 0 ? 'red' : ''} sub={c.earliest_due ? `due since ${dateOnly(c.earliest_due)}` : undefined} />
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <div className="card-head"><h3>Details</h3>{canEdit && <button className="btn sm" onClick={() => setModal('edit')}>Edit</button>}</div>
          <dl className="kv">
            <dt>Vehicle</dt><dd>{c.vehicle_model ?? '—'}</dd>
            <dt>Requirement</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{c.requirement ?? '—'}</dd>
            <dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{c.notes ?? '—'}</dd>
            <dt>Follow-up</dt><dd>{c.follow_up_date ? <span className={c.follow_up_date <= today ? 'badge orange' : ''}>{dateOnly(c.follow_up_date)}</span> : '—'}</dd>
            {finance && <><dt>Payment follow-up</dt><dd>{c.payment_follow_up_date ? <span className={c.payment_follow_up_date <= today ? 'badge orange' : ''}>{dateOnly(c.payment_follow_up_date)}</span> : '—'}</dd></>}
            <dt>Customer since</dt><dd>{dateOnly(c.created_at)}</dd>
          </dl>
        </div>
        <div className="card">
          <h3 className="mb">Quick actions</h3>
          <div className="btn-row">
            <button className="btn" onClick={() => setModal('note')}><Icon name="phone" size={18} /> Log call / note</button>
            <button className="btn" onClick={() => setModal('enquiry')}><Icon name="chat" size={18} /> New enquiry / complaint</button>
            {canOrder && <button className="btn" onClick={() => setModal('order')}><Icon name="plus" size={18} /> New order</button>}
            {(role === 'owner' || ((role === 'staff1' || role === 'staff2') && canEdit)) && (
              <button className="btn" onClick={() => setModal('transfer')}><Icon name="swap" size={18} /> {role === 'owner' ? 'Reassign' : 'Transfer to Staff 3'}</button>
            )}
          </div>
          {canEdit && (
            <>
              <div className="field mt"><span>Next follow-up</span>
                <div className="chips">
                  {[['Today', 0], ['Tomorrow', 1], ['3 days', 3], ['1 week', 7]].map(([l, n]) => (
                    <button key={l} className="chip" onClick={() => quickFollowUp(addDaysIST(n as number))}>{l}</button>
                  ))}
                  <input type="date" className="input" style={{ width: 'auto', minHeight: 42 }} onChange={(e) => e.target.value && quickFollowUp(e.target.value)} aria-label="Pick follow-up date" />
                </div>
              </div>
              <div className="field"><span>Lead status</span>
                <div className="chips">
                  {Object.entries(LEAD_STATUS).map(([k, v]) => <button key={k} className={`chip ${c.lead_status === k ? 'on' : ''}`} onClick={() => setStatus(k)}>{v}</button>)}
                </div>
              </div>
            </>
          )}
          {finance && Number(c.outstanding) > 0 && (
            <div className="field"><span>Payment follow-up</span>
              <div className="chips">
                {[['Today', 0], ['Tomorrow', 1], ['3 days', 3], ['1 week', 7]].map(([l, n]) => (
                  <button key={l} className="chip" onClick={() => quickFollowUp(addDaysIST(n as number), 'payment_follow_up_date')}>{l}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="tabs mt">
        {[['timeline', 'Timeline'], ['orders', `Orders (${data.orders.length})`], ...(finance ? [['payments', `Payments (${data.payments.length})`]] : []), ['enquiries', `Enquiries (${data.enquiries.length})`]].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="card">
        {tab === 'timeline' && (data.timeline.length === 0 ? <Empty>No activity yet.</Empty> : (
          <div className="timeline">
            {data.timeline.map((a: any) => (
              <div key={a.id} className={`tl-item ${a.kind}`}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{a.message}</div>
                <div className="when">{a.user_name ?? 'System'} · {dateTime(a.created_at)}</div>
              </div>
            ))}
          </div>
        ))}
        {tab === 'orders' && (data.orders.length === 0 ? <Empty>No orders yet.</Empty> : (
          <div className="list">
            {data.orders.map((o: any) => (
              <div className="row" key={o.id} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="title">{o.order_no}{o.invoice_ref ? ` · Inv ${o.invoice_ref}` : ''}</div>
                  <div className="meta" style={{ whiteSpace: 'normal' }}>{o.description}</div>
                  <div className="badges">
                    <span className={`badge ${o.status === 'cancelled' ? 'red' : o.status === 'delivered' ? 'green' : 'blue'}`}>{ORDER_STATUS[o.status]}</span>
                    {o.payment_due_date && <span className={`badge ${o.payment_due_date < today && Number(o.balance) > 0 ? 'red' : ''}`}>Pay by {dateOnly(o.payment_due_date)}</span>}
                    {!finance && o.payment_pending && <span className="badge red">Payment pending</span>}
                  </div>
                </div>
                {finance && (
                  <div className="right">
                    <Money v={o.amount} />
                    <div className="small muted">Paid {money(o.received)}</div>
                    {Number(o.balance) > 0 && <div className="small" style={{ color: 'var(--yellow)' }}>Due {money(o.balance)}</div>}
                    <div className="btn-row mt" style={{ justifyContent: 'flex-end' }}>
                      {Number(o.balance) > 0 && !['quoted', 'cancelled'].includes(o.status) && <button className="btn sm primary" onClick={() => setModal({ pay: o })}>₹ Record payment</button>}
                      <button className="btn sm" onClick={() => setModal({ orderEdit: o })}>Update</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {tab === 'payments' && (data.payments.length === 0 ? <Empty>No payments recorded.</Empty> : (
          <div className="list">{data.payments.map((p: any) => <PaymentRow key={p.id} p={{ ...p, customer_name: c.name }} onDone={reload} />)}</div>
        ))}
        {tab === 'enquiries' && (
          <>
            {data.enquiries.map((e: any) => (
              <div className="row" key={e.id}>
                <div className="grow">
                  <div className="title">{e.is_complaint ? (e.urgent ? '⚠ Urgent complaint' : 'Complaint') : 'Enquiry'} · {SOURCE[e.source]}</div>
                  <div className="meta" style={{ whiteSpace: 'normal' }}>{e.notes ?? '—'}</div>
                  <div className="meta">{e.created_by_name} · {dateTime(e.created_at)}{e.resolved_at ? ` · resolved ${dateTime(e.resolved_at)}` : ''}</div>
                </div>
              </div>
            ))}
            {data.transfers.length > 0 && <h3 className="mt mb">Ownership history</h3>}
            {data.transfers.map((t: any) => (
              <div className="row" key={t.id}>
                <div className="grow">
                  <div className="title">{t.from_name ?? 'New'} → {t.to_name}</div>
                  <div className="meta" style={{ whiteSpace: 'normal' }}>{t.reason}</div>
                  <div className="meta">{t.automatic ? 'Automatic routing' : `By ${t.by_name}`} · {dateTime(t.created_at)}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {modal === 'edit' && <EditModal c={c} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'note' && <NoteModal id={c.id} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'enquiry' && <EnquiryModal id={c.id} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'transfer' && <TransferModal c={c} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'order' && <OrderModal customerId={c.id} finance={finance} onClose={() => setModal(null)} onDone={reload} />}
      {modal && typeof modal === 'object' && 'pay' in modal && <RecordPaymentModal order={modal.pay} customerName={c.name} onClose={() => setModal(null)} onDone={reload} />}
      {modal && typeof modal === 'object' && 'orderEdit' in modal && <OrderEditModal o={modal.orderEdit} owner={role === 'owner'} onClose={() => setModal(null)} onDone={reload} />}
    </div>
  );
}

function useSubmit(fn: () => Promise<any>, onDone: () => void, onClose: () => void, msg: string) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await fn();
      toast(msg);
      onDone();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return { err, busy, submit };
}

function EditModal({ c, onClose, onDone }: any) {
  const [f, setF] = useState({ name: c.name, mobile: c.mobile, city: c.city ?? '', state: c.state ?? '', category: c.category, vehicle_model: c.vehicle_model ?? '', requirement: c.requirement ?? '', notes: c.notes ?? '', important: c.important });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const s = useSubmit(() => api.patch(`/customers/${c.id}`, f), onDone, onClose, 'Saved');
  return (
    <Modal title="Edit customer" onClose={onClose}>
      <form onSubmit={s.submit}>
        {s.err && <ErrorBox msg={s.err} />}
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
        <Field label="Mobile" required><input className="input" type="tel" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} required /></Field>
        <Field label="Customer type" hint={f.category !== 'retail' && c.category === 'retail' ? <span className="hint warn">Will move to Staff 3 automatically.</span> : undefined}>
          <div className="chips">{Object.entries(CATEGORY).map(([k, v]) => <button type="button" key={k} className={`chip ${f.category === k ? 'on' : ''}`} onClick={() => set('category', k)}>{v}</button>)}</div>
        </Field>
        <div className="form-grid">
          <Field label="City"><input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="State"><select className="input" value={f.state} onChange={(e) => set('state', e.target.value)}><option value="">—</option>{STATES.map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>
        <Field label="Vehicle model"><input className="input" value={f.vehicle_model} onChange={(e) => set('vehicle_model', e.target.value)} /></Field>
        <Field label="Requirement"><textarea className="input" value={f.requirement} onChange={(e) => set('requirement', e.target.value)} /></Field>
        <Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={f.important} onChange={(e) => set('important', e.target.checked)} /> Important lead</label>
        <button className="btn primary block mt" disabled={s.busy}>Save</button>
      </form>
    </Modal>
  );
}

function NoteModal({ id, onClose, onDone }: any) {
  const [note, setNote] = useState('');
  const [kind, setKind] = useState('call');
  const s = useSubmit(() => api.post(`/customers/${id}/notes`, { note, kind }), onDone, onClose, 'Note saved');
  return (
    <Modal title="Log call / note" onClose={onClose}>
      <form onSubmit={s.submit}>
        {s.err && <ErrorBox msg={s.err} />}
        <div className="chips mb">
          {[['call', 'Phone call'], ['whatsapp', 'WhatsApp'], ['payment_followup', 'Payment follow-up'], ['note', 'Note']].map(([k, l]) => <button type="button" key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        <Field label="What happened?" required><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} required autoFocus /></Field>
        <button className="btn primary block" disabled={s.busy}>Save</button>
      </form>
    </Modal>
  );
}

function EnquiryModal({ id, onClose, onDone }: any) {
  const { user } = useSession();
  const [f, setF] = useState({ source: user!.role === 'staff2' ? 'whatsapp' : 'phone', notes: '', is_complaint: false, urgent: false });
  const s = useSubmit(() => api.post(`/customers/${id}/enquiries`, f), onDone, onClose, 'Enquiry logged');
  return (
    <Modal title="New enquiry / complaint" onClose={onClose}>
      <form onSubmit={s.submit}>
        {s.err && <ErrorBox msg={s.err} />}
        <div className="chips mb">{Object.entries(SOURCE).map(([k, v]) => <button type="button" key={k} className={`chip ${f.source === k ? 'on' : ''}`} onClick={() => setF({ ...f, source: k })}>{v}</button>)}</div>
        <Field label="Details"><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} autoFocus /></Field>
        <label className="check"><input type="checkbox" checked={f.is_complaint} onChange={(e) => setF({ ...f, is_complaint: e.target.checked })} /> This is a complaint</label>
        {f.is_complaint && <label className="check"><input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} /> Urgent – alert Staff 3 and Owner</label>}
        <button className="btn primary block mt" disabled={s.busy}>Save</button>
      </form>
    </Modal>
  );
}

function TransferModal({ c, onClose, onDone }: any) {
  const { user } = useSession();
  const { data } = useLoad(() => api.get('/users'), []);
  const owner = user!.role === 'owner';
  const options = (data?.users ?? []).filter((u: any) => (u.active ?? true) && u.id !== c.assigned_to && (owner || u.role === 'staff3'));
  const [to, setTo] = useState('');
  const [reason, setReason] = useState(owner ? '' : 'Payment pending');
  const target = to || options[0]?.id;
  const s = useSubmit(() => api.post(`/customers/${c.id}/transfer`, { to_user_id: target, reason }), onDone, onClose, 'Lead transferred – they have been notified');
  return (
    <Modal title={owner ? 'Reassign lead' : 'Transfer to Staff 3'} onClose={onClose}>
      <form onSubmit={s.submit}>
        {s.err && <ErrorBox msg={s.err} />}
        <p className="muted">Currently with <b>{c.assigned_name}</b>. The new owner and the Owner are notified, and this is recorded in the history.</p>
        <Field label="Move to" required>
          <select className="input" value={target ?? ''} onChange={(e) => setTo(e.target.value)} required>
            {options.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.role === 'owner' ? 'Owner' : u.role.replace('staff', 'Staff ')})</option>)}
          </select>
        </Field>
        <Field label="Reason" required>
          {!owner && (
            <div className="chips mb">{['Payment pending', 'Dealer / bulk enquiry', 'Important lead', 'Old pending payment'].map((r) => <button type="button" key={r} className={`chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>{r}</button>)}</div>
          )}
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        </Field>
        <button className="btn primary block" disabled={s.busy || !target}>Transfer</button>
      </form>
    </Modal>
  );
}

function OrderModal({ customerId, finance, onClose, onDone }: any) {
  const [f, setF] = useState({ description: '', amount: '', status: 'confirmed', invoice_ref: '', payment_due_date: addDaysIST(7) });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const s = useSubmit(() => api.post('/orders', { ...f, customer_id: customerId, invoice_ref: f.invoice_ref || null, payment_due_date: f.payment_due_date || null }), onDone, onClose, 'Order saved');
  return (
    <Modal title="New order" onClose={onClose}>
      <form onSubmit={s.submit}>
        {s.err && <ErrorBox msg={s.err} />}
        <div className="chips mb">
          <button type="button" className={`chip ${f.status === 'quoted' ? 'on' : ''}`} onClick={() => set('status', 'quoted')}>Quotation</button>
          <button type="button" className={`chip ${f.status === 'confirmed' ? 'on' : ''}`} onClick={() => set('status', 'confirmed')}>Confirmed order</button>
        </div>
        <Field label="Items / description" required><textarea className="input" value={f.description} onChange={(e) => set('description', e.target.value)} required /></Field>
        <Field label="Order value (₹)" required><input className="input" type="number" inputMode="decimal" step="0.01" min="1" value={f.amount} onChange={(e) => set('amount', e.target.value)} required /></Field>
        <div className="form-grid">
          <Field label="Invoice no."><input className="input" value={f.invoice_ref} onChange={(e) => set('invoice_ref', e.target.value)} /></Field>
          <Field label="Payment due by"><input className="input" type="date" value={f.payment_due_date} onChange={(e) => set('payment_due_date', e.target.value)} /></Field>
        </div>
        {!finance && <p className="hint">Staff 3 records payments against this order.</p>}
        <button className="btn primary block" disabled={s.busy}>Save order</button>
      </form>
    </Modal>
  );
}

function OrderEditModal({ o, owner, onClose, onDone }: any) {
  const [f, setF] = useState({ status: o.status, invoice_ref: o.invoice_ref ?? '', payment_due_date: o.payment_due_date ?? '', amount: o.amount, reason: '' });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const amountChanged = Number(f.amount) !== Number(o.amount);
  const s = useSubmit(
    () => api.patch(`/orders/${o.id}`, { status: f.status, invoice_ref: f.invoice_ref || null, payment_due_date: f.payment_due_date || null, ...(amountChanged ? { amount: f.amount, reason: f.reason } : {}) }),
    onDone, onClose, 'Order updated',
  );
  const canAmount = owner || o.status === 'quoted';
  return (
    <Modal title={`Update ${o.order_no}`} onClose={onClose}>
      <form onSubmit={s.submit}>
        {s.err && <ErrorBox msg={s.err} />}
        <Field label="Order status">
          <div className="chips">{Object.entries(ORDER_STATUS).map(([k, v]) => <button type="button" key={k} className={`chip ${f.status === k ? 'on' : ''}`} onClick={() => set('status', k)}>{v}</button>)}</div>
        </Field>
        <div className="form-grid">
          <Field label="Invoice no."><input className="input" value={f.invoice_ref} onChange={(e) => set('invoice_ref', e.target.value)} /></Field>
          <Field label="Payment due by"><input className="input" type="date" value={f.payment_due_date} onChange={(e) => set('payment_due_date', e.target.value)} /></Field>
        </div>
        <Field label="Order value (₹)" hint={!canAmount ? <span className="hint">Only the Owner can change a confirmed order value.</span> : undefined}>
          <input className="input" type="number" step="0.01" value={f.amount} disabled={!canAmount} onChange={(e) => set('amount', e.target.value)} />
        </Field>
        {amountChanged && o.status !== 'quoted' && <Field label="Reason for change" required><input className="input" value={f.reason} onChange={(e) => set('reason', e.target.value)} required minLength={3} /></Field>}
        <button className="btn primary block" disabled={s.busy}>Save</button>
      </form>
    </Modal>
  );
}
