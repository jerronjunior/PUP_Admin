// src/pages/RedemptionsPage.js
// Admin page for the redemption feature.
//   Requests tab – reload requests to top up, voucher code verification,
//                  reject-with-refund
//   Catalog tab  – add / edit / hide / delete the rewards users can redeem
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, query, orderBy, limit, doc, addDoc, updateDoc,
  deleteDoc, runTransaction, serverTimestamp, increment, writeBatch,
} from 'firebase/firestore';

const BLANK = {
  title: '', description: '', category: 'voucher', pointsCost: 100,
  valueLabel: '', partnerName: '', emoji: '🍦', expiryDays: 30,
  sortOrder: 10, active: true,
};

// Starter catalog — costs are examples; edit them to match what 1 point is worth.
const SAMPLES = [
  { title: 'Rs. 50 Mobile Reload',  category: 'reload',  pointsCost: 100, valueLabel: 'Rs. 50',  emoji: '📱', sortOrder: 1,  description: 'Airtime top-up for Dialog, Mobitel, Hutch or Airtel.' },
  { title: 'Rs. 100 Mobile Reload', category: 'reload',  pointsCost: 200, valueLabel: 'Rs. 100', emoji: '📱', sortOrder: 2,  description: 'Airtime top-up for Dialog, Mobitel, Hutch or Airtel.' },
  { title: 'Rs. 200 Mobile Reload', category: 'reload',  pointsCost: 400, valueLabel: 'Rs. 200', emoji: '📱', sortOrder: 3,  description: 'Airtime top-up for Dialog, Mobitel, Hutch or Airtel.' },
  { title: 'Ice Cream Cone',        category: 'voucher', pointsCost: 80,  valueLabel: '1 cone',  emoji: '🍦', sortOrder: 10, partnerName: 'Partner Ice Cream Shop', description: 'Show your code at the counter.' },
  { title: 'Ice Cream Cup',         category: 'voucher', pointsCost: 120, valueLabel: '1 cup',   emoji: '🍨', sortOrder: 11, partnerName: 'Partner Ice Cream Shop', description: 'Show your code at the counter.' },
].map(s => ({ partnerName: '', expiryDays: 30, active: true, ...s }));

const asDate = value => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const when = ts => {
  const date = asDate(ts);
  return date ? date.toLocaleString() : '—';
};

export default function RedemptionsPage() {
  const [tab, setTab]       = useState('requests');
  const [reds, setReds]     = useState([]);
  const [items, setItems]   = useState([]);
  const [err, setErr]       = useState('');
  const [msg, setMsg]       = useState('');
  const [filter, setFilter] = useState('open');
  const [code, setCode]     = useState('');
  const [form, setForm]     = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy]     = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, 'redemptions'), orderBy('createdAt', 'desc'), limit(300)),
      s => setReds(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => setErr('Could not load redemptions: ' + e.message));
    const u2 = onSnapshot(
      collection(db, 'redemption_items'),
      s => setItems(s.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))),
      e => setErr('Could not load catalog: ' + e.message));
    return () => { u1(); u2(); };
  }, []);

  const flash = m => { setMsg(m); setTimeout(() => setMsg(''), 3500); };

  // ── Request actions ──────────────────────────────────────────────────────
  const setStatus = async (r, status) => {
    setBusy(true); setErr('');
    try {
      await updateDoc(doc(db, 'redemptions', r.id),
        { status, completedAt: serverTimestamp() });
      flash(`Marked ${status}.`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  // Reject + give the points back, atomically and only once.
  const rejectAndRefund = async r => {
    if (!window.confirm(`Reject and refund ${r.pointsSpent} points to ${r.userName || r.userId}?`)) return;
    setBusy(true); setErr('');
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, 'redemptions', r.id);
        const snap = await tx.get(ref);
        const st = snap.data().status;
        if (st !== 'pending' && st !== 'active') throw new Error('Already ' + st + ' — no refund made.');
        tx.update(ref, { status: 'rejected', completedAt: serverTimestamp() });
        tx.update(doc(db, 'users', r.userId), { totalPoints: increment(r.pointsSpent) });
      });
      flash('Rejected and points refunded.');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const found = useMemo(() => {
    const c = code.trim().toUpperCase();
    return c ? reds.find(r => (r.code || '').toUpperCase() === c) : null;
  }, [code, reds]);

  const rows = useMemo(() => reds.filter(r => {
    if (filter === 'open') return r.status === 'pending' || r.status === 'active';
    if (filter === 'all')  return true;
    return r.status === filter;
  }), [reds, filter]);

  // ── Catalog actions ──────────────────────────────────────────────────────
  const save = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    const data = {
      ...form,
      pointsCost: Number(form.pointsCost) || 0,
      expiryDays: Number(form.expiryDays) || 30,
      sortOrder:  Number(form.sortOrder)  || 0,
    };
    if (data.pointsCost <= 0) { setErr('Points cost must be greater than 0.'); setBusy(false); return; }
    try {
      if (editId) await updateDoc(doc(db, 'redemption_items', editId), data);
      else        await addDoc(collection(db, 'redemption_items'), { ...data, createdAt: serverTimestamp() });
      setForm(BLANK); setEditId(null); flash('Saved.');
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };

  const seed = async () => {
    if (!window.confirm('Add 5 sample rewards (3 reloads, 2 ice creams)?')) return;
    setBusy(true);
    try {
      const b = writeBatch(db);
      SAMPLES.forEach(s => b.set(doc(collection(db, 'redemption_items')), { ...s, createdAt: serverTimestamp() }));
      await b.commit(); flash('Sample rewards added. Edit prices to suit.');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const remove = async it => {
    if (!window.confirm(`Delete "${it.title}"? Past redemptions are kept.`)) return;
    try { await deleteDoc(doc(db, 'redemption_items', it.id)); } catch (e) { setErr(e.message); }
  };

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={s.h1}>Redemptions</h1>
        <p style={s.sub}>Reload requests, shop vouchers and the rewards catalog.</p>
      </div>

      {err && <div style={s.errBox}>❌ {err}</div>}
      {msg && <div style={s.okBox}>✅ {msg}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {[['requests', '📋 Requests'], ['catalog', '🎁 Catalog']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ ...s.tab, ...(tab === k ? s.tabOn : {}) }}>{l}</button>
        ))}
      </div>

      {tab === 'requests' && (
        <>
          <div style={s.card}>
            <h3 style={s.cardTitle}>Verify a voucher code</h3>
            <input style={s.input} placeholder="PUP-XXXXXX" value={code}
              onChange={e => setCode(e.target.value)} />
            {code.trim() && !found && <p style={s.help}>No voucher with that code.</p>}
            {found && (
              <div style={s.found}>
                <div><b>{found.emoji} {found.itemTitle}</b> — {found.userName || found.userId}</div>
                <div style={s.help}>
                  Status: <b>{found.status}</b> · expires {when(found.expiresAt)}
                </div>
                        {found.status === 'active' && !(asDate(found.expiresAt) && asDate(found.expiresAt) < new Date()) ? (
                  <button disabled={busy} style={s.btnGreen}
                    onClick={() => setStatus(found, 'used')}>Mark as USED</button>
                ) : <div style={{ color: '#C62828', fontWeight: 700, marginTop: 8 }}>
                  Not valid — {found.status === 'active' ? 'expired' : 'already ' + found.status}.</div>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {['open', 'completed', 'used', 'rejected', 'all'].map(k => (
              <button key={k} onClick={() => setFilter(k)}
                style={{ ...s.chip, ...(filter === k ? s.chipOn : {}) }}>{k}</button>
            ))}
          </div>

          <div style={s.card}>
            {rows.length === 0 && <p style={s.help}>Nothing here.</p>}
            {rows.map(r => (
              <div key={r.id} style={s.row}>
                <div style={{ fontSize: 26 }}>{r.emoji || '🎁'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{r.itemTitle}
                    <span style={{ ...s.badge, ...badgeColor(r.status) }}>{r.status}</span></div>
                  <div style={s.help}>
                    {r.userName || r.userId} · {r.pointsSpent} pts · {when(r.createdAt)}
                  </div>
                  {r.category === 'reload' && (
                    <div style={{ marginTop: 4, fontSize: 15 }}>
                      📞 <b>{r.phone}</b> ({r.operator})
                    </div>
                  )}
                  {r.code && <div style={{ marginTop: 4, fontFamily: 'monospace', fontWeight: 800, letterSpacing: 2 }}>{r.code}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {r.status === 'pending' && (
                    <button disabled={busy} style={s.btnGreen}
                      onClick={() => setStatus(r, 'completed')}>Reload done</button>)}
                  {r.status === 'active' && (
                    <button disabled={busy} style={s.btnGreen}
                      onClick={() => setStatus(r, 'used')}>Mark used</button>)}
                  {(r.status === 'pending' || r.status === 'active') && (
                    <button disabled={busy} style={s.btnRed}
                      onClick={() => rejectAndRefund(r)}>Reject + refund</button>)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'catalog' && (
        <>
          <form onSubmit={save} style={s.card}>
            <h3 style={s.cardTitle}>{editId ? 'Edit reward' : 'Add reward'}</h3>
            <div style={s.grid}>
              <label style={s.lbl}>Title
                <input style={s.input} required value={form.title} onChange={e => f('title', e.target.value)} /></label>
              <label style={s.lbl}>Type
                <select style={s.input} value={form.category} onChange={e => f('category', e.target.value)}>
                  <option value="voucher">Shop voucher</option>
                  <option value="reload">Mobile reload</option>
                </select></label>
              <label style={s.lbl}>Points cost
                <input style={s.input} type="number" min="1" value={form.pointsCost} onChange={e => f('pointsCost', e.target.value)} /></label>
              <label style={s.lbl}>Emoji
                <input style={s.input} value={form.emoji} onChange={e => f('emoji', e.target.value)} /></label>
              <label style={s.lbl}>Value label
                <input style={s.input} placeholder="Rs. 100 / 1 cone" value={form.valueLabel} onChange={e => f('valueLabel', e.target.value)} /></label>
              <label style={s.lbl}>Shop / partner name
                <input style={s.input} value={form.partnerName} onChange={e => f('partnerName', e.target.value)} /></label>
              <label style={s.lbl}>Voucher valid (days)
                <input style={s.input} type="number" min="1" value={form.expiryDays} onChange={e => f('expiryDays', e.target.value)} /></label>
              <label style={s.lbl}>Sort order
                <input style={s.input} type="number" value={form.sortOrder} onChange={e => f('sortOrder', e.target.value)} /></label>
            </div>
            <label style={s.lbl}>Description
              <input style={s.input} value={form.description} onChange={e => f('description', e.target.value)} /></label>
            <label style={{ ...s.lbl, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={!!form.active} onChange={e => f('active', e.target.checked)} />
              Visible in the app</label>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button disabled={busy} style={s.btnGreen} type="submit">{editId ? 'Update' : 'Add reward'}</button>
              {editId && <button type="button" style={s.btnGrey}
                onClick={() => { setEditId(null); setForm(BLANK); }}>Cancel</button>}
            </div>
          </form>

          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={s.cardTitle}>Current rewards ({items.length})</h3>
              {items.length === 0 && <button style={s.btnGrey} disabled={busy} onClick={seed}>Add sample rewards</button>}
            </div>
            {items.map(it => (
              <div key={it.id} style={{ ...s.row, opacity: it.active ? 1 : 0.5 }}>
                <div style={{ fontSize: 26 }}>{it.emoji}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{it.title}
                    <span style={{ ...s.badge, background: '#E8F5E9', color: '#2E7D32' }}>{it.category}</span></div>
                  <div style={s.help}>{it.pointsCost} pts {it.partnerName ? '· ' + it.partnerName : ''} {it.active ? '' : '· hidden'}</div>
                </div>
                <button style={s.btnGrey} onClick={() => { setEditId(it.id); setForm({ ...BLANK, ...it }); window.scrollTo(0, 0); }}>Edit</button>
                <button style={s.btnGrey} onClick={() => updateDoc(doc(db, 'redemption_items', it.id), { active: !it.active })}>
                  {it.active ? 'Hide' : 'Show'}</button>
                <button style={s.btnRed} onClick={() => remove(it)}>Delete</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const badgeColor = st => ({
  pending:   { background: '#FFF3E0', color: '#EF6C00' },
  active:    { background: '#E8F5E9', color: '#2E7D32' },
  completed: { background: '#E3F2FD', color: '#1565C0' },
  used:      { background: '#EEEEEE', color: '#616161' },
  rejected:  { background: '#FFEBEE', color: '#C62828' },
}[st] || { background: '#EEE', color: '#555' });

const s = {
  h1:   { margin: '0 0 4px', fontSize: 28, fontWeight: 800, color: '#1B5E20' },
  sub:  { margin: 0, color: '#888', fontSize: 14 },
  errBox: { background: '#FFEBEE', color: '#C62828', padding: '12px 16px', borderRadius: 10, fontSize: 13, marginBottom: 18, fontWeight: 600 },
  okBox:  { background: '#E8F5E9', color: '#2E7D32', padding: '12px 16px', borderRadius: 10, fontSize: 13, marginBottom: 18, fontWeight: 700 },
  card: { background: '#fff', borderRadius: 14, padding: '22px 24px', marginBottom: 18, boxShadow: '0 2px 10px rgba(0,0,0,.06)' },
  cardTitle: { margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#222' },
  tab:  { padding: '10px 20px', border: '1px solid #ddd', borderRadius: 10, background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 },
  tabOn:{ background: '#2E7D32', color: '#fff', borderColor: '#2E7D32' },
  chip: { padding: '6px 14px', border: '1px solid #ddd', borderRadius: 20, background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textTransform: 'capitalize' },
  chipOn: { background: '#1B5E20', color: '#fff', borderColor: '#1B5E20' },
  input: { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1.5px solid #ddd', fontSize: 14, boxSizing: 'border-box', marginTop: 4 },
  lbl:  { display: 'block', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 },
  help: { fontSize: 12, color: '#888', marginTop: 3 },
  found:{ background: '#F1F8E9', borderRadius: 10, padding: 14, marginTop: 12, border: '1px solid #C8E6C9' },
  row:  { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid #f2f2f2' },
  badge:{ marginLeft: 8, padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' },
  btnGreen: { padding: '9px 18px', background: 'linear-gradient(135deg,#2E7D32,#388E3C)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, cursor: 'pointer', fontSize: 13, marginTop: 6 },
  btnRed:   { padding: '9px 14px', background: '#fff', color: '#C62828', border: '1px solid #EF9A9A', borderRadius: 9, fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  btnGrey:  { padding: '9px 14px', background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 9, fontWeight: 600, cursor: 'pointer', fontSize: 13 },
};
