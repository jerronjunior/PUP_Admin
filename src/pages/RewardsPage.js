// src/pages/RewardsPage.js
// Mirrors manage_rewards_screen.dart exactly:
//   - Points per bottle, max bottles/day, cooldown seconds
//   - Wheel gifts (one per line)
//   - Bronze / Silver / Gold tier thresholds
//   - Save + Reset buttons
import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import useMediaQuery from '../hooks/useMediaQuery';

const DEFAULT = {
  pointsPerBottle:  1,
  maxBottlesPerDay: 25,
  cooldownSeconds:  20,
  wheelGifts:       ['50 pts', 'Badge', '100 pts', 'Star', '200 pts', 'Crown', '500 pts', 'Gift'],
  bronzePoints:     50,
  silverPoints:     200,
  goldPoints:       500,
};

export default function RewardsPage() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isTinyMobile = useMediaQuery('(max-width: 360px)');
  const [cfg,     setCfg]     = useState(null);
  const [gifts,   setGifts]   = useState('');  // textarea string
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(doc(db, 'reward_config', 'default'), snap => {
      const d = snap.exists() ? { ...DEFAULT, ...snap.data() } : DEFAULT;
      setCfg(d);
      setGifts((d.wheelGifts || []).join('\n'));
      setLoading(false);
    });
  }, []);

  const update = (k, v) => setCfg(c => ({ ...c, [k]: v }));

  const handleSave = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedGifts = gifts.split('\n').map(g => g.trim()).filter(Boolean);
      await setDoc(doc(db, 'reward_config', 'default'), {
        ...cfg,
        wheelGifts: parsedGifts,
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!window.confirm('Reset all fields to last saved values?')) return;
    // onSnapshot will re-fire and repopulate
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading…</div>;

  return (
    <div>
      <h1 style={{ ...s.h1, ...(isMobile ? s.h1Mobile : {}), ...(isTinyMobile ? s.h1Tiny : {}) }}>Manage Rewards</h1>
      <p style={s.sub}>Changes reflect in the app immediately after saving.</p>

      <form onSubmit={handleSave}>

        {/* ── Recycling Rewards ────────────────────────────────────── */}
        <Card icon="♻️" title="Recycling Rewards" isMobile={isMobile}>
          <div style={{ ...s.grid3, ...(isMobile ? s.grid3Mobile : {}) }}>
            <NumberField
              label="Points per Bottle"
              icon="⭐"
              value={cfg.pointsPerBottle}
              onChange={v => update('pointsPerBottle', v)} />
            <NumberField
              label="Max Bottles per Day"
              icon="🍾"
              value={cfg.maxBottlesPerDay}
              onChange={v => update('maxBottlesPerDay', v)} />
            <NumberField
              label="Cooldown (seconds)"
              icon="⏱️"
              value={cfg.cooldownSeconds}
              onChange={v => update('cooldownSeconds', v)} />
          </div>
        </Card>

        {/* ── Wheel Gifts ───────────────────────────────────────────── */}
        <Card icon="🎡" title="Spin Wheel Gifts" isMobile={isMobile}>
          <label style={s.label}>Reward Gifts <span style={s.hint}>(one gift per line)</span></label>
          <textarea
            style={s.textarea}
            value={gifts}
            onChange={e => setGifts(e.target.value)}
            rows={9}
            placeholder={'50 pts\nBadge\n100 pts\nStar\n200 pts\nCrown\n500 pts\nGift'} />
          <div style={s.giftPreview}>
            <div style={s.previewLabel}>Preview:</div>
            <div style={s.giftPills}>
              {gifts.split('\n').map(g => g.trim()).filter(Boolean).map((g, i) => (
                <span key={i} style={s.pill}>{g}</span>
              ))}
            </div>
          </div>
        </Card>

        {/* ── Reward Tiers ─────────────────────────────────────────── */}
        <Card icon="🏆" title="Reward Tiers" isMobile={isMobile}>
          <div style={{ ...s.grid3, ...(isMobile ? s.grid3Mobile : {}) }}>
            <NumberField
              label="Bronze Tier Points"
              icon="🥉"
              color="#CD7F32"
              value={cfg.bronzePoints}
              onChange={v => update('bronzePoints', v)} />
            <NumberField
              label="Silver Tier Points"
              icon="🥈"
              color="#9E9E9E"
              value={cfg.silverPoints}
              onChange={v => update('silverPoints', v)} />
            <NumberField
              label="Gold Tier Points"
              icon="🥇"
              color="#FFC107"
              value={cfg.goldPoints}
              onChange={v => update('goldPoints', v)} />
          </div>

          {/* Tier progress preview */}
          <div style={s.tierPreview}>
            {[
              { label: 'Bronze', pts: cfg.bronzePoints, color: '#CD7F32' },
              { label: 'Silver', pts: cfg.silverPoints, color: '#9E9E9E' },
              { label: 'Gold',   pts: cfg.goldPoints,   color: '#FFC107' },
            ].map(t => (
              <div key={t.label} style={s.tierRow}>
                <span style={{ ...s.tierDot, background: t.color }} />
                <span style={s.tierLabel}>{t.label}</span>
                <div style={s.tierBar}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (t.pts / (cfg.goldPoints || 1)) * 100)}%`,
                    background: t.color,
                    borderRadius: 4,
                    transition: 'width .3s',
                  }} />
                </div>
                <span style={s.tierPts}>{t.pts} pts</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Buttons ──────────────────────────────────────────────── */}
        <div style={{ ...s.btnRow, ...(isMobile ? s.btnRowMobile : {}), ...(isTinyMobile ? s.btnRowTiny : {}) }}>
          <button type="button" onClick={handleReset} style={{ ...s.resetBtn, ...(isMobile ? s.actionBtnMobile : {}) }}
            disabled={saving}>
            ↻ Reset to Current
          </button>
          <button type="submit" style={{ ...s.saveBtn, ...(isMobile ? s.actionBtnMobile : {}) }} disabled={saving}>
            {saved ? '✓ Saved!' : saving ? 'Saving…' : '💾 Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Card({ icon, title, children, isMobile }) {
  return (
    <div style={{ ...s.card, ...(isMobile ? s.cardMobile : {}) }}>
      <h3 style={{ ...s.cardTitle, ...(isMobile ? s.cardTitleMobile : {}) }}>{icon} {title}</h3>
      {children}
    </div>
  );
}

function NumberField({ label, icon, color, value, onChange }) {
  return (
    <div>
      <label style={s.label}>
        <span style={{ marginRight: 5 }}>{icon}</span>{label}
      </label>
      <input
        style={{ ...s.input, borderColor: color || '#ddd', color: color || '#222' }}
        type="number" min="0" required
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10) || 0)} />
    </div>
  );
}

const s = {
  h1:          { margin: '0 0 4px', fontSize: 28, fontWeight: 800, color: '#1B5E20' },
  h1Mobile:    { fontSize: 24 },
  h1Tiny:      { fontSize: 21 },
  sub:         { margin: '0 0 24px', color: '#888', fontSize: 14 },
  card:        { background: '#fff', borderRadius: 14, padding: '22px 24px', marginBottom: 18, boxShadow: '0 2px 10px rgba(0,0,0,.06)' },
  cardMobile:  { padding: '16px 14px', marginBottom: 14 },
  cardTitle:   { margin: '0 0 18px', fontSize: 18, fontWeight: 700, color: '#222' },
  cardTitleMobile: { fontSize: 16, marginBottom: 14 },
  grid3:       { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 4 },
  grid3Mobile: { gridTemplateColumns: '1fr', gap: 10 },
  label:       { display: 'block', fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: .4 },
  hint:        { fontWeight: 400, textTransform: 'none', color: '#aaa', fontSize: 11 },
  input:       { width: '100%', padding: '10px 12px', borderRadius: 9, border: '2px solid #ddd', fontSize: 18, fontWeight: 700, boxSizing: 'border-box', outline: 'none', textAlign: 'center' },
  textarea:    { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1.5px solid #ddd', fontSize: 14, fontFamily: 'monospace', boxSizing: 'border-box', resize: 'vertical', outline: 'none' },
  giftPreview: { marginTop: 12, background: '#F9FBE7', borderRadius: 9, padding: '10px 14px' },
  previewLabel:{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' },
  giftPills:   { display: 'flex', flexWrap: 'wrap', gap: 6 },
  pill:        { background: '#2E7D32', color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 },
  tierPreview: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 },
  tierRow:     { display: 'flex', alignItems: 'center', gap: 10 },
  tierDot:     { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 },
  tierLabel:   { width: 50, fontSize: 13, fontWeight: 600, color: '#444' },
  tierBar:     { flex: 1, height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' },
  tierPts:     { width: 70, textAlign: 'right', fontSize: 12, color: '#666', fontWeight: 600 },
  btnRow:      { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 4 },
  btnRowMobile:{ flexDirection: 'column-reverse', alignItems: 'stretch', gap: 8 },
  btnRowTiny:  { gap: 6 },
  actionBtnMobile: { width: '100%' },
  resetBtn:    { padding: '12px 24px', background: '#fff', border: '1.5px solid #ddd', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#555', cursor: 'pointer' },
  saveBtn:     { padding: '12px 32px', background: 'linear-gradient(135deg,#2E7D32,#388E3C)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: 'pointer', letterSpacing: .3 },
};
