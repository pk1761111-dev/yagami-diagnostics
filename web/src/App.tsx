import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useSession, type Role } from './session';
import { Icon, Loading } from './ui';
import { Login, ChangePassword } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Customers } from './pages/Customers';
import { CustomerNew } from './pages/CustomerNew';
import { CustomerDetail } from './pages/CustomerDetail';
import { Queue } from './pages/Queue';
import { Payments } from './pages/Payments';
import { Reports, ReportView } from './pages/Reports';
import { Notifications } from './pages/Notifications';
import { Team } from './pages/Team';
import { Audit } from './pages/Audit';

type NavItem = { to: string; label: string; icon: string; roles: Role[]; mobile?: boolean; fab?: boolean };
const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home', roles: ['owner', 'staff1', 'staff2', 'staff3'], mobile: true },
  { to: '/queue', label: 'Priority', icon: 'flag', roles: ['owner', 'staff3'], mobile: true },
  { to: '/customers', label: 'Customers', icon: 'users', roles: ['owner', 'staff1', 'staff2', 'staff3'], mobile: true },
  { to: '/customers/new', label: 'New enquiry', icon: 'plus', roles: ['owner', 'staff1', 'staff2', 'staff3'], mobile: true, fab: true },
  { to: '/payments', label: 'Payments', icon: 'rupee', roles: ['owner', 'staff3'], mobile: true },
  { to: '/reports', label: 'Reports', icon: 'chart', roles: ['owner'] },
  { to: '/team', label: 'Team', icon: 'team', roles: ['owner'] },
  { to: '/audit', label: 'Audit log', icon: 'shield', roles: ['owner'] },
  { to: '/notifications', label: 'Alerts', icon: 'bell', roles: ['owner', 'staff1', 'staff2', 'staff3'] },
];

export function App() {
  const { user, ready, demoMode } = useSession();
  if (!ready) return <Loading />;
  if (!user) return <Login />;
  if (user.must_change_password) return <ChangePassword forced />;
  return (
    <>
      {demoMode && <div className="demo-banner"><div>DEMO MODE – sample data only, not real customers or payments</div></div>}
      <Shell />
    </>
  );
}

function Shell() {
  const { user, unread, logout, soundOn, setSoundOn } = useSession();
  const nav = useNavigate();
  const items = NAV.filter((n) => n.roles.includes(user!.role));
  const mobileItems = items.filter((n) => n.mobile);
  if (user!.role === 'staff1' || user!.role === 'staff2') mobileItems.push({ to: '/customers?followup=today', label: 'Follow-ups', icon: 'phone', roles: [] });
  const owner = user!.role === 'owner';
  const brand = (
    <div className="brand">
      <img src="/icons/icon-192.png" alt="" />
      <div>YAGAMI <b>AI</b><small>Sales &amp; Payment Control</small></div>
    </div>
  );
  return (
    <div className="shell">
      <aside className="side">
        {brand}
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/' || n.to === '/customers'}>
            <span className="ic"><Icon name={n.icon} size={19} /></span>{n.label}
            {n.to === '/notifications' && unread > 0 && <span className="badge red" style={{ marginLeft: 'auto' }}>{unread}</span>}
          </NavLink>
        ))}
        <div className="who">
          <div style={{ fontWeight: 700 }}>{user!.name}</div>
          <div className="muted small">{user!.roleLabel}</div>
          <div className="btn-row mt">
            <button className="btn sm ghost" onClick={() => nav('/password')}>Password</button>
            <button className="btn sm ghost" onClick={logout}><Icon name="logout" size={16} /> Log out</button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          {brand}
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? 'Mute alert sound' : 'Turn on alert sound'} title={soundOn ? 'Sound on' : 'Sound off'}>
            <Icon name={soundOn ? 'sound' : 'mute'} size={20} />
          </button>
          <button className="icon-btn" onClick={() => nav('/notifications')} aria-label={`Notifications (${unread} unread)`}>
            <Icon name="bell" size={20} />
            {unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <MoreMenu owner={owner} />
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/new" element={<CustomerNew />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/password" element={<ChangePassword />} />
          {(owner || user!.role === 'staff3') && <Route path="/queue" element={<Queue />} />}
          {(owner || user!.role === 'staff3') && <Route path="/payments" element={<Payments />} />}
          {owner && <Route path="/reports" element={<Reports />} />}
          {owner && <Route path="/reports/:date" element={<ReportView />} />}
          {owner && <Route path="/team" element={<Team />} />}
          {owner && <Route path="/audit" element={<Audit />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <nav className="bottomnav">
        {mobileItems.slice(0, 5).map((n) => (
          <NavLink key={n.to} to={n.to} end className={n.fab ? 'fab' : ''}>
            <span className="ic"><Icon name={n.icon} size={n.fab ? 24 : 22} /></span>
            {n.fab ? 'New' : n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function MoreMenu({ owner }: { owner: boolean }) {
  const [open, setOpen] = useState(false);
  const { logout, user } = useSession();
  const nav = useNavigate();
  const go = (p: string) => { setOpen(false); nav(p); };
  return (
    <div style={{ position: 'relative' }} className="more-menu">
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Menu"><Icon name="more" size={20} /></button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 52, width: 230, padding: 8, zIndex: 40, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }} onMouseLeave={() => setOpen(false)}>
          <div style={{ padding: '8px 10px 10px' }}><b>{user!.name}</b><div className="muted small">{user!.roleLabel}</div></div>
          {owner && <button className="btn ghost block sm" style={{ justifyContent: 'flex-start' }} onClick={() => go('/reports')}><Icon name="chart" size={18} /> Daily reports</button>}
          {owner && <button className="btn ghost block sm" style={{ justifyContent: 'flex-start', marginTop: 4 }} onClick={() => go('/team')}><Icon name="team" size={18} /> Team</button>}
          {owner && <button className="btn ghost block sm" style={{ justifyContent: 'flex-start', marginTop: 4 }} onClick={() => go('/audit')}><Icon name="shield" size={18} /> Audit log</button>}
          <button className="btn ghost block sm" style={{ justifyContent: 'flex-start', marginTop: 4 }} onClick={() => go('/password')}><Icon name="shield" size={18} /> Change password</button>
          {(window as any).YG && <button className="btn ghost block sm" style={{ justifyContent: 'flex-start', marginTop: 4 }} onClick={() => confirm('Server link badalna hai?') && (window as any).YG.changeServer()}><Icon name="swap" size={18} /> Server link badlein</button>}
          <button className="btn ghost block sm" style={{ justifyContent: 'flex-start', marginTop: 4 }} onClick={logout}><Icon name="logout" size={18} /> Log out</button>
        </div>
      )}
    </div>
  );
}
