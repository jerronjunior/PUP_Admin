// src/pages/RewardsPage.js
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

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
  const [dbValues,setDbValues]= useState(null); // shows what's actually in Firestore

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'reward_config', 'default'),
      snap => {
        const raw = snap.exists() ? snap.data() : {};
        console.log('📦 Firestore reward_config/default:', raw); // debug
        setDbValues(raw);
        const d = { ...DEFAULT, ...raw };
        setCfg(d);
        setGifts((d.wheelGifts || []).join('\n'));
        setLoading(false);
      },
      err => {
        console.error('❌ Firestore read error:', err);
        setError('Read error: ' + err.message);
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
      const payload = {
        pointsPerBottle:  Number(cfg.pointsPerBottle),
        spinCost:         Number(cfg.spinCost),
        maxBottlesPerDay: Number(cfg.maxBottlesPerDay),
        cooldownSeconds:  Number(cfg.cooldownSeconds),
        bronzePoints:     Number(cfg.bronzePoints),
        silverPoints:     Number(cfg.silverPoints),
        goldPoints:       Number(cfg.goldPoints),
        wheelGifts:       parsedGifts,
        updatedAt:        serverTimestamp(),
      };

      console.log('💾 Saving to Firestore:', payload); // debug

      await setDoc(doc(db, 'reward_config', 'default'), payload);

      // Verify it was saved by reading back
      const verify = await getDoc(doc(db, 'reward_config', 'default'));
      console.log('✅ Verified in Firestore:', verify.data()); // debug

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('❌ Save error:', err);
      setError('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>Loading…</div>;

  return (
    <div>
      <h1 style={s.h1}>Manage Rewards</h1>
      <p style={s.sub}>Changes save to Firestore and update the app instantly.</p>

      {error && <div style={s.errBox}>❌ {error}</div>}
      {saved && <div style={s.okBox}>✅ Saved to Firestore! Check app now.</div>}

      {/* DEBUG PANEL — shows exactly what's in Firestore right now */}
      <div style={s.debugBox}>
        <div style={s.debugTitle}>🔍 What Firestore actually has right now:</div>
        <div style={s.debugGrid}>
          {dbValues && Object.entries(dbValues)
            .filter(([k]) => k !== 'wheelGifts' && k !== 'updatedAt')
            .map(([k, v]) => (
              <div key={k} style={s.debugItem}>
                <span style={s.debugKey}>{k}</span>
                <span style={s.debugVal}>{String(v)}</span>
              </div>
          ))}
        </div>
        <div style={{ fontSize:11, color:'#888', marginTop:8 }}>
          If values here change after Save but app doesn't update → Flutter file issue
        </div>
      </div>

      <form onSubmit={handleSave}>

        {/* ── Recycling Rewards ────────────────────────── */}
        <Card icon="♻️" title="Recycling Rewards">
          <div style={s.grid3}>
            <NumField label="Points per Bottle" icon="⭐"
              value={cfg.pointsPerBottle}
              onChange={v => update('pointsPerBottle', v)} />
            <NumField label="Max Bottles per Day" icon="🍾"
              value={cfg.maxBottlesPerDay}
              onChange={v => update('maxBottlesPerDay', v)} />
            <NumField label="Cooldown (seconds)" icon="⏱️"
              value={cfg.cooldownSeconds}
              onChange={v => update('cooldownSeconds', v)} />
          </div>
        </Card>

        {/* ── Spin Wheel ───────────────────────────────── */}
        <Card icon="🎡" title="Spin Wheel">
          <div style={{ marginBottom: 20 }}>
            <NumField label="Cost per Spin (points)" icon="💰" color="#F57F17"
              value={cfg.spinCost}
              help="Points a user spends to spin the wheel"
              onChange={v => update('spinCost', v)} />
          </div>
          <div style={s.divider} />
          <label style={s.label}>Wheel Prizes <span style={s.hint}>(one per line)</span></label>
          <textarea style={s.textarea} rows={8} value={gifts}
            onChange={e => setGifts(e.target.value)} />
          <div style={s.previewBox}>
            <div style={s.previewLabel}>Preview:</div>
            <div style={s.pills}>
              {gifts.split('\n').map(g=>g.trim()).filter(Boolean).map((g,i)=>(
                <span key={i} style={s.pill}>{g}</span>
              ))}
            </div>
          </div>
        </Card>

        {/* ── Reward Tiers ─────────────────────────────── */}
        <Card icon="🏆" title="Reward Tiers">
          <div style={s.grid3}>
            <NumField label="Bronze Tier" icon="🥉" color="#CD7F32"
              value={cfg.bronzePoints} onChange={v => update('bronzePoints', v)} />
            <NumField label="Silver Tier" icon="🥈" color="#9E9E9E"
              value={cfg.silverPoints} onChange={v => update('silverPoints', v)} />
            <NumField label="Gold Tier"   icon="🥇" color="#FFC107"
              value={cfg.goldPoints}   onChange={v => update('goldPoints', v)} />
          </div>
        </Card>

        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:4 }}>
          <button type="submit" style={s.saveBtn} disabled={saving}>
            {saving ? '⏳ Saving…' : saved ? '✓ Saved!' : '💾 Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Card({ icon, title, children }) {
  return <div style={s.card}><h3 style={s.cardTitle}>{icon} {title}</h3>{children}</div>;
}

function NumField({ label, icon, color, value, onChange, help }) {
  return (
    <div>
      <label style={s.label}><span style={{marginRight:4}}>{icon}</span>{label}</label>
      <input style={{...s.numInput, borderColor:color||'#ddd', color:color||'#222'}}
        type="number" min="0" required value={value??0}
        onChange={e => onChange(parseInt(e.target.value,10)||0)} />
      {help && <div style={s.helpText}>{help}</div>}
    </div>
  );
}

const s = {
  h1:          { margin:'0 0 4px', fontSize:28, fontWeight:800, color:'#1B5E20' },
  sub:         { margin:'0 0 16px', color:'#888', fontSize:14 },
  errBox:      { background:'#FFEBEE', color:'#C62828', padding:'10px 14px', borderRadius:9, fontSize:13, marginBottom:16, fontWeight:600 },
  okBox:       { background:'#E8F5E9', color:'#2E7D32', padding:'10px 14px', borderRadius:9, fontSize:13, marginBottom:16, fontWeight:700 },
  debugBox:    { background:'#FFF8E1', border:'1.5px solid #FFD54F', borderRadius:10, padding:'12px 16px', marginBottom:20 },
  debugTitle:  { fontSize:12, fontWeight:700, color:'#F57F17', marginBottom:10 },
  debugGrid:   { display:'flex', flexWrap:'wrap', gap:8 },
  debugItem:   { background:'#fff', border:'1px solid #FFD54F', borderRadius:7, padding:'5px 10px', fontSize:12 },
  debugKey:    { color:'#888', marginRight:6 },
  debugVal:    { fontWeight:800, color:'#E65100' },
  card:        { background:'#fff', borderRadius:14, padding:'22px 24px', marginBottom:18, boxShadow:'0 2px 10px rgba(0,0,0,.06)' },
  cardTitle:   { margin:'0 0 18px', fontSize:18, fontWeight:700, color:'#222' },
  grid3:       { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 },
  divider:     { height:1, background:'#f0f0f0', margin:'16px 0' },
  label:       { display:'block', fontSize:11, fontWeight:700, color:'#555', marginBottom:6, textTransform:'uppercase', letterSpacing:.4 },
  hint:        { fontWeight:400, textTransform:'none', color:'#aaa', fontSize:11 },
  helpText:    { fontSize:11, color:'#888', marginTop:5 },
  numInput:    { width:'100%', padding:'10px 12px', borderRadius:9, border:'2px solid', fontSize:20, fontWeight:800, boxSizing:'border-box', outline:'none', textAlign:'center' },
  textarea:    { width:'100%', padding:'10px 12px', borderRadius:9, border:'1.5px solid #ddd', fontSize:14, fontFamily:'monospace', boxSizing:'border-box', resize:'vertical', outline:'none' },
  previewBox:  { marginTop:10, background:'#F9FBE7', borderRadius:9, padding:'10px 14px' },
  previewLabel:{ fontSize:11, color:'#888', marginBottom:8, fontWeight:700, textTransform:'uppercase' },
  pills:       { display:'flex', flexWrap:'wrap', gap:6 },
  pill:        { background:'#2E7D32', color:'#fff', padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:600 },
  saveBtn:     { padding:'12px 32px', background:'linear-gradient(135deg,#2E7D32,#388E3C)', color:'#fff', border:'none', borderRadius:10, fontSize:15, fontWeight:800, cursor:'pointer' },
};