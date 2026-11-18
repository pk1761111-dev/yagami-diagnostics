import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, dateOnly, money, CATEGORY } from '../api';
import { useSession } from '../session';
import { CallButtons, CategoryBadge, Empty, ErrorBox, Icon, Loading, Money, Stat, initials, useLoad } from '../ui';

export function Dashboard() {
  const { user } = useSession();
  const { data, error, loading, reload } = useLoad(() => api.get('/dashboard'), []);
  useEffect(() => {
    const h = () => reload();
    window.addEventListener('yg:notification', h);
    const t = setInterval(reload, 120_000);
    return () => { window.removeEventListener('yg:notification', h); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (loading && !data) return <Loading />;
  if (error) return <div className="page"><ErrorBox msg={error} /></div>;
  const greet = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
  const h = Number(greet);
  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <div className="muted small">{dateOnly(data.today)}</div>
          <h1>{h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, {user!.name.split(' ')[0]}</h1>
        </div>
        <Link to="/customers/new" className="btn primary"><Icon name="plus" size={20} /> New enquiry</Link>
      </div>
      {data.role === 'owner' && <OwnerDash d={data} />}
      {data.role === 'staff3' && <Staff3Dash d={data} />}
      {(data.role === 'staff1' || data.role === 'staff2') && <StaffDash d={data} />}
    </div>
  );
}

function OwnerDash({ d }: { d: any }) {
  const s = d.stats;
  return (
    <>
      {!d.whatsappConfigured && <div className="alert info small">WhatsApp alerts are not connected yet – in-app alerts are working. Add the Cloud API keys on the server to enable WhatsApp.</div>}
      <h3 className="mb">Today</h3>
      <div className="grid stats">
        <Stat label="Enquiries today" value={s.enquiries.total} sub={`${s.enquiries.calls} calls · ${s.enquiries.whatsapp} WhatsApp`} tone="blue" />
        <Stat label="Normal leads" value={s.leads.normal} sub="new today" />
        <Stat label="Important leads" value={s.leads.important} sub={`${s.leads.dealer_bulk} dealer / bulk`} tone="yellow" to="/queue" />
        <Stat label="Orders confirmed" value={s.orders.count} tone="green" />
        <Stat label="Total sales value" value={money(s.orders.value)} tone="green" />
        <Stat label="Advance collected" value={money(s.collections.advance)} tone="green" to="/payments" />
        <Stat label="Old pending collected" value={money(s.collections.old_pending)} tone="green" to="/payments" sub={Number(s.collections.unverified) > 0 ? `${money(s.collections.unverified)} awaiting verification` : 'all verified'} />
        <Stat label="Follow-ups due today" value={s.followups.leads_due + s.followups.payments_due} sub={`${s.followups.missed} missed / overdue`} tone={s.followups.missed ? 'orange' : ''} to="/customers?followup=today" />
      </div>
      <h3 className="mb mt">Money owed to YAGAMI</h3>
      <div className="grid stats">
        <Stat label="Total outstanding" value={money(s.outstanding.total)} sub={`${s.outstanding.customers} customers`} tone="yellow" to="/customers?outstanding=1" />
        <Stat label="Overdue payments" value={money(s.outstanding.overdue)} sub={`${s.outstanding.overdue_orders} orders · ${s.outstanding.overdue_customers} customers`} tone="red" to="/queue" />
      </div>
      <div className="grid two mt">
        <div className="card">
          <div className="card-head"><h3>Priority queue</h3><Link to="/queue" className="btn sm">View all</Link></div>
          <QueueList rows={d.queue} />
        </div>
        <div className="card">
          <div className="card-head"><h3>Staff performance · today</h3></div>
          <StaffTable staff={s.staff} />
        </div>
      </div>
    </>
  );
}

export function StaffTable({ staff }: { staff: any[] }) {
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr><th>Staff</th><th className="num">Enq.</th><th className="num">Leads</th><th className="num">Actions</th><th className="num">Orders</th><th className="num">Collected</th><th className="num">Due</th><th className="num">Missed</th></tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id}>
              <td><b>{s.name}</b><div className="muted small">{s.role === 'owner' ? 'Owner' : s.role.replace('staff', 'Staff ')} · {s.open_leads} open</div></td>
              <td className="num">{s.enquiries}</td>
              <td className="num">{s.leads_created}</td>
              <td className="num">{s.actions}</td>
              <td className="num">{s.orders_confirmed}{Number(s.order_value) > 0 && <div className="muted small">{money(s.order_value)}</div>}</td>
              <td className="num">{money(s.collected)}</td>
              <td className="num">{s.followups_due}</td>
              <td className="num">{s.missed_followups > 0 ? <span className="badge red">{s.missed_followups}</span> : 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QueueList({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty>Nothing urgent right now. 👍</Empty>;
  return (
    <div className="list">
      {rows.map((r) => {
        const u = r.urgency >= 900 ? 4 : r.urgency >= 400 ? 3 : r.urgency >= 200 ? 2 : 1;
        return (
          <Link to={`/customers/${r.id}`} className="row" key={r.id}>
            <span className={`urgency u${u}`} />
            <div className="grow">
              <div className="title">{r.name}</div>
              <div className="meta">{CATEGORY[r.category]} · {r.city ?? r.mobile}{r.assigned_name ? ` · ${r.assigned_name}` : ''}</div>
              <div className="badges">
                {r.reasons.map((x: string) => (
                  <span key={x} className={`badge ${/Urgent|Overdue/.test(x) ? 'red' : /Pending|follow-up/i.test(x) ? 'orange' : 'yellow'}`}>{x}</span>
                ))}
              </div>
            </div>
            <div className="right">
              {Number(r.outstanding) > 0 && <Money v={r.outstanding} tone={Number(r.overdue) > 0 ? 'red' : 'yellow'} />}
              {(r.payment_follow_up_date || r.follow_up_date) && <div className="muted small">Follow-up {dateOnly(r.payment_follow_up_date ?? r.follow_up_date)}</div>}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Staff3Dash({ d }: { d: any }) {
  const s = d.stats;
  return (
    <>
      <div className="grid stats">
        <Stat label="Advance collected today" value={money(s.collections.advance)} tone="green" to="/payments" />
        <Stat label="Old pending collected" value={money(s.collections.old_pending)} tone="green" to="/payments" />
        <Stat label="Awaiting verification" value={money(s.collections.unverified)} tone="orange" to="/payments" sub="attach proof & verify" />
        <Stat label="Total outstanding" value={money(s.outstanding.total)} sub={`${s.outstanding.customers} customers`} tone="yellow" to="/customers?outstanding=1" />
        <Stat label="Overdue" value={money(s.outstanding.overdue)} sub={`${s.outstanding.overdue_customers} customers`} tone="red" />
        <Stat label="Payment follow-ups today" value={s.followups.payments_due} tone="blue" />
        <Stat label="My open leads" value={d.mine.open_leads} sub={`${d.mine.new_leads} new`} />
        <Stat label="My follow-ups today" value={d.mine.followups_today} sub={d.mine.followups_overdue ? `${d.mine.followups_overdue} overdue` : undefined} tone={d.mine.followups_overdue ? 'orange' : ''} to="/customers?followup=today&assigned=me" />
      </div>
      <div className="card mt">
        <div className="card-head"><h3>Priority queue</h3><Link to="/queue" className="btn sm">Full queue</Link></div>
        <QueueList rows={d.queue} />
      </div>
    </>
  );
}

function StaffDash({ d }: { d: any }) {
  const m = d.myToday;
  return (
    <>
      <div className="grid stats">
        <Stat label="Follow-ups today" value={d.mine.followups_today} tone="yellow" to="/customers?followup=today&assigned=me" />
        <Stat label="Overdue follow-ups" value={d.mine.followups_overdue} tone={d.mine.followups_overdue ? 'red' : ''} to="/customers?followup=overdue&assigned=me" />
        <Stat label="My open leads" value={d.mine.open_leads} sub={`${d.mine.important_open} important`} to="/customers?assigned=me" />
        <Stat label="Enquiries I logged today" value={m?.enquiries ?? 0} sub={`${m?.leads_created ?? 0} new customers`} tone="blue" />
      </div>
      <div className="card mt">
        <div className="card-head"><h3>Call these customers</h3></div>
        {d.followups.length === 0 ? (
          <Empty>No follow-ups due. Great work!</Empty>
        ) : (
          <div className="list">
            {d.followups.map((c: any) => (
              <Link to={`/customers/${c.id}`} className="row" key={c.id}>
                <div className={`avatar ${c.important ? 'priority' : ''}`}>{initials(c.name)}</div>
                <div className="grow">
                  <div className="title">{c.name}</div>
                  <div className="meta">{c.city ?? c.mobile} · due {dateOnly(c.follow_up_date)}</div>
                  <div className="badges"><CategoryBadge c={c.category} />{c.important && <span className="badge yellow">Important</span>}</div>
                </div>
                <CallButtons mobile={c.mobile} />
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="alert info mt small">Dealer, reseller, bulk, fleet and manufacturer customers go to Staff 3 automatically. Customers with pending payment: open them and tap <b>Transfer to Staff 3</b>.</div>
    </>
  );
}
