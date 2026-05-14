// src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import useMediaQuery from './hooks/useMediaQuery';

import LoginPage       from './pages/LoginPage';
import DashboardPage   from './pages/DashboardPage';
import BinsPage        from './pages/BinsPage';
import RewardsPage     from './pages/RewardsPage';
import UsersPage       from './pages/UsersPage';
import NotificationsPage from './pages/NotificationsPage';
import ProfilePage     from './pages/ProfilePage';

// ─── Add your Firebase Auth UID here if you want UID-based access control ───
// Firebase Console → Authentication → Users → copy UID
const ADMIN_UIDS = ['PASTE_YOUR_ADMIN_UID_HERE'];
const CONFIGURED_ADMIN_UIDS = ADMIN_UIDS.filter(uid => uid && !uid.startsWith('PASTE_'));

const NAV = [
  { to: '/',              label: 'Dashboard',      mobileLabel: 'Dash',    icon: '📊' },
  { to: '/users',         label: 'Users & Points', mobileLabel: 'Users',   icon: '👥' },
  { to: '/bins',          label: 'Manage Bins',    mobileLabel: 'Bins',    icon: '🗑️' },
  { to: '/rewards',       label: 'Manage Rewards', mobileLabel: 'Rewards', icon: '🎁' },
  { to: '/notifications', label: 'Notifications',  mobileLabel: 'Alerts',  icon: '🔔' },
];

function Sidebar({ user, onSignOut, onNavigate, isMobile }) {
  return (
    <aside style={{ ...s.sidebar, ...(isMobile ? s.sidebarMobile : {}) }}>
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
            onClick={onNavigate}
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
        <NavLink to="/profile" onClick={onNavigate} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, textDecoration: 'none', cursor: 'pointer' }}>
          <div style={s.userAvatar}>{(user?.email || '?')[0].toUpperCase()}</div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={s.userEmail}>{user?.email}</div>
            <div style={s.userRole}>Administrator</div>
          </div>
        </NavLink>
        <button onClick={onSignOut} style={s.signOutBtn} title="Sign out">⏻</button>
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  return (
    <nav style={s.mobileBottomNav} aria-label="Primary navigation">
      {NAV.map(n => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          style={({ isActive }) => ({
            ...s.bottomNavItem,
            color: isActive ? '#1B5E20' : '#6f7d88',
            background: isActive ? '#ebf7ec' : 'transparent',
          })}
        >
          <span style={s.bottomNavIcon}>{n.icon}</span>
          <span style={s.bottomNavLabel}>{n.mobileLabel}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 900px)');
  const isTinyMobile = useMediaQuery('(max-width: 360px)');

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setLoading(false); }), []);

  const signOut = () => auth.signOut();

  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  if (loading) return (
    <div style={s.center}>
      <div style={s.spinner} /><p style={{ color: '#aaa', marginTop: 14 }}>Loading…</p>
    </div>
  );

  const isAdmin = Boolean(user) && (
    CONFIGURED_ADMIN_UIDS.length === 0 || CONFIGURED_ADMIN_UIDS.includes(user.uid)
  );

  if (!user || !isAdmin) return (
    <BrowserRouter><Routes><Route path="*" element={<LoginPage />} /></Routes></BrowserRouter>
  );

  return (
    <BrowserRouter>
      {isMobile ? (
        <div style={s.mobileLayout}>
          <header style={{ ...s.mobileHeader, ...(isTinyMobile ? s.mobileHeaderTiny : {}) }}>
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              style={s.menuBtn}
              aria-label="Open menu"
            >
              ☰
            </button>
            <div style={{ ...s.mobileHeaderTitle, ...(isTinyMobile ? s.mobileHeaderTitleTiny : {}) }}>RecycleScan Admin</div>
            <button onClick={signOut} style={s.mobileSignOutBtn} title="Sign out">⏻</button>
          </header>

          {mobileNavOpen && <div style={s.mobileOverlay} onClick={() => setMobileNavOpen(false)} />}

          {mobileNavOpen && (
            <div style={s.mobileDrawer}>
              <Sidebar
                user={user}
                onSignOut={signOut}
                onNavigate={() => setMobileNavOpen(false)}
                isMobile
              />
            </div>
          )}

          <main style={{ ...s.mainMobile, ...(isTinyMobile ? s.mainMobileTiny : {}) }}>
            <Routes>
              <Route path="/"              element={<DashboardPage />} />
              <Route path="/users"         element={<UsersPage />} />
              <Route path="/bins"          element={<BinsPage />} />
              <Route path="/rewards"       element={<RewardsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/profile"       element={<ProfilePage user={user} />} />
              <Route path="*"              element={<Navigate to="/" />} />
            </Routes>
          </main>

          <MobileBottomNav />
        </div>
      ) : (
        <div style={s.layout}>
          <Sidebar user={user} onSignOut={signOut} />
          <main style={s.main}>
            <Routes>
              <Route path="/"              element={<DashboardPage />} />
              <Route path="/users"         element={<UsersPage />} />
              <Route path="/bins"          element={<BinsPage />} />
              <Route path="/rewards"       element={<RewardsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/profile"       element={<ProfilePage user={user} />} />
              <Route path="*"              element={<Navigate to="/" />} />
            </Routes>
          </main>
        </div>
      )}
    </BrowserRouter>
  );
}

const s = {
  layout:     { display: 'flex', height: '100vh', background: '#F0F4F8', fontFamily: "'Inter', system-ui, sans-serif" },
  sidebar:    { width: 230, background: 'linear-gradient(180deg,#1B5E20 0%,#2E7D32 100%)', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: '2px 0 12px rgba(0,0,0,.15)' },
  sidebarMobile:{ width: '100%', height: '100dvh' },
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
  mobileLayout:{ minHeight: '100vh', background: '#F0F4F8', fontFamily: "'Inter', system-ui, sans-serif" },
  mobileHeader:{ position: 'sticky', top: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#fff', borderBottom: '1px solid #e8edf2' },
  mobileHeaderTiny: { padding: '10px 10px' },
  mobileHeaderTitle:{ fontSize: 16, fontWeight: 800, color: '#1B5E20' },
  mobileHeaderTitleTiny: { fontSize: 14 },
  menuBtn:    { background: '#f2f7f3', border: '1px solid #dfe8e2', color: '#1B5E20', width: 36, height: 36, borderRadius: 8, cursor: 'pointer', fontSize: 18, lineHeight: 1 },
  mobileSignOutBtn:{ background: '#f9f1f1', border: '1px solid #f0dede', color: '#a42f2f', width: 36, height: 36, borderRadius: 8, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  mobileOverlay:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 1200 },
  mobileDrawer:{ position: 'fixed', top: 0, left: 0, width: '80%', maxWidth: 320, height: '100dvh', zIndex: 1300, boxShadow: '4px 0 18px rgba(0,0,0,.25)' },
  mainMobile: { padding: '14px 12px 90px' },
  mainMobileTiny: { padding: '10px 8px 88px' },
  mobileBottomNav: { position: 'fixed', left: 10, right: 10, bottom: 10, zIndex: 1150, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 4, padding: 6, borderRadius: 14, background: 'rgba(255,255,255,.95)', border: '1px solid #dfe8e2', boxShadow: '0 10px 24px rgba(0,0,0,.14)', backdropFilter: 'blur(6px)' },
  bottomNavItem: { minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '6px 2px', textDecoration: 'none', borderRadius: 10, transition: 'all .15s' },
  bottomNavIcon: { fontSize: 16, lineHeight: 1 },
  bottomNavLabel: { fontSize: 10, fontWeight: 700, lineHeight: 1.1 },
  center:     { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F0F4F8' },
  spinner:    { width: 36, height: 36, border: '3px solid #ddd', borderTop: '3px solid #2E7D32', borderRadius: '50%', animation: 'spin .7s linear infinite' },
};
