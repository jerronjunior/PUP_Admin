// src/pages/DashboardPage.js
// Mirrors admin_dashboard_screen.dart:
//   - System Statistics (total users, bins, bottles recycled)
//   - Admin action cards (Manage Bins, Manage Rewards)
//   - User Points and Bottles list (live stream)
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, orderBy, getDocs } from 'firebase/firestore';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Link } from 'react-router-dom';
import useMediaQuery from '../hooks/useMediaQuery';

export default function DashboardPage() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isTinyMobile = useMediaQuery('(max-width: 360px)');
  const [stats,    setStats]    = useState({ users: 0, bins: 0, bottles: 0 });
  const [users,    setUsers]    = useState([]);
  const [chartData,setChartData]= useState([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshed,setRefreshed]= useState(false);

  useEffect(() => {
    // Live users stream — same as _firestoreService.allUsersStream()
    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), orderBy('totalBottles', 'desc')),
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        let totalBottles = 0;
        list.forEach(u => { totalBottles += u.totalBottles || 0; });
        setStats(s => ({ ...s, users: snap.size, bottles: totalBottles }));
        setUsers(list);
        setChartData(list.slice(0, 8).map(u => ({
          name:    (u.name || u.email || 'User').split(' ')[0].slice(0, 8),
          bottles: u.totalBottles || 0,
          points:  u.totalPoints  || 0,
        })));
        setLoading(false);
      }
    );

    // Bins count
    getDocs(collection(db, 'bins'))
      .then(s => setStats(prev => ({ ...prev, bins: s.size })));

    return unsubUsers;
  }, []);

  const handleRefresh = () => {
    setLoading(true);
    getDocs(collection(db, 'bins')).then(s => {
      setStats(p => ({ ...p, bins: s.size }));
      setLoading(false);
      setRefreshed(true);
      setTimeout(() => setRefreshed(false), 1500);
    });
  };

  return (
    <div>
      {/* Header */}
      <div style={{ ...s.pageHeader, ...(isMobile ? s.pageHeaderMobile : {}) }}>
        <div>
          <h1 style={{ ...s.h1, ...(isMobile ? s.h1Mobile : {}), ...(isTinyMobile ? s.h1Tiny : {}) }}>Admin Dashboard</h1>
          <p style={s.sub}>Live system statistics</p>
        </div>
        <button onClick={handleRefresh} style={{ ...s.refreshBtn, ...(isMobile ? s.refreshBtnMobile : {}), ...(isTinyMobile ? s.refreshBtnTiny : {}) }}>
          {refreshed ? '✓ Refreshed' : '↻ Refresh'}
        </button>
      </div>

      {loading ? <Loader /> : <>

        {/* ── System Statistics ──────────────────────────────────────── */}
        <Section title="System Statistics" icon="📈">
          <div style={{ ...s.statGrid, ...(isMobile ? s.statGridMobile : {}) }}>
            <StatCard label="Total Users"            value={stats.users}   icon="👥" color="#1565C0" />
            <StatCard label="Total Bins"             value={stats.bins}    icon="🗑️" color="#2E7D32" />
            <StatCard label="Total Bottles Recycled" value={stats.bottles} icon="♻️" color="#F57F17" wide />
          </div>
        </Section>

        {/* ── Bar chart ─────────────────────────────────────────────── */}
        <Section title="Top Recyclers" icon="🏆">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" fontSize={11} tick={{ fill: '#666' }} />
              <YAxis fontSize={11} tick={{ fill: '#666' }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, fontSize: 13 }}
                formatter={(v, n) => [v, n === 'bottles' ? 'Bottles' : 'Points']} />
              <Bar dataKey="bottles" fill="#2E7D32" radius={[4, 4, 0, 0]} name="bottles" />
              <Bar dataKey="points"  fill="#1565C0" radius={[4, 4, 0, 0]} name="points" />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        {/* ── Admin Actions ──────────────────────────────────────────── */}
        <Section title="Admin Actions" icon="⚙️">
          <div style={{ ...s.actionGrid, ...(isMobile ? s.actionGridMobile : {}) }}>
            <ActionCard
              to="/bins"
              icon="📍"
              color="#2E7D32"
              title="Manage Bins"
              desc="Add, edit, or remove recycling bin locations" />
            <ActionCard
              to="/rewards"
              icon="⭐"
              color="#1565C0"
              title="Manage Rewards"
              desc="Configure reward points and tiers" />
          </div>
        </Section>

        {/* ── User Points and Bottles ────────────────────────────────── */}
        <Section title="User Points and Bottles" icon="👥">
          {isMobile ? (
            <div style={s.mobileUserList}>
              {users.map(u => (
                <UserSummaryCard key={u.id} user={u} />
              ))}
            </div>
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr style={{ background: '#F1F8E9' }}>
                    {['User', 'Email', 'Bottles', 'Points', 'Admin'].map(h => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={s.tr}>
                      <td style={s.td}>
                        <div style={s.userRow}>
                          <div style={s.avatar}>{(u.name || u.email || '?')[0].toUpperCase()}</div>
                          <span style={{ fontWeight: 600, color: '#222' }}>{u.name || '—'}</span>
                        </div>
                      </td>
                      <td style={{ ...s.td, color: '#666', fontSize: 13 }}>{u.email}</td>
                      <td style={{ ...s.td, fontWeight: 700, color: '#2E7D32', textAlign: 'center' }}>
                        {u.totalBottles || 0}
                      </td>
                      <td style={{ ...s.td, fontWeight: 700, color: '#F57F17', textAlign: 'center' }}>
                        {u.totalPoints || 0}
                      </td>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        {u.isAdmin
                          ? <Badge color="#1565C0" bg="#E3F2FD">Admin</Badge>
                          : <Badge color="#666" bg="#F5F5F5">User</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </>}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Section({ title, icon, children }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  return (
    <div style={{ ...s.section, ...(isMobile ? s.sectionMobile : {}) }}>
      <h2 style={{ ...s.sectionTitle, ...(isMobile ? s.sectionTitleMobile : {}) }}>{icon} {title}</h2>
      {children}
    </div>
  );
}

function StatCard({ label, value, icon, color, wide }) {
  return (
    <div style={{ ...s.statCard, gridColumn: wide ? '1 / -1' : 'auto', borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: 36, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 38, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, color: '#666', marginTop: 6, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

function ActionCard({ to, icon, color, title, desc }) {
  return (
    <Link to={to} style={{ ...s.actionCard, textDecoration: 'none' }}>
      <div style={{ ...s.actionIcon, background: color + '18', color }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={s.actionTitle}>{title}</div>
        <div style={s.actionDesc}>{desc}</div>
      </div>
      <span style={{ color: '#ccc', fontSize: 20 }}>›</span>
    </Link>
  );
}

function Badge({ children, color, bg }) {
  return (
    <span style={{ background: bg, color, padding: '3px 9px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
      {children}
    </span>
  );
}

function UserSummaryCard({ user }) {
  return (
    <div style={s.mobileUserCard}>
      <div style={s.userRow}>
        <div style={s.avatar}>{(user.name || user.email || '?')[0].toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={s.mobileUserName}>{user.name || '—'}</div>
          <div style={s.mobileUserEmail}>{user.email || 'No email'}</div>
        </div>
      </div>

      <div style={s.mobileUserStats}>
        <div style={s.mobileStatTile}>
          <div style={s.mobileStatLabel}>Bottles</div>
          <div style={{ ...s.mobileStatValue, color: '#2E7D32' }}>{user.totalBottles || 0}</div>
        </div>
        <div style={s.mobileStatTile}>
          <div style={s.mobileStatLabel}>Points</div>
          <div style={{ ...s.mobileStatValue, color: '#F57F17' }}>{user.totalPoints || 0}</div>
        </div>
        <div style={s.mobileRoleWrap}>
          {user.isAdmin
            ? <Badge color="#1565C0" bg="#E3F2FD">Admin</Badge>
            : <Badge color="#666" bg="#F5F5F5">User</Badge>}
        </div>
      </div>
    </div>
  );
}

function Loader() {
  return <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading…</div>;
}

const s = {
  pageHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  pageHeaderMobile: { flexDirection: 'column', gap: 10, marginBottom: 16 },
  h1:         { margin: 0, fontSize: 28, fontWeight: 800, color: '#1B5E20' },
  h1Mobile:   { fontSize: 24 },
  h1Tiny:     { fontSize: 21 },
  sub:        { margin: '4px 0 0', color: '#888', fontSize: 14 },
  refreshBtn: { padding: '8px 18px', background: '#fff', border: '1.5px solid #ddd', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#444' },
  refreshBtnMobile: { width: '100%' },
  refreshBtnTiny: { fontSize: 12, padding: '8px 12px' },
  section:    { background: '#fff', borderRadius: 14, padding: '22px 24px', marginBottom: 20, boxShadow: '0 2px 10px rgba(0,0,0,.06)' },
  sectionMobile: { padding: '16px 14px', marginBottom: 14, borderRadius: 12 },
  sectionTitle:{ margin: '0 0 18px', fontSize: 18, fontWeight: 700, color: '#222' },
  sectionTitleMobile: { fontSize: 16, marginBottom: 14 },
  statGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  statGridMobile: { gridTemplateColumns: '1fr', gap: 10 },
  statCard:   { background: '#FAFAFA', borderRadius: 12, padding: '20px 16px', textAlign: 'center', border: '1px solid #eee' },
  actionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  actionGridMobile: { gridTemplateColumns: '1fr', gap: 10 },
  actionCard: { display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', border: '1.5px solid #eee', borderRadius: 12, background: '#FAFAFA', transition: 'box-shadow .15s', cursor: 'pointer' },
  actionIcon: { width: 52, height: 52, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 },
  actionTitle:{ fontWeight: 700, fontSize: 15, color: '#222', marginBottom: 3 },
  actionDesc: { fontSize: 13, color: '#777' },
  mobileUserList: { display: 'flex', flexDirection: 'column', gap: 10 },
  mobileUserCard: { background: '#FAFAFA', border: '1px solid #eee', borderRadius: 10, padding: '12px 10px' },
  mobileUserName: { fontSize: 14, fontWeight: 700, color: '#222', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  mobileUserEmail: { fontSize: 12, color: '#6f7d88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 },
  mobileUserStats: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 10, alignItems: 'end' },
  mobileStatTile: { background: '#fff', border: '1px solid #edf1f4', borderRadius: 8, padding: '8px 6px' },
  mobileStatLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: .4, color: '#8897a3', marginBottom: 4 },
  mobileStatValue: { fontSize: 17, fontWeight: 800, lineHeight: 1 },
  mobileRoleWrap: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center' },
  tableWrap:  { overflowX: 'auto', borderRadius: 10, border: '1px solid #eee' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  tableMobile:{ minWidth: 760, fontSize: 13 },
  th:         { padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#2E7D32', fontSize: 12, textTransform: 'uppercase', letterSpacing: .4, borderBottom: '2px solid #E8F5E9' },
  tr:         { borderBottom: '1px solid #F5F5F5' },
  td:         { padding: '12px 16px', verticalAlign: 'middle' },
  userRow:    { display: 'flex', alignItems: 'center', gap: 10 },
  avatar:     { width: 32, height: 32, borderRadius: '50%', background: '#C8E6C9', color: '#2E7D32', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 },
};
