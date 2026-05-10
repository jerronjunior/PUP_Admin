// src/pages/UsersPage.js
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';

export default function UsersPage() {
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
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.h1}>Users & Points</h1>
          <p style={s.sub}>{users.length} registered users</p>
        </div>
      </div>

      <input style={s.search} placeholder="🔍  Search by name or email…"
        value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading…</div> : (
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
      )}
    </div>
  );
}

const s = {
  pageHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  h1:         { margin: 0, fontSize: 28, fontWeight: 800, color: '#1B5E20' },
  sub:        { margin: '4px 0 0', color: '#888', fontSize: 14 },
  search:     { width: '100%', padding: '11px 16px', borderRadius: 11, border: '1.5px solid #ddd', fontSize: 14, marginBottom: 16, boxSizing: 'border-box', outline: 'none' },
  tableWrap:  { background: '#fff', borderRadius: 14, boxShadow: '0 2px 10px rgba(0,0,0,.06)', overflowX: 'auto' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th:         { padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#2E7D32', fontSize: 11, textTransform: 'uppercase', letterSpacing: .5, borderBottom: '2px solid #E8F5E9' },
  tr:         { borderBottom: '1px solid #F9F9F9', transition: 'background .1s' },
  td:         { padding: '12px 16px', verticalAlign: 'middle' },
  userRow:    { display: 'flex', alignItems: 'center', gap: 10 },
  avatar:     { width: 34, height: 34, borderRadius: '50%', background: '#C8E6C9', color: '#2E7D32', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 },
  adminBadge: { background: '#E3F2FD', color: '#1565C0', padding: '3px 9px', borderRadius: 8, fontSize: 11, fontWeight: 700 },
  userBadge:  { background: '#F5F5F5', color: '#777', padding: '3px 9px', borderRadius: 8, fontSize: 11 },
  editInput:  { width: 70, padding: '5px 8px', borderRadius: 7, border: '1.5px solid #2E7D32', fontSize: 14, fontWeight: 700, textAlign: 'center', outline: 'none' },
  saveBtn:    { padding: '6px 12px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 700 },
  cancelBtn:  { padding: '6px 10px', background: '#eee', color: '#555', border: 'none', borderRadius: 7, cursor: 'pointer' },
  editBtn:    { padding: '6px 10px', background: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13 },
  delBtn:     { padding: '6px 10px', background: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13 },
};
