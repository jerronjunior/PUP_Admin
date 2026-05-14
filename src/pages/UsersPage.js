// src/pages/UsersPage.js
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import useMediaQuery from '../hooks/useMediaQuery';

export default function UsersPage() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isTinyMobile = useMediaQuery('(max-width: 360px)');
  const [users,   setUsers]   = useState([]);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editVal, setEditVal] = useState({ pts: '', bottles: '' });

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'users'), orderBy('totalBottles', 'desc')),
      snap => { setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); }
    );
  }, []);

  const filtered = users.filter(u =>
    (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const startEdit = u => {
    setEditing(u.id);
    setEditVal({ pts: String(u.totalPoints || 0), bottles: String(u.totalBottles || 0) });
  };

  const saveEdit = async uid => {
    await updateDoc(doc(db, 'users', uid), {
      totalPoints:  parseInt(editVal.pts, 10)     || 0,
      totalBottles: parseInt(editVal.bottles, 10) || 0,
    });
    setEditing(null);
  };

  const handleDelete = async uid => {
    if (!window.confirm('Delete this user permanently?')) return;
    await deleteDoc(doc(db, 'users', uid));
  };

  return (
    <div>
      <div style={{ ...s.pageHeader, ...(isMobile ? s.pageHeaderMobile : {}) }}>
        <div>
          <h1 style={{ ...s.h1, ...(isMobile ? s.h1Mobile : {}), ...(isTinyMobile ? s.h1Tiny : {}) }}>Users & Points</h1>
          <p style={s.sub}>{users.length} registered users</p>
        </div>
      </div>

      <input style={s.search} placeholder="🔍  Search by name or email…"
        value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading…</div> : (
        isMobile ? (
          <div style={s.mobileList}>
            {filtered.map(u => (
              <div key={u.id} style={s.mobileCard}>
                <div style={s.userRow}>
                  <div style={s.avatar}>{(u.name || u.email || '?')[0].toUpperCase()}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={s.mobileUserName}>{u.name || '—'}</div>
                    <div style={s.mobileUserEmail}>{u.email || 'No email'}</div>
                    <div style={s.mobileUserPhone}>{u.mobile || 'No mobile'}</div>
                  </div>
                  <div>
                    {u.isAdmin
                      ? <span style={s.adminBadge}>Admin</span>
                      : <span style={s.userBadge}>User</span>}
                  </div>
                </div>

                <div style={s.mobileStatsRow}>
                  <div style={s.mobileStatBox}>
                    <div style={s.mobileStatLabel}>Bottles</div>
                    {editing === u.id
                      ? <input style={s.editInputMobile} type="number" value={editVal.bottles}
                          onChange={e => setEditVal(v => ({ ...v, bottles: e.target.value }))} />
                      : <span style={{ fontWeight: 800, color: '#2E7D32', fontSize: 18 }}>{u.totalBottles || 0}</span>}
                  </div>
                  <div style={s.mobileStatBox}>
                    <div style={s.mobileStatLabel}>Points</div>
                    {editing === u.id
                      ? <input style={s.editInputMobile} type="number" value={editVal.pts}
                          onChange={e => setEditVal(v => ({ ...v, pts: e.target.value }))} />
                      : <span style={{ fontWeight: 800, color: '#F57F17', fontSize: 18 }}>{u.totalPoints || 0}</span>}
                  </div>
                </div>

                <div style={s.mobileActionRow}>
                  {editing === u.id ? (
                    <>
                      <button onClick={() => saveEdit(u.id)} style={s.saveBtnWide}>Save</button>
                      <button onClick={() => setEditing(null)} style={s.cancelBtnWide}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(u)} style={s.editBtnWide}>Edit</button>
                      <button onClick={() => handleDelete(u.id)} style={s.delBtnWide}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr style={{ background: '#F1F8E9' }}>
                  {['User', 'Email', 'Mobile', 'Bottles', 'Points', 'Role', 'Actions'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} style={s.tr}>
                    <td style={s.td}>
                      <div style={s.userRow}>
                        <div style={s.avatar}>{(u.name || u.email || '?')[0].toUpperCase()}</div>
                        <span style={{ fontWeight: 700, color: '#222' }}>{u.name || '—'}</span>
                      </div>
                    </td>
                    <td style={{ ...s.td, color: '#555', fontSize: 13 }}>{u.email}</td>
                    <td style={{ ...s.td, color: '#777', fontSize: 13 }}>{u.mobile || '—'}</td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      {editing === u.id
                        ? <input style={s.editInput} type="number" value={editVal.bottles}
                            onChange={e => setEditVal(v => ({ ...v, bottles: e.target.value }))} />
                        : <span style={{ fontWeight: 700, color: '#2E7D32', fontSize: 16 }}>{u.totalBottles || 0}</span>}
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      {editing === u.id
                        ? <input style={s.editInput} type="number" value={editVal.pts}
                            onChange={e => setEditVal(v => ({ ...v, pts: e.target.value }))} />
                        : <span style={{ fontWeight: 700, color: '#F57F17', fontSize: 16 }}>{u.totalPoints || 0}</span>}
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      {u.isAdmin
                        ? <span style={s.adminBadge}>Admin</span>
                        : <span style={s.userBadge}>User</span>}
                    </td>
                    <td style={{ ...s.td }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {editing === u.id ? (
                          <>
                            <button onClick={() => saveEdit(u.id)} style={s.saveBtn}>✓</button>
                            <button onClick={() => setEditing(null)} style={s.cancelBtn}>✕</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(u)} style={s.editBtn}>✏️</button>
                            <button onClick={() => handleDelete(u.id)} style={s.delBtn}>🗑️</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

const s = {
  pageHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  pageHeaderMobile: { marginBottom: 14 },
  h1:         { margin: 0, fontSize: 28, fontWeight: 800, color: '#1B5E20' },
  h1Mobile:   { fontSize: 24 },
  h1Tiny:     { fontSize: 21 },
  sub:        { margin: '4px 0 0', color: '#888', fontSize: 14 },
  search:     { width: '100%', padding: '11px 16px', borderRadius: 11, border: '1.5px solid #ddd', fontSize: 14, marginBottom: 16, boxSizing: 'border-box', outline: 'none' },
  mobileList: { display: 'flex', flexDirection: 'column', gap: 10 },
  mobileCard: { background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.06)', padding: '12px 10px', border: '1px solid #eef1f4' },
  mobileUserName: { fontSize: 14, fontWeight: 700, color: '#222', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  mobileUserEmail: { marginTop: 2, color: '#555', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  mobileUserPhone: { marginTop: 3, color: '#7c8a94', fontSize: 12 },
  mobileStatsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 },
  mobileStatBox: { background: '#f9fbfc', border: '1px solid #edf1f4', borderRadius: 8, padding: '8px 8px' },
  mobileStatLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: .4, color: '#8897a3', marginBottom: 5 },
  mobileActionRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 },
  tableWrap:  { background: '#fff', borderRadius: 14, boxShadow: '0 2px 10px rgba(0,0,0,.06)', overflowX: 'auto' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  tableMobile:{ minWidth: 940, fontSize: 13 },
  th:         { padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#2E7D32', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5, borderBottom: '2px solid #E8F5E9' },
  tr:         { borderBottom: '1px solid #F9F9F9', transition: 'background .1s' },
  td:         { padding: '12px 16px', verticalAlign: 'middle' },
  userRow:    { display: 'flex', alignItems: 'center', gap: 10 },
  avatar:     { width: 34, height: 34, borderRadius: '50%', background: '#C8E6C9', color: '#2E7D32', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 },
  adminBadge: { background: '#E3F2FD', color: '#1565C0', padding: '3px 9px', borderRadius: 8, fontSize: 11, fontWeight: 700 },
  userBadge:  { background: '#F5F5F5', color: '#777', padding: '3px 9px', borderRadius: 8, fontSize: 11 },
  editInput:  { width: 70, padding: '5px 8px', borderRadius: 7, border: '1.5px solid #2E7D32', fontSize: 14, fontWeight: 700, textAlign: 'center', outline: 'none' },
  editInputMobile:{ width: '100%', padding: '6px 8px', borderRadius: 7, border: '1.5px solid #2E7D32', fontSize: 15, fontWeight: 700, textAlign: 'center', outline: 'none' },
  saveBtn:    { padding: '6px 12px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 700 },
  saveBtnWide:{ padding: '8px 12px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 },
  cancelBtn:  { padding: '6px 10px', background: '#eee', color: '#555', border: 'none', borderRadius: 7, cursor: 'pointer' },
  cancelBtnWide:{ padding: '8px 12px', background: '#eceff1', color: '#56606a', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 },
  editBtn:    { padding: '6px 10px', background: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13 },
  editBtnWide:{ padding: '8px 12px', background: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 },
  delBtn:     { padding: '6px 10px', background: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13 },
  delBtnWide:{ padding: '8px 12px', background: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 },
};
