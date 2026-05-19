// src/pages/RewardsPage.js
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';

const DEFAULT = {
  pointsPerBottle:  1,
  spinCost:         20,
  maxBottlesPerDay: 25,
  cooldownSeconds:  20,
  wheelGifts:       ['50 pts','Badge','100 pts','Star ⭐','200 pts','Crown 👑','500 pts','Gift 🎁'],
  bronzePoints:     50,
  silverPoints:     200,
  goldPoints:       500,
};

export default function RewardsPage() {
  const [cfg,     setCfg]     = useState(null);
  const [gifts,   setGifts]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);

  // Live listener — updates instantly when Firestore changes
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'reward_config', 'default'),
      snap => {
        const d = snap.exists() ? { ...DEFAULT, ...snap.data() } : { ...DEFAULT };
        setCfg(d);
        setGifts((d.wheelGifts || []).join('\n'));
        setLoading(false);
      },
      err => {
        setError('Failed to load: ' + err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const update = (k, v) => setCfg(c => ({ ...c, [k]: v }));

  const handleSave = async e => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const parsedGifts = gifts.split('\n').map(g => g.trim()).filter(Boolean);
      if (parsedGifts.length === 0) {
        setError('Add at least one wheel prize.'); setSaving(false); return;
      }
      // Save every field explicitly — never use spread (risks missing fields)
      await setDoc(doc(db, 'reward_config', 'default'), {
        pointsPerBottle:  Number(cfg.pointsPerBottle),
        spinCost:         Number(cfg.spinCost),
        maxBottlesPerDay: Number(cfg.maxBottlesPerDay),
        cooldownSeconds:  Number(cfg.cooldownSeconds),
        bronzePoints:     Number(cfg.bronzePoints),
        silverPoints:     Number(cfg.silverPoints),
        goldPoints:       Number(cfg.goldPoints),
        wheelGifts:       parsedGifts,
        updatedAt:        serverTimestamp(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, color:'#aaa', fontSize:14 }}>
      Loading rewards config…
    </div>
  );

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={s.h1}>Manage Rewards</h1>
        <p style={s.sub}>Changes save to Firestore and update the app instantly.</p>
      </div>

      {error && <div style={s.errBox}>❌ {error}</div>}
      {saved && <div style={s.okBox}>✅ Saved! App will update automatically.</div>}

      <form onSubmit={handleSave}>

        {/* ── Recycling Rewards ─────────────────────────────────────── */}
        <Section icon="♻️" title="Recycling Rewards">
          <div style={s.grid3}>
            <NumField
              label="Points per Bottle"
              icon="⭐"
              value={cfg.pointsPerBottle}
              help="Points user earns per bottle inserted"
              onChange={v => update('pointsPerBottle', v)} />
            <NumField
              label="Max Bottles per Day"
              icon="🍾"
              value={cfg.maxBottlesPerDay}
              help="Daily limit per user"
              onChange={v => update('maxBottlesPerDay', v)} />
            <NumField
              label="Cooldown (seconds)"
              icon="⏱️"
              value={cfg.cooldownSeconds}
              help="Wait time between bottle scans"
              onChange={v => update('cooldownSeconds', v)} />
          </div>
        </Section>

        {/* ── Spin Wheel ────────────────────────────────────────────── */}
        <Section icon="🎡" title="Spin Wheel">
          <NumField
            label="Cost per Spin (points)"
            icon="💰"
            color="#F57F17"
            value={cfg.spinCost}
            help="Points a user spends to spin the wheel. Change this and the app updates immediately."
            onChange={v => update('spinCost', v)} />

          <div style={s.divider} />

          <div style={{ marginBottom: 6 }}>
            <label style={s.label}>
              🎁 Wheel Prizes
              <span style={s.hint}> — one prize per line</span>
            </label>
          </div>
          <textarea
            style={s.textarea}
            rows={9}
            value={gifts}
            onChange={e => setGifts(e.target.value)}
            placeholder={'50 pts\nBadge\n100 pts\nStar ⭐\n200 pts\nCrown 👑\n500 pts\nGift 🎁'} />

          {/* Live prize preview */}
          {gifts.split('\n').map(g => g.trim()).filter(Boolean).length > 0 && (
            <div style={s.previewBox}>
              <div style={s.previewLabel}>Preview:</div>
              <div style={s.pills}>
                {gifts.split('\n').map(g => g.trim()).filter(Boolean).map((g, i) => (
                  <span key={i} style={s.pill}>{g}</span>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ── Reward Tiers ──────────────────────────────────────────── */}
        <Section icon="🏆" title="Reward Tiers">
          <div style={s.grid3}>
            <NumField
              label="Bronze Tier"
              icon="🥉"
              color="#CD7F32"
              value={cfg.bronzePoints}
              help="Points needed for Bronze badge"
              onChange={v => update('bronzePoints', v)} />
            <NumField
              label="Silver Tier"
              icon="🥈"
              color="#9E9E9E"
              value={cfg.silverPoints}
              help="Points needed for Silver badge"
              onChange={v => update('silverPoints', v)} />
            <NumField
              label="Gold Tier"
              icon="🥇"
              color="#FFC107"
              value={cfg.goldPoints}
              help="Points needed for Gold badge"
              onChange={v => update('goldPoints', v)} />
          </div>

          {/* Tier progress visualization */}
          <div style={{ marginTop: 20, display:'flex', flexDirection:'column', gap:10 }}>
            {[
              { label:'Bronze', pts: cfg.bronzePoints, color:'#CD7F32' },
              { label:'Silver', pts: cfg.silverPoints, color:'#9E9E9E' },
              { label:'Gold',   pts: cfg.goldPoints,   color:'#FFC107' },
            ].map(t => (
              <div key={t.label} style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ width:10, height:10, borderRadius:'50%', background:t.color, flexShrink:0, display:'inline-block' }}/>
                <span style={{ width:52, fontSize:13, fontWeight:600, color:'#444' }}>{t.label}</span>
                <div style={{ flex:1, height:7, background:'#f0f0f0', borderRadius:4, overflow:'hidden' }}>
                  <div style={{
                    height:'100%', borderRadius:4, background:t.color, transition:'width .3s',
                    width: `${Math.min(100, (t.pts / (cfg.goldPoints || 1)) * 100)}%`,
                  }}/>
                </div>
                <span style={{ width:70, textAlign:'right', fontSize:12, color:'#666', fontWeight:600 }}>
                  {t.pts} pts
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Summary card ──────────────────────────────────────────── */}
        <div style={s.summaryCard}>
          <div style={s.summaryTitle}>📋 Current Config Summary</div>
          <div style={s.summaryGrid}>
            {[
              ['Points / Bottle',  cfg.pointsPerBottle,  '⭐'],
              ['Spin Cost',        cfg.spinCost,          '💰'],
              ['Max / Day',        cfg.maxBottlesPerDay,  '🍾'],
              ['Cooldown',         `${cfg.cooldownSeconds}s`, '⏱️'],
              ['Bronze',           `${cfg.bronzePoints} pts`, '🥉'],
              ['Silver',           `${cfg.silverPoints} pts`, '🥈'],
              ['Gold',             `${cfg.goldPoints} pts`,   '🥇'],
              ['Wheel Prizes',     gifts.split('\n').filter(Boolean).length, '🎡'],
            ].map(([label, value, icon]) => (
              <div key={label} style={s.summaryItem}>
                <span style={{ fontSize:18 }}>{icon}</span>
                <div>
                  <div style={s.summaryLabel}>{label}</div>
                  <div style={s.summaryValue}>{value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Buttons ───────────────────────────────────────────────── */}
        <div style={{ display:'flex', gap:12, justifyContent:'flex-end', marginTop:4 }}>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm('Reset all fields to last saved values from Firestore?')) return;
              // onSnapshot will re-fire and repopulate
            }}
            style={s.resetBtn}
            disabled={saving}>
            ↻ Reset
          </button>
          <button type="submit" style={{ ...s.saveBtn, opacity: saving ? 0.7 : 1 }} disabled={saving}>
            {saved ? '✓ Saved!' : saving ? '⏳ Saving…' : '💾 Save Changes'}
          </button>
        </div>

      </form>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Section({ icon, title, children }) {
  return (
    <div style={s.card}>
      <h3 style={s.cardTitle}>{icon} {title}</h3>
      {children}
    </div>
  );
}

function NumField({ label, icon, color, value, onChange, help }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <label style={s.label}>
        <span style={{ marginRight: 4 }}>{icon}</span>{label}
      </label>
      <input
        style={{
          ...s.numInput,
          borderColor: color || '#ddd',
          color:       color || '#222',
        }}
        type="number"
        min="0"
        required
        value={value ?? 0}
        onChange={e => onChange(parseInt(e.target.value, 10) || 0)} />
      {help && <div style={s.helpText}>{help}</div>}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  h1:           { margin:'0 0 4px', fontSize:28, fontWeight:800, color:'#1B5E20' },
  sub:          { margin:0, color:'#888', fontSize:14 },
  errBox:       { background:'#FFEBEE', color:'#C62828', padding:'12px 16px', borderRadius:10, fontSize:13, marginBottom:18, fontWeight:600 },
  okBox:        { background:'#E8F5E9', color:'#2E7D32', padding:'12px 16px', borderRadius:10, fontSize:13, marginBottom:18, fontWeight:700 },
  card:         { background:'#fff', borderRadius:14, padding:'22px 24px', marginBottom:18, boxShadow:'0 2px 10px rgba(0,0,0,.06)' },
  cardTitle:    { margin:'0 0 20px', fontSize:18, fontWeight:700, color:'#222' },
  grid3:        { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:4 },
  divider:      { height:1, background:'#f0f0f0', margin:'20px 0' },
  label:        { display:'block', fontSize:11, fontWeight:700, color:'#555', marginBottom:6, textTransform:'uppercase', letterSpacing:.5 },
  hint:         { fontWeight:400, textTransform:'none', color:'#aaa', fontSize:11, letterSpacing:0 },
  helpText:     { fontSize:11, color:'#999', marginTop:5, lineHeight:1.5 },
  numInput:     { width:'100%', padding:'10px 12px', borderRadius:9, border:'2px solid', fontSize:22, fontWeight:800, boxSizing:'border-box', outline:'none', textAlign:'center' },
  textarea:     { width:'100%', padding:'10px 12px', borderRadius:9, border:'1.5px solid #ddd', fontSize:14, fontFamily:'monospace', boxSizing:'border-box', resize:'vertical', outline:'none' },
  previewBox:   { marginTop:12, background:'#F9FBE7', borderRadius:9, padding:'10px 14px', border:'1px solid #E8F5E9' },
  previewLabel: { fontSize:10, color:'#888', marginBottom:8, fontWeight:700, textTransform:'uppercase', letterSpacing:.5 },
  pills:        { display:'flex', flexWrap:'wrap', gap:6 },
  pill:         { background:'#2E7D32', color:'#fff', padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:600 },
  summaryCard:  { background:'linear-gradient(135deg,#F1F8E9,#E8F5E9)', borderRadius:14, padding:'20px 24px', marginBottom:18, border:'1px solid #C8E6C9' },
  summaryTitle: { fontSize:14, fontWeight:700, color:'#2E7D32', marginBottom:14 },
  summaryGrid:  { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 },
  summaryItem:  { display:'flex', alignItems:'center', gap:8, background:'#fff', borderRadius:9, padding:'8px 10px', boxShadow:'0 1px 4px rgba(0,0,0,.05)' },
  summaryLabel: { fontSize:10, color:'#888', textTransform:'uppercase', letterSpacing:.3 },
  summaryValue: { fontSize:14, fontWeight:800, color:'#1B5E20' },
  resetBtn:     { padding:'11px 22px', background:'#f5f5f5', border:'1px solid #ddd', borderRadius:10, cursor:'pointer', fontSize:14, fontWeight:600, color:'#555' },
  saveBtn:      { padding:'12px 32px', background:'linear-gradient(135deg,#2E7D32,#388E3C)', color:'#fff', border:'none', borderRadius:10, fontSize:15, fontWeight:800, cursor:'pointer', letterSpacing:.3 },
};