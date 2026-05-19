// src/pages/TrainingPage.js
// ─────────────────────────────────────────────────────────────────────────────
// Admin panel for managing self-training data collected from users.
// Users scan bins in the app → images + labels saved to Firestore/Storage.
// Admin reviews samples here, approves good ones, rejects bad ones.
// When enough good samples exist, admin runs retrain.py to improve the model.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, doc, updateDoc,
  query, where, orderBy, limit, getCountFromServer,
} from 'firebase/firestore';

const LABEL_META = {
  bottle:              { emoji:'🍾', label:'Bottle',         color:'#2E7D32', bg:'#E8F5E9' },
  notBottle:           { emoji:'❌', label:'Not a Bottle',   color:'#C62828', bg:'#FFEBEE' },
  binRed:              { emoji:'🔴', label:'Red Bin',        color:'#B71C1C', bg:'#FFEBEE' },
  binGreen:            { emoji:'🟢', label:'Green Bin',      color:'#1B5E20', bg:'#E8F5E9' },
  binPurple:           { emoji:'🟣', label:'Purple Bin',     color:'#4A148C', bg:'#F3E5F5' },
  binUnknown:          { emoji:'❓', label:'Unknown Bin',    color:'#795548', bg:'#EFEBE9' },
  insertion_confirmed: { emoji:'✅', label:'Insertion',      color:'#1565C0', bg:'#E3F2FD' },
  clean_sri_lanka:     { emoji:'🟢', label:'Clean SL Bin',  color:'#2E7D32', bg:'#E8F5E9' },
  carekleen:           { emoji:'🟢', label:'Carekleen Bin', color:'#1B5E20', bg:'#E8F5E9' },
};

const getLabelMeta = l => LABEL_META[l] || { emoji:'🔷', label: l, color:'#555', bg:'#f5f5f5' };

export default function TrainingPage() {
  const [stats,       setStats]       = useState({});
  const [samples,     setSamples]     = useState([]);
  const [filter,      setFilter]      = useState('all');       // 'all'|'unverified'|label
  const [loading,     setLoading]     = useState(true);
  const [updating,    setUpdating]    = useState(null);        // docId being updated
  const [toast,       setToast]       = useState('');
  const [totalCount,  setTotalCount]  = useState(0);
  const [page,        setPage]        = useState(0);           // simple pagination
  const PAGE_SIZE = 20;

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Load stats (counts per label) ─────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'training_samples'),
      snap => {
        const counts = {};
        let total = 0;
        snap.docs.forEach(d => {
          const label = d.data().label || 'unknown';
          counts[label] = (counts[label] || 0) + 1;
          total++;
        });
        setStats(counts);
        setTotalCount(total);
        setLoading(false);
      },
      err => { console.error(err); setLoading(false); }
    );
    return unsub;
  }, []);

  // ── Load samples with filter ───────────────────────────────────────────────
  useEffect(() => {
    setPage(0);
    let q;
    if (filter === 'all') {
      q = query(collection(db, 'training_samples'), limit(PAGE_SIZE));
    } else if (filter === 'unverified') {
      q = query(
        collection(db, 'training_samples'),
        where('verified', '==', false),
        limit(PAGE_SIZE)
      );
    } else {
      q = query(
        collection(db, 'training_samples'),
        where('label', '==', filter),
        limit(PAGE_SIZE)
      );
    }

    const unsub = onSnapshot(q, snap => {
      setSamples(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [filter]);

  // ── Approve a sample ───────────────────────────────────────────────────────
  const approve = async (sampleId) => {
    setUpdating(sampleId);
    try {
      await updateDoc(doc(db, 'training_samples', sampleId), { verified: true });
      showToast('✅ Sample approved — will be used in next training run');
    } catch (e) {
      showToast('❌ Error: ' + e.message);
    } finally {
      setUpdating(null);
    }
  };

  // ── Reject a sample (marks as bad — excluded from training) ───────────────
  const reject = async (sampleId) => {
    setUpdating(sampleId);
    try {
      await updateDoc(doc(db, 'training_samples', sampleId), {
        verified: false,
        rejected: true,
      });
      showToast('🗑️ Sample rejected — excluded from training');
    } catch (e) {
      showToast('❌ Error: ' + e.message);
    } finally {
      setUpdating(null);
    }
  };

  // ── Correct a label ────────────────────────────────────────────────────────
  const correctLabel = async (sampleId, newLabel) => {
    setUpdating(sampleId);
    try {
      await updateDoc(doc(db, 'training_samples', sampleId), {
        label:    newLabel,
        verified: true,
        corrected: true,
      });
      showToast(`✏️ Label corrected to "${newLabel}"`);
    } catch (e) {
      showToast('❌ Error: ' + e.message);
    } finally {
      setUpdating(null);
    }
  };

  const verifiedCount   = Object.values(stats).reduce((a,b) => a+b, 0);
  const unverifiedCount = samples.filter(s => !s.verified && !s.rejected).length;

  if (loading) return (
    <div style={{ textAlign:'center', padding:60, color:'#aaa' }}>
      Loading training data…
    </div>
  );

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={s.toast}>{toast}</div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={s.h1}>🧠 Model Training Data</h1>
        <p style={s.sub}>
          Images collected from users when they scan bins and bottles.
          Review and approve samples, then run <code style={s.code}>retrain.py</code> to improve the model.
        </p>
      </div>

      {/* Stats cards */}
      <div style={s.statsGrid}>
        <StatCard icon="📦" label="Total Samples" value={totalCount} color="#1565C0" />
        <StatCard icon="✅" label="Verified" value={Object.entries(stats).reduce((a,[,v])=>a+v,0)} color="#2E7D32" />
        <StatCard icon="⏳" label="Needs Review" value={unverifiedCount} color="#F57F17" />
        <StatCard icon="🤖" label="Ready to Train" value={totalCount >= 50 ? 'YES' : `Need ${50-totalCount} more`} color={totalCount>=50?'#2E7D32':'#C62828'} />
      </div>

      {/* Label breakdown */}
      <div style={s.card}>
        <h3 style={s.cardTitle}>📊 Samples by Label</h3>
        <div style={s.labelGrid}>
          {Object.entries(stats).length === 0 ? (
            <div style={{ color:'#aaa', fontSize:14 }}>No training samples yet. Users need to scan bins and bottles in the app first.</div>
          ) : Object.entries(stats).map(([label, count]) => {
            const meta = getLabelMeta(label);
            return (
              <button
                key={label}
                onClick={() => setFilter(label)}
                style={{
                  ...s.labelChip,
                  background: filter === label ? meta.color : meta.bg,
                  color:      filter === label ? '#fff' : meta.color,
                  border:     `1.5px solid ${meta.color}40`,
                }}>
                <span style={{ fontSize: 18 }}>{meta.emoji}</span>
                <div style={{ textAlign:'left' }}>
                  <div style={{ fontWeight:700, fontSize:13 }}>{meta.label}</div>
                  <div style={{ fontSize:11, opacity:.8 }}>{count} samples</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Filter controls */}
        <div style={s.filterRow}>
          <button onClick={() => setFilter('all')} style={{ ...s.filterBtn, ...(filter==='all'?s.filterBtnActive:{}) }}>
            All ({totalCount})
          </button>
          <button onClick={() => setFilter('unverified')} style={{ ...s.filterBtn, ...(filter==='unverified'?s.filterBtnActive:{}) }}>
            ⏳ Needs Review
          </button>
        </div>
      </div>

      {/* How to use panel */}
      <div style={s.howToCard}>
        <div style={s.howToTitle}>🔄 How Self-Training Works</div>
        <div style={s.howToSteps}>
          <Step n="1" text="Users scan bins and bottles in the Flutter app → images automatically uploaded to Firebase Storage + metadata saved to Firestore" />
          <Step n="2" text="Review samples below. Approve correct ones ✅, reject wrong ones ❌, or correct the label ✏️" />
          <Step n="3" text="Once you have 50+ verified samples, run the retraining script on your computer:" />
          <div style={s.codeBlock}>
            <code>python retrain.py --project price-ur-plastic-faab5 --min-samples 50</code>
          </div>
          <Step n="4" text="Script downloads verified images, retrains the model, checks accuracy, and uploads the new model to Firebase. App users get the update automatically on next launch." />
        </div>
      </div>

      {/* Sample gallery */}
      <div style={s.card}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ ...s.cardTitle, margin:0 }}>
            🖼️ Sample Images
            {filter !== 'all' && <span style={{ fontSize:13, fontWeight:400, color:'#888', marginLeft:8 }}>— filtered: {filter}</span>}
          </h3>
          <span style={{ fontSize:12, color:'#aaa' }}>{samples.length} shown</span>
        </div>

        {samples.length === 0 ? (
          <div style={{ textAlign:'center', padding:40, color:'#aaa', fontSize:14 }}>
            {filter === 'unverified'
              ? 'No unverified samples — all reviewed!'
              : 'No samples in this category yet.'}
          </div>
        ) : (
          <div style={s.gallery}>
            {samples.map(sample => (
              <SampleCard
                key={sample.id}
                sample={sample}
                updating={updating === sample.id}
                onApprove={() => approve(sample.id)}
                onReject={()  => reject(sample.id)}
                onCorrect={newLabel => correctLabel(sample.id, newLabel)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Retrain instructions */}
      <div style={s.infoCard}>
        <div style={s.infoTitle}>⚠️ Important Notes</div>
        <ul style={s.infoList}>
          <li>The model cannot train <b>on-device</b> — TFLite only runs predictions, not training.</li>
          <li>Training happens on your computer using the <code style={s.code}>retrain.py</code> script.</li>
          <li>The script downloads verified images from Firebase, retrains, and pushes the new model back automatically.</li>
          <li>After retraining, Firebase Remote Config is updated — users get the new model on next app launch.</li>
          <li>Minimum <b>50 verified samples</b> recommended before retraining for meaningful improvement.</li>
          <li>Run retraining <b>weekly or monthly</b> as more samples accumulate.</li>
        </ul>
      </div>
    </div>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, color }) {
  return (
    <div style={s.statCard}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

// ── Step ─────────────────────────────────────────────────────────────────────
function Step({ n, text }) {
  return (
    <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:8 }}>
      <div style={{ width:22, height:22, borderRadius:'50%', background:'#1565C0', color:'#fff',
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:11,
        fontWeight:800, flexShrink:0, marginTop:1 }}>{n}</div>
      <div style={{ fontSize:13, color:'#444', lineHeight:1.6 }}>{text}</div>
    </div>
  );
}

// ── SampleCard ────────────────────────────────────────────────────────────────
function SampleCard({ sample, updating, onApprove, onReject, onCorrect }) {
  const [showCorrect, setShowCorrect] = useState(false);
  const meta = getLabelMeta(sample.label);

  const ts = sample.timestamp?.toDate?.()?.toLocaleString?.() || '—';
  const isRejected = sample.rejected === true;
  const isVerified = sample.verified === true && !isRejected;

  return (
    <div style={{
      ...s.sampleCard,
      opacity: isRejected ? 0.5 : 1,
      borderColor: isVerified ? '#4CAF50' : isRejected ? '#ef9a9a' : '#e0e0e0',
    }}>
      {/* Image */}
      {sample.imageUrl ? (
        <div style={s.imgWrap}>
          <img
            src={sample.imageUrl}
            alt={sample.label}
            style={s.sampleImg}
            onError={e => { e.target.style.display='none'; }} />
        </div>
      ) : (
        <div style={s.noImg}>{meta.emoji}<br /><span style={{fontSize:10}}>No image</span></div>
      )}

      {/* Info */}
      <div style={s.sampleInfo}>
        {/* Label badge */}
        <div style={{ ...s.labelBadge, background: meta.bg, color: meta.color }}>
          {meta.emoji} {meta.label}
          {sample.corrected && <span style={{ fontSize:9, marginLeft:4, opacity:.7 }}>✏️corrected</span>}
        </div>

        {/* Status */}
        <div style={s.sampleMeta}>
          {isVerified  && <span style={s.verifiedBadge}>✅ Approved</span>}
          {isRejected  && <span style={s.rejectedBadge}>❌ Rejected</span>}
          {!isVerified && !isRejected && <span style={s.pendingBadge}>⏳ Pending</span>}
        </div>

        <div style={s.sampleTime}>{ts}</div>
        {sample.modelConfidence > 0 && (
          <div style={s.confidence}>
            Model confidence: {Math.round(sample.modelConfidence * 100)}%
            {sample.modelWasCorrect ? ' ✅' : ' ❌'}
          </div>
        )}
      </div>

      {/* Actions */}
      {!isRejected && (
        <div style={s.sampleActions}>
          {!isVerified && (
            <button
              onClick={onApprove}
              disabled={updating}
              style={s.approveBtn}
              title="Approve — include in training">
              {updating ? '…' : '✅'}
            </button>
          )}
          <button
            onClick={onReject}
            disabled={updating}
            style={s.rejectBtn}
            title="Reject — exclude from training">
            {updating ? '…' : '🗑️'}
          </button>
          <button
            onClick={() => setShowCorrect(v => !v)}
            style={s.correctBtn}
            title="Correct the label">
            ✏️
          </button>
        </div>
      )}

      {/* Label correction dropdown */}
      {showCorrect && (
        <div style={s.correctDropdown}>
          <div style={{ fontSize:11, fontWeight:700, color:'#555', marginBottom:6 }}>
            Correct label to:
          </div>
          {Object.entries(LABEL_META).map(([key, meta]) => (
            <button key={key}
              onClick={() => { onCorrect(key); setShowCorrect(false); }}
              style={s.correctOption}>
              {meta.emoji} {meta.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  h1:            { margin:'0 0 4px', fontSize:28, fontWeight:800, color:'#1B5E20' },
  sub:           { margin:0, color:'#888', fontSize:14, lineHeight:1.6 },
  code:          { background:'#f0f4f8', padding:'1px 6px', borderRadius:4, fontSize:12, fontFamily:'monospace' },
  toast:         { position:'fixed', top:20, right:20, background:'#1B5E20', color:'#fff', padding:'12px 20px', borderRadius:10, fontSize:13, fontWeight:600, zIndex:9999, boxShadow:'0 4px 20px rgba(0,0,0,.2)' },
  statsGrid:     { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:18 },
  statCard:      { background:'#fff', borderRadius:12, padding:'16px 18px', boxShadow:'0 2px 10px rgba(0,0,0,.06)', display:'flex', alignItems:'center', gap:14 },
  card:          { background:'#fff', borderRadius:14, padding:'22px 24px', marginBottom:18, boxShadow:'0 2px 10px rgba(0,0,0,.06)' },
  cardTitle:     { margin:'0 0 16px', fontSize:18, fontWeight:700, color:'#222' },
  labelGrid:     { display:'flex', flexWrap:'wrap', gap:8, marginBottom:16 },
  labelChip:     { display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderRadius:10, cursor:'pointer', transition:'all .15s' },
  filterRow:     { display:'flex', gap:8, marginTop:8, borderTop:'1px solid #f0f0f0', paddingTop:12 },
  filterBtn:     { padding:'6px 14px', borderRadius:8, border:'1.5px solid #ddd', background:'#f9f9f9', color:'#666', cursor:'pointer', fontSize:13, fontWeight:600 },
  filterBtnActive:{ background:'#1B5E20', color:'#fff', borderColor:'#1B5E20' },
  howToCard:     { background:'#EDE7F6', borderRadius:14, padding:'20px 24px', marginBottom:18, border:'1px solid #D1C4E9' },
  howToTitle:    { fontSize:15, fontWeight:800, color:'#4A148C', marginBottom:14 },
  howToSteps:    { display:'flex', flexDirection:'column', gap:4 },
  codeBlock:     { background:'#1a1a2e', color:'#a8ff78', padding:'12px 16px', borderRadius:9, fontFamily:'monospace', fontSize:13, margin:'8px 0', overflowX:'auto' },
  infoCard:      { background:'#FFF8E1', borderRadius:14, padding:'20px 24px', marginBottom:18, border:'1px solid #FFE082' },
  infoTitle:     { fontSize:15, fontWeight:800, color:'#E65100', marginBottom:12 },
  infoList:      { margin:0, paddingLeft:20, fontSize:13, color:'#555', lineHeight:2 },
  gallery:       { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:14 },
  sampleCard:    { border:'1.5px solid', borderRadius:12, overflow:'hidden', background:'#fff', position:'relative' },
  imgWrap:       { width:'100%', aspectRatio:'1', overflow:'hidden', background:'#f5f5f5' },
  sampleImg:     { width:'100%', height:'100%', objectFit:'cover', display:'block' },
  noImg:         { width:'100%', aspectRatio:'1', background:'#f5f5f5', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontSize:28, color:'#ccc' },
  sampleInfo:    { padding:'10px 10px 6px' },
  labelBadge:    { display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:700, marginBottom:6 },
  sampleMeta:    { marginBottom:4 },
  verifiedBadge: { fontSize:10, background:'#E8F5E9', color:'#2E7D32', padding:'2px 6px', borderRadius:5, fontWeight:700 },
  rejectedBadge: { fontSize:10, background:'#FFEBEE', color:'#C62828', padding:'2px 6px', borderRadius:5, fontWeight:700 },
  pendingBadge:  { fontSize:10, background:'#FFF8E1', color:'#E65100', padding:'2px 6px', borderRadius:5, fontWeight:700 },
  sampleTime:    { fontSize:10, color:'#aaa' },
  confidence:    { fontSize:10, color:'#888', marginTop:3 },
  sampleActions: { display:'flex', gap:6, padding:'6px 10px 10px' },
  approveBtn:    { flex:1, padding:'6px', background:'#E8F5E9', border:'1px solid #C8E6C9', borderRadius:7, cursor:'pointer', fontSize:14 },
  rejectBtn:     { flex:1, padding:'6px', background:'#FFEBEE', border:'1px solid #FFCDD2', borderRadius:7, cursor:'pointer', fontSize:14 },
  correctBtn:    { flex:1, padding:'6px', background:'#E3F2FD', border:'1px solid #BBDEFB', borderRadius:7, cursor:'pointer', fontSize:14 },
  correctDropdown:{ padding:'10px', borderTop:'1px solid #f0f0f0', display:'flex', flexDirection:'column', gap:4 },
  correctOption: { padding:'5px 8px', background:'#f9f9f9', border:'1px solid #eee', borderRadius:6, cursor:'pointer', fontSize:12, textAlign:'left' },
};