// src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

import LoginPage       from './pages/LoginPage';
import DashboardPage   from './pages/DashboardPage';
import BinsPage        from './pages/BinsPage';
import RewardsPage     from './pages/RewardsPage';
import UsersPage       from './pages/UsersPage';
import NotificationsPage from './pages/NotificationsPage';

// ─── Add your Firebase Auth UID here ────────────────────────────────────────
// Firebase Console → Authentication → Users → copy UID
const ADMIN_UIDS = ['PASTE_YOUR_ADMIN_UID_HERE'];

const NAV = [
  { to: '/',              label: 'Dashboard',     icon: '📊' },
  { to: '/users',         label: 'Users & Points', icon: '👥' },
  { to: '/bins',          label: 'Manage Bins',    icon: '🗑️' },
  { to: '/rewards',       label: 'Manage Rewards', icon: '🎁' },
  { to: '/notifications', label: 'Notifications',  icon: '🔔' },
];

function Sidebar({ user, onSignOut }) {
  return (
    <aside style={s.sidebar}>
      {/* Logo */}
      <div style={s.logoRow}>
        <span style={{ fontSize: 30 }}>♻️</span>
        <div>
          <div style={s.logoText}>RecycleScan</div>
          <div style={s.adminBadge}>ADMIN PANEL</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, paddingTop: 8 }}>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            style={({ isActive }) => ({
              ...s.navItem,
              background: isActive ? 'rgba(255,255,255,0.14)' : 'transparent',
              borderLeft: `3px solid ${isActive ? '#69F0AE' : 'transparent'}`,
              color: isActive ? '#fff' : 'rgba(255,255,255,0.72)',
            })}>
            <span style={{ fontSize: 17 }}>{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User info + sign out */}
      <div style={s.userRow}>
        <div style={s.userAvatar}>{(user?.email || '?')[0].toUpperCase()}</div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={s.userEmail}>{user?.email}</div>
          <div style={s.userRole}>Administrator</div>
        </div>
        <button onClick={onSignOut} style={s.signOutBtn} title="Sign out">⏻</button>
      </div>
    </aside>
  );
}

export default function App() {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const demo = localStorage.getItem('demoAdmin') === 'true';
    if (demo) {
      setUser({ email: 'admin@gmail.com', uid: 'DEMO_ADMIN' });
      setLoading(false);
    }
    const unsub = onAuthStateChanged(auth, u => {
      if (!demo) setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const signOut = async () => {
    localStorage.removeItem('demoAdmin');
    try { await auth.signOut(); } catch (e) { /* ignore */ }
    setUser(null);
  };

  if (loading) return (
    <div style={s.center}>
      <div style={s.spinner} /><p style={{ color: '#aaa', marginTop: 14 }}>Loading…</p>
    </div>
  );

  const isAdmin = user && ADMIN_UIDS.includes(user.uid);

  if (!user || !isAdmin) return (
    <BrowserRouter><Routes><Route path="*" element={<LoginPage />} /></Routes></BrowserRouter>
  );

  return (
    <BrowserRouter>
      <div style={s.layout}>
        <Sidebar user={user} onSignOut={signOut} />
        <main style={s.main}>
          <Routes>
            <Route path="/"              element={<DashboardPage />} />
            <Route path="/users"         element={<UsersPage />} />
            <Route path="/bins"          element={<BinsPage />} />
            <Route path="/rewards"       element={<RewardsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="*"              element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

const s = {
  layout:     { display: 'flex', height: '100vh', background: '#F0F4F8', fontFamily: "'Inter', system-ui, sans-serif" },
  sidebar:    { width: 230, background: 'linear-gradient(180deg,#1B5E20 0%,#2E7D32 100%)', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: '2px 0 12px rgba(0,0,0,.15)' },
  logoRow:    { display: 'flex', alignItems: 'center', gap: 10, padding: '22px 18px 20px', borderBottom: '1px solid rgba(255,255,255,.10)' },
  logoText:   { color: '#fff', fontWeight: 800, fontSize: 16, lineHeight: 1.2 },
  adminBadge: { background: '#69F0AE', color: '#1B5E20', fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginTop: 2 },
  navItem:    { display: 'flex', alignItems: 'center', gap: 11, padding: '11px 20px', fontSize: 13.5, fontWeight: 500, textDecoration: 'none', transition: 'all .15s' },
  userRow:    { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,.10)' },
  userAvatar: { width: 32, height: 32, borderRadius: '50%', background: '#69F0AE', color: '#1B5E20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 },
  userEmail:  { color: 'rgba(255,255,255,.85)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  userRole:   { color: 'rgba(255,255,255,.45)', fontSize: 10 },
  signOutBtn: { background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  main:       { flex: 1, overflow: 'auto', padding: '28px 32px' },
  center:     { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F0F4F8' },
  spinner:    { width: 36, height: 36, border: '3px solid #ddd', borderTop: '3px solid #2E7D32', borderRadius: '50%', animation: 'spin .7s linear infinite' },
};
