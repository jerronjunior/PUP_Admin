// src/pages/UsersPage.js
import React, { useEffect, useState } from 'react';
import { db, auth } from '../firebase';
import {
  collection, onSnapshot, doc,
  query, orderBy, getDoc
} from 'firebase/firestore';
import useMediaQuery from '../hooks/useMediaQuery';

export default function UsersPage() {
  const isMobile    = useMediaQuery('(max-width: 768px)');
  const isTinyMobile= useMediaQuery('(max-width: 360px)');

  const [users,         setUsers]         = useState([]);
  const [search,        setSearch]        = useState('');
  const [loading,       setLoading]       = useState(true);
  const [currentIsAdmin,setCurrentIsAdmin]= useState(false);
  const [toast,         setToast]         = useState('');

  // Live users stream
  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'users'), orderBy('totalBottles', 'desc')),
      snap => { setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); }
    );
  }, []);

  // Check if current logged-in user is admin
  // We check from Firestore (not just Auth) so it matches the app's isAdmin field
  useEffect(() => {
    const check = async () => {
      try {
        const u = auth.currentUser;
        if (!u) { setCurrentIsAdmin(false); return; }
        const snap = await getDoc(doc(db, 'users', u.uid));
        setCurrentIsAdmin(Boolean(snap.exists() && snap.data()?.isAdmin === true));
      } catch {
        // If Firestore check fails, fall back to allowing delete
        // (the security rules will block unauthorized deletes anyway)
        setCurrentIsAdmin(true);
      }
    };
    check();
  }, []);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(''), 3000);
  };

  const filtered = users.filter(u =>
    (u.name  || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const getUserAvatar = user => {
    const fallback = (user.name || user.email || '?')[0].toUpperCase();
    if (user.photoUrl) {
      return (
        <img
          src={user.photoUrl}
          alt={user.name || user.email || 'User'}
          style={s.avatarImage}
        />
      );
    }
    return <div style={s.avatar}>{fallback}</div>;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ ...s.pageHeader, ...(isMobile ? { marginBottom: 14 } : {}) }}>
        <div>
          <h1 style={{ margin: 0, fontSize: isTinyMobile ? 21 : isMobile ? 24 : 28, fontWeight: 800, color: '#1B5E20' }}>
            Users & Points
          </h1>
          <p style={{ margin: '4px 0 0', color: '#888', fontSize: 14 }}>
            {users.length} registered user{users.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ ...s.toast, background: toast.isError ? '#FFEBEE' : '#E8F5E9', color: toast.isError ? '#C62828' : '#2E7D32' }}>
          {toast.msg}
        </div>
      )}

      {/* Search */}
      <input style={s.search} placeholder="🔍  Search by name or email…"
        value={search} onChange={e => setSearch(e.target.value)} />

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading…</div>
      ) : isMobile ? (
        /* ── Mobile cards ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(u => (
            <div key={u.id} style={s.mobileCard}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {getUserAvatar(u)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || '—'}</div>
                  <div style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{u.mobile || 'No mobile'}</div>
                </div>
                {u.isAdmin ? <span style={s.adminBadge}>Admin</span> : <span style={s.userBadge}>User</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                <div style={s.statBox}>
                  <div style={s.statLabel}>Bottles</div>
                  <div style={{ fontWeight: 800, color: '#2E7D32', fontSize: 18 }}>{u.totalBottles || 0}</div>
                </div>
                <div style={s.statBox}>
                  <div style={s.statLabel}>Points</div>
                  <div style={{ fontWeight: 800, color: '#F57F17', fontSize: 18 }}>{u.totalPoints || 0}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── Desktop table ── */
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr style={{ background: '#F1F8E9' }}>
                {['User', 'Email', 'Mobile', 'Bottles', 'Points', 'Role'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} style={s.tr}>
                  <td style={s.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {getUserAvatar(u)}
                      <span style={{ fontWeight: 700, color: '#222' }}>{u.name || '—'}</span>
                    </div>
                  </td>
                  <td style={{ ...s.td, color: '#555', fontSize: 13 }}>{u.email}</td>
                  <td style={{ ...s.td, color: '#777', fontSize: 13 }}>{u.mobile || '—'}</td>
                  <td style={{ ...s.td, textAlign: 'center' }}>
                    <span style={{ fontWeight: 700, color: '#2E7D32', fontSize: 16 }}>{u.totalBottles || 0}</span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'center' }}>
                    <span style={{ fontWeight: 700, color: '#F57F17', fontSize: 16 }}>{u.totalPoints || 0}</span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'center' }}>
                    {u.isAdmin ? <span style={s.adminBadge}>Admin</span> : <span style={s.userBadge}>User</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#aaa' }}>
              No users match your search
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const s = {
  pageHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  search:     { width: '100%', padding: '11px 16px', borderRadius: 11, border: '1.5px solid #ddd', fontSize: 14, marginBottom: 16, boxSizing: 'border-box', outline: 'none' },
  toast:      { padding: '12px 16px', borderRadius: 9, fontSize: 14, marginBottom: 16, fontWeight: 600 },
  tableWrap:  { background: '#fff', borderRadius: 14, boxShadow: '0 2px 10px rgba(0,0,0,.06)', overflowX: 'auto' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th:         { padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#2E7D32', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5, borderBottom: '2px solid #E8F5E9' },
  tr:         { borderBottom: '1px solid #F9F9F9' },
  td:         { padding: '12px 16px', verticalAlign: 'middle' },
  avatar:     { width: 34, height: 34, borderRadius: '50%', background: '#C8E6C9', color: '#2E7D32', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 },
  avatarImage:{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid #DDE7D8', background: '#F5F7F4' },
  adminBadge: { background: '#E3F2FD', color: '#1565C0', padding: '3px 9px', borderRadius: 8, fontSize: 11, fontWeight: 700 },
  userBadge:  { background: '#F5F5F5', color: '#777', padding: '3px 9px', borderRadius: 8, fontSize: 11 },
  mobileCard: { background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.06)', padding: '14px 12px', border: '1px solid #eef1f4' },
  statBox:    { background: '#f9fbfc', border: '1px solid #edf1f4', borderRadius: 8, padding: '8px 10px' },
  statLabel:  { fontSize: 10, textTransform: 'uppercase', letterSpacing: .4, color: '#8897a3', marginBottom: 4 },
};