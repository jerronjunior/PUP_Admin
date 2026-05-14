// src/pages/NotificationsPage.js
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, addDoc, getDocs,
  serverTimestamp, query, orderBy, limit
} from 'firebase/firestore';
import useMediaQuery from '../hooks/useMediaQuery';

export default function NotificationsPage() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [history,  setHistory]  = useState([]);
  const [users,    setUsers]    = useState([]);
  const [form,     setForm]     = useState({ title: '', subtitle: '', target: 'all', userId: '' });
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'admin_notifications'), orderBy('createdAt', 'desc'), limit(25)),
      snap => setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    getDocs(collection(db, 'users'))
      .then(snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, []);

  const handleSend = async e => {
    e.preventDefault();
    if (!form.title) return;
    setSending(true);
    try {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const payload = {
        userId: '', title: form.title, subtitle: form.subtitle,
        time, icon: 'notifications', color: '0xFF2E7D32',
        isRead: false, createdAt: serverTimestamp(),
      };

      if (form.target === 'all') {
        const snap = await getDocs(collection(db, 'users'));
        await Promise.all(snap.docs.map(d =>
          addDoc(collection(db, 'notifications'), { ...payload, userId: d.id })
        ));
      } else if (form.userId) {
        await addDoc(collection(db, 'notifications'), { ...payload, userId: form.userId });
      }

      await addDoc(collection(db, 'admin_notifications'), {
        title: form.title, subtitle: form.subtitle, time,
        icon: 'send', color: '0xFF1565C0', isRead: false,
        type: 'broadcast',
        sentTo: form.target === 'all' ? 'All users' : (users.find(u => u.id === form.userId)?.name || form.userId),
        createdAt: serverTimestamp(),
      });

      setForm(f => ({ ...f, title: '', subtitle: '' }));
      setSent(true);
      setTimeout(() => setSent(false), 2500);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h1 style={{ ...s.h1, ...(isMobile ? s.h1Mobile : {}) }}>Notifications</h1>
      <p style={s.sub}>Send announcements or alerts to users</p>

      {/* Send form */}
      <div style={s.card}>
        <h3 style={s.cardTitle}>📤 Send Notification</h3>
        <form onSubmit={handleSend}>
          <div style={{ ...s.grid2, ...(isMobile ? s.grid2Mobile : {}) }}>
            <div>
              <label style={s.label}>Title *</label>
              <input style={s.input} required placeholder="e.g. New reward available!"
                value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>Message</label>
              <input style={s.input} placeholder="e.g. Spin the wheel to win big!"
                value={form.subtitle} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} />
            </div>
          </div>
          <div style={{ ...s.grid2, ...(isMobile ? s.grid2Mobile : {}) }}>
            <div>
              <label style={s.label}>Send to</label>
              <select style={s.input} value={form.target}
                onChange={e => setForm(f => ({ ...f, target: e.target.value }))}>
                <option value="all">👥 All users</option>
                <option value="user">👤 Specific user</option>
              </select>
            </div>
            {form.target === 'user' && (
              <div>
                <label style={s.label}>Select user</label>
                <select style={s.input} value={form.userId}
                  onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}>
                  <option value="">— select —</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button type="submit" style={{ ...s.sendBtn, ...(isMobile ? s.sendBtnMobile : {}) }} disabled={sending}>
            {sent ? '✓ Sent!' : sending ? 'Sending…' : '📤 Send Notification'}
          </button>
        </form>
      </div>

      {/* History */}
      <h3 style={s.histTitle}>Recent Notifications</h3>
      <div style={s.histCard}>
        {history.length === 0
          ? <div style={{ textAlign: 'center', padding: '30px', color: '#aaa' }}>No notifications sent yet</div>
          : history.map(n => (
            <div key={n.id} style={{ ...s.histItem, ...(isMobile ? s.histItemMobile : {}) }}>
              <div style={s.histIconWrap}>🔔</div>
              <div style={{ flex: 1 }}>
                <div style={s.histTitle}>{n.title}</div>
                {n.subtitle && <div style={s.histSub}>{n.subtitle}</div>}
              </div>
              <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                <div style={s.histTarget}>→ {n.sentTo || 'All'}</div>
                <div style={s.histTime}>{n.time}</div>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

const s = {
  h1:          { margin: '0 0 4px', fontSize: 28, fontWeight: 800, color: '#1B5E20' },
  h1Mobile:    { fontSize: 24 },
  sub:         { margin: '0 0 24px', color: '#888', fontSize: 14 },
  card:        { background: '#fff', borderRadius: 14, padding: '22px 24px', marginBottom: 24, boxShadow: '0 2px 10px rgba(0,0,0,.06)' },
  cardTitle:   { margin: '0 0 18px', fontSize: 18, fontWeight: 700, color: '#222' },
  grid2:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 },
  grid2Mobile: { gridTemplateColumns: '1fr', gap: 10 },
  label:       { display: 'block', fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 5, textTransform: 'uppercase', letterSpacing: .4 },
  input:       { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1.5px solid #ddd', fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  sendBtn:     { padding: '11px 28px', background: '#1565C0', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 6 },
  sendBtnMobile: { width: '100%' },
  histTitle:   { margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: '#222' },
  histCard:    { background: '#fff', borderRadius: 14, boxShadow: '0 2px 10px rgba(0,0,0,.06)', overflow: 'hidden' },
  histItem:    { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid #F9F9F9' },
  histItemMobile: { alignItems: 'flex-start', flexDirection: 'column', gap: 6, padding: '12px 14px' },
  histIconWrap:{ fontSize: 22, flexShrink: 0 },
  histTitle:   { fontWeight: 600, fontSize: 14, color: '#222' },
  histSub:     { fontSize: 13, color: '#777', marginTop: 2 },
  histTarget:  { fontSize: 12, color: '#2E7D32', fontWeight: 700 },
  histTime:    { fontSize: 11, color: '#aaa', marginTop: 3 },
};
