// src/pages/ScanBinPage.js
// ─────────────────────────────────────────────────────────────────────────────
// KEY FIX: <video> element is ALWAYS in the DOM (never conditionally rendered).
// Previously it was inside an if/else branch, so videoRef.current was null
// when startCamera() ran on mount — causing a blank screen.
// Now the video is always mounted, just hidden/shown with CSS.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { db, storage } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import useMediaQuery from '../hooks/useMediaQuery';

// ── Detection grid constants ───────────────────────────────────────────────
const COLS        = 16;
const ROWS        = 12;
const LOCK_FRAMES = 8;
const MIN_COVER   = 0.15;
const MIN_HEIGHT  = 0.30;
const MAX_ASPECT  = 1.8;
const MIN_QUADS   = 3;

// ── Bin types ─────────────────────────────────────────────────────────────
const BIN_TYPES = [
  { value: 'coca_cola',    label: 'Coca-Cola Give Back Life', emoji: '🔴', color: '#E53935' },
  { value: 'cargills',     label: 'Cargills Food City',       emoji: '🔴', color: '#C62828' },
  { value: 'keells',       label: 'Keells Plasticcycle',      emoji: '🟢', color: '#2E7D32' },
  { value: 'eco_spindles', label: 'Eco Spindles',             emoji: '🟣', color: '#6A1B9A' },
];
const getBinType = v => BIN_TYPES.find(t => t.value === v);

// ── RGB → YUV (same formulas as Flutter's YUV420 plane values) ────────────
function rgbToYuv(r, g, b) {
  return {
    Y:  0.299 * r + 0.587 * g + 0.114 * b,
    U: -0.169 * r - 0.331 * g + 0.500 * b + 128,
    V:  0.500 * r - 0.419 * g - 0.081 * b + 128,
  };
}

// ── Classify one grid cell ─────────────────────────────────────────────────
function classifyCell(Y, U, V) {
  if (Y >= 40 && Y <= 130 && V >= 150 && V <= 220 && U >= 70  && U <= 122) return 'coca_cola';
  if (Y >= 40 && Y <= 145 && V >= 80  && V <= 132 && U >= 132 && U <= 195) return 'keells';
  if (Y >= 18 && Y <= 90  && V >= 102 && V <= 140 && U >= 122 && U <= 165) return 'eco_spindles';
  return null;
}

// ── Full 4-check detection on one frame ───────────────────────────────────
function detectBinInFrame(canvas, video) {
  const fw = video.videoWidth, fh = video.videoHeight;
  if (!fw || !fh) return null;

  canvas.width = fw; canvas.height = fh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, fw, fh);
  const { data } = ctx.getImageData(0, 0, fw, fh);

  const cellW = Math.floor(fw / COLS);
  const cellH = Math.floor(fh / ROWS);
  const cells = new Array(COLS * ROWS).fill(null);
  const counts = { coca_cola: 0, keells: 0, eco_spindles: 0 };

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = col * cellW, y0 = row * cellH;
      let sumY = 0, sumU = 0, sumV = 0, cnt = 0;
      for (let py = y0; py < Math.min(y0 + cellH, fh); py += 5) {
        for (let px = x0; px < Math.min(x0 + cellW, fw); px += 5) {
          const i = (py * fw + px) * 4;
          const { Y, U, V } = rgbToYuv(data[i], data[i+1], data[i+2]);
          sumY += Y; sumU += U; sumV += V; cnt++;
        }
      }
      if (!cnt) continue;
      const c = classifyCell(sumY/cnt, sumU/cnt, sumV/cnt);
      cells[row * COLS + col] = c;
      if (c) counts[c]++;
    }
  }

  // Dominant color
  let dominant = null, domCount = 0;
  for (const [t, n] of Object.entries(counts)) {
    if (n > domCount) { dominant = t; domCount = n; }
  }

  // Check 1 — minimum coverage
  if (!dominant || domCount / (COLS * ROWS) < MIN_COVER) return null;

  // Bounding box
  let minC = COLS, maxC = 0, minR = ROWS, maxR = 0;
  cells.forEach((c, i) => {
    if (c !== dominant) return;
    const col = i % COLS, row = Math.floor(i / COLS);
    if (col < minC) minC = col; if (col > maxC) maxC = col;
    if (row < minR) minR = row; if (row > maxR) maxR = row;
  });

  const spanW = maxC - minC + 1, spanH = maxR - minR + 1;

  // Check 2 — height span
  if (spanH / ROWS < MIN_HEIGHT) return null;
  // Check 3 — aspect ratio
  if (spanH > 0 && spanW / spanH > MAX_ASPECT) return null;

  // Check 4 — quadrant uniformity
  const mC = Math.floor((minC + maxC) / 2), mR = Math.floor((minR + maxR) / 2);
  const quads = [[minC,minR,mC,mR],[mC,minR,maxC,mR],[minC,mR,mC,maxR],[mC,mR,maxC,maxR]];
  let filled = 0;
  for (const [c0,r0,c1,r1] of quads) {
    let ok = false;
    for (let r = r0; r <= r1 && !ok; r++)
      for (let c = c0; c <= c1 && !ok; c++)
        if (cells[r * COLS + c] === dominant) ok = true;
    if (ok) filled++;
  }
  if (filled < MIN_QUADS) return null;

  return dominant;
}

// ══════════════════════════════════════════════════════════════════════════════
export default function ScanBinPage({ binId, binData, onComplete, onCancel }) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  const [phase,        setPhase]       = useState('camera'); // 'camera'|'review'|'saved'|'error'
  const [status,       setStatus]      = useState('Starting camera…');
  const [cameraReady,  setCameraReady] = useState(false);
  const [cameraErr,    setCameraErr]   = useState('');
  const [detectedType, setDetectedType]= useState(null);
  const [lockStreak,   setLockStreak]  = useState(0);
  const [photoPreview, setPhotoPreview]= useState('');
  const [saving,       setSaving]      = useState(false);

  const videoRef      = useRef(null);
  const detectCanvas  = useRef(null);
  const captureCanvas = useRef(null);
  const streamRef     = useRef(null);
  const intervalRef   = useRef(null);
  const photoFileRef  = useRef(null); // store file without re-render
  const streakRef     = useRef(0);
  const candidateRef  = useRef(null);

  // ── Stop camera ────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    streakRef.current = 0; candidateRef.current = null;
    // Keep video visible but clear src
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const closeScanPage = useCallback(() => {
    stopCamera();
    if (typeof onCancel === 'function') {
      onCancel();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
    }
  }, [onCancel, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── Capture from video ─────────────────────────────────────────────────────
  const capturePhoto = useCallback(() => {
    const v = videoRef.current, c = captureCanvas.current;
    if (!v || !c || !v.videoWidth) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `bin-${Date.now()}.jpg`, { type: 'image/jpeg' });
      photoFileRef.current = file;
      setPhotoPreview(URL.createObjectURL(file));
      stopCamera();
      setPhase('review');
      setStatus('✅ Bin captured! Review and save.');
    }, 'image/jpeg', 0.92);
  }, [stopCamera]);

  // ── Detection loop ─────────────────────────────────────────────────────────
  const startDetectionLoop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    streakRef.current = 0; candidateRef.current = null;

    intervalRef.current = setInterval(() => {
      const v = videoRef.current, c = detectCanvas.current;
      if (!v || !c || !v.videoWidth || !v.videoHeight) return;

      const result = detectBinInFrame(c, v);

      if (result) {
        if (result === candidateRef.current) {
          streakRef.current++;
          setLockStreak(streakRef.current);
          const rem = LOCK_FRAMES - streakRef.current;
          const bt  = getBinType(result);
          if (rem > 0) setStatus(`${bt.emoji} ${bt.label} — hold steady (${rem})`);
          if (streakRef.current >= LOCK_FRAMES) {
            setDetectedType(result);
            setStatus(`✅ ${bt.label} confirmed!`);
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            capturePhoto();
          }
        } else {
          candidateRef.current = result;
          streakRef.current    = 1;
          setLockStreak(1);
          setDetectedType(null);
          const bt = getBinType(result);
          setStatus(`${bt.emoji} ${bt.label} detected — hold steady…`);
        }
      } else {
        if (streakRef.current > 0) {
          streakRef.current    = 0;
          candidateRef.current = null;
          setLockStreak(0);
          setDetectedType(null);
          setStatus('🔍 Point camera at the recycling bin…');
        }
      }
    }, 350);
  }, [capturePhoto]);

  // ── Start camera ───────────────────────────────────────────────────────────
  // THE FIX: videoRef.current is guaranteed to exist because
  // the <video> element is always in the DOM (not conditionally rendered).
  const startCamera = useCallback(async () => {
    setCameraErr(''); setCameraReady(false);
    setStatus('Starting camera…'); setLockStreak(0);
    setDetectedType(null); setPhase('camera');

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraErr('Camera not supported in this browser.');
      setPhase('error'); return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        setCameraErr('Video element not ready. Please refresh.');
        setPhase('error'); return;
      }

      // Attach stream
      video.srcObject = stream;

      // Wait for video to be ready before calling play()
      await new Promise(resolve => {
        if (video.readyState >= 2) { resolve(); return; }
        video.addEventListener('loadeddata', resolve, { once: true });
        // Fallback timeout
        setTimeout(resolve, 3000);
      });

      try { await video.play(); } catch (_) { /* autoplay policy — stream still works */ }

      setCameraReady(true);
      setStatus('🔍 Point camera at the recycling bin…');
      startDetectionLoop();

    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access in your browser settings.'
        : err.name === 'NotFoundError'
        ? 'No camera found on this device.'
        : 'Cannot access camera: ' + err.message;
      setCameraErr(msg);
      setPhase('error');
    }
  }, [startDetectionLoop]);

  // Auto-start on mount
  useEffect(() => { startCamera(); }, []); // eslint-disable-line

  // ── Save photo ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const file = photoFileRef.current;
    const targetDocId = binData?.docId || binData?.id;
    if (!file || !binId || !targetDocId) {
      setCameraErr('Cannot save: missing bin record information.');
      return;
    }
    setSaving(true);
    try {
      const sRef = ref(storage, `bin_photos/${binId}-${Date.now()}.jpg`);
      await uploadBytes(sRef, file);
      const photoUrl = await getDownloadURL(sRef);
      await updateDoc(doc(db, 'bins', targetDocId), {
        photoUrl,
        ...(detectedType ? { binType: detectedType } : {}),
      });
      setPhase('saved');
      setTimeout(() => onComplete?.(), 1500);
    } catch (err) {
      setCameraErr('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRetake = () => {
    setPhotoPreview(''); photoFileRef.current = null;
    setDetectedType(null); setLockStreak(0);
    startCamera();
  };

  const bt       = detectedType ? getBinType(detectedType) : null;
  const lockPct  = Math.round(Math.min(100, (lockStreak / LOCK_FRAMES) * 100));
  const showVideo= phase === 'camera';

  return (
    <div style={S.container}>
      <div style={S.overlay} onClick={closeScanPage} />

      <div style={{ ...S.modal, ...(isMobile ? S.modalMobile : {}) }}>

        {/* Header */}
        <div style={S.header}>
          <h2 style={S.title}>📸 Scan Bin</h2>
          <button type="button" onClick={closeScanPage} style={S.closeBtn}>✕</button>
        </div>

        {/* Body */}
        <div style={S.body}>

          {/* ── ALWAYS IN DOM: video + hidden canvases ────────────────────
              This is the critical fix. The video element must always exist
              so videoRef.current is never null when startCamera() runs.   */}
          <div style={{ display: showVideo ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

            {/* Status pill */}
            <div style={{
              ...S.statusPill,
              background:   bt ? bt.color + '18' : '#f1f8e9',
              color:        bt ? bt.color        : '#2E7D32',
              borderColor:  bt ? bt.color + '55' : '#c8e6c9',
            }}>
              {status}
            </div>

            {/* Progress bar */}
            {lockStreak > 0 && lockStreak < LOCK_FRAMES && (
              <div style={S.progressWrap}>
                <div style={{
                  ...S.progressBar,
                  width:      lockPct + '%',
                  background: bt?.color || '#2E7D32',
                }} />
              </div>
            )}

              <button type="button" onClick={stopCamera} style={S.stopBtn}>⏸ Stop Camera</button>
            <div style={S.infoBox}>
              <div style={S.infoLabel}>Detects these bins automatically:</div>
              <div style={S.infoGrid}>
                {BIN_TYPES.map(t => (
                  <div key={t.value} style={{
                    ...S.infoItem,
                    background:  candidateRef.current === t.value ? t.color + '20' : 'transparent',
                    borderColor: candidateRef.current === t.value ? t.color : '#eee',
                  }}>
                    <span style={{ fontSize: 18 }}>{t.emoji}</span>
                    <span style={{ fontSize: 10, color: '#555', textAlign: 'center', lineHeight: 1.2 }}>
                      {t.label.split(' ')[0]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── VIDEO — always rendered, never conditional ── */}
            <div style={S.videoWrap}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={S.video}
              />
              {!cameraReady && (
                <div style={S.videoOverlay}>
                  <div style={S.spinner} />
                  <span>Opening camera…</span>
                </div>
              )}
              {/* Corner bracket overlay */}
              <svg style={S.bracketSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d="M5,18 L5,5 L18,5"   fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M82,5 L95,5 L95,18"  fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M5,82 L5,95 L18,95"  fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M82,95 L95,95 L95,82" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>

            {cameraErr && <div style={S.errBox}>{cameraErr}</div>}
            <button onClick={stopCamera} style={S.stopBtn}>⏸ Stop Camera</button>
          </div>

          {/* ── REVIEW PHOTO ──────────────────────────────────────────── */}
          {phase === 'review' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {bt && (
                <div style={{
                  ...S.detectedBadge,
                  background: bt.color + '18',
                  borderColor: bt.color + '55',
                  color: bt.color,
                }}>
                  <span style={{ fontSize: 22 }}>{bt.emoji}</span>
                  <div>
                    <div style={{ fontWeight: 700 }}>{bt.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.8 }}>Bin type auto-detected</div>
                  </div>
                </div>
              )}
              <img src={photoPreview} alt="captured bin" style={S.preview} />
              <div style={S.btnRow}>
                <button type="button" onClick={handleRetake} style={S.retakeBtn} disabled={saving}>
                  📷 Retake
                </button>
                <button type="button" onClick={handleSave} style={S.saveBtn} disabled={saving}>
                  {saving ? 'Saving…' : '💾 Save Photo'}
                </button>
              </div>
              {cameraErr && <div style={S.errBox}>{cameraErr}</div>}
            </div>
          )}

          {/* ── SUCCESS ───────────────────────────────────────────────── */}
          {phase === 'saved' && (
            <div style={S.centerBox}>
              <div style={{ fontSize: 64 }}>✅</div>
              <div style={S.successTitle}>Bin photo saved!</div>
              <div style={S.successSub}>Returning to bin list…</div>
            </div>
          )}

          {/* ── ERROR ─────────────────────────────────────────────────── */}
          {phase === 'error' && (
            <div style={S.centerBox}>
              <div style={S.errBox}>{cameraErr}</div>
              <button type="button" onClick={startCamera} style={S.retryBtn}>🔄 Retry Camera</button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <p style={S.hint}>
            {phase === 'review'
              ? 'Review photo and bin type. Tap Save to confirm.'
              : 'Point camera at bin. Auto-detects 🔴 Coca-Cola/Cargills • 🟢 Keells • 🟣 Eco Spindles'}
          </p>
        </div>
      </div>

      {/* Hidden canvases — always in DOM */}
      <canvas ref={detectCanvas}  style={{ display: 'none' }} />
      <canvas ref={captureCanvas} style={{ display: 'none' }} />
    </div>
  );
}

const S = {
  container:    { position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  overlay:      { position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)' },
  modal:        { position: 'relative', zIndex: 2001, background: '#fff', borderRadius: 18, boxShadow: '0 24px 80px rgba(0,0,0,.35)', width: 480, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  modalMobile:  { width: 'calc(100vw - 16px)', maxHeight: '91vh', borderRadius: 14 },
  header:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #e8edf2', background: '#fafbfc', flexShrink: 0 },
  title:        { margin: 0, fontSize: 18, fontWeight: 800, color: '#1B5E20' },
  closeBtn:     { background: 'none', border: 'none', fontSize: 22, color: '#888', cursor: 'pointer', padding: '4px 8px' },
  body:         { flex: 1, overflowY: 'auto', padding: '16px 20px' },
  footer:       { padding: '10px 20px 14px', borderTop: '1px solid #e8edf2', background: '#fafbfc', flexShrink: 0 },
  hint:         { margin: 0, fontSize: 12, color: '#8897a3', lineHeight: 1.5 },
  statusPill:   { padding: '10px 14px', borderRadius: 10, border: '1.5px solid', fontSize: 13, fontWeight: 700, textAlign: 'center' },
  progressWrap: { height: 6, background: '#e8edf2', borderRadius: 3, overflow: 'hidden' },
  progressBar:  { height: '100%', borderRadius: 3, transition: 'width .35s ease' },
  infoBox:      { background: '#f8fafb', borderRadius: 10, padding: '10px 12px', border: '1px solid #e8edf2' },
  infoLabel:    { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 },
  infoGrid:     { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 },
  infoItem:     { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 4px', borderRadius: 8, border: '1.5px solid', transition: 'all .2s', cursor: 'default' },
  videoWrap:    { position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#111', border: '2px solid #e8edf2', aspectRatio: '4/3', minHeight: 180 },
  video:        { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  videoOverlay: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#fff', fontSize: 13, fontWeight: 600 },
  spinner:      { width: 28, height: 28, border: '3px solid rgba(255,255,255,.3)', borderTop: '3px solid #fff', borderRadius: '50%', animation: 'spin .7s linear infinite' },
  bracketSvg:   { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  centerBox:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: 240, textAlign: 'center' },
  successTitle: { fontSize: 20, fontWeight: 800, color: '#1B5E20' },
  successSub:   { fontSize: 14, color: '#888' },
  detectedBadge:{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1.5px solid' },
  preview:      { width: '100%', borderRadius: 12, border: '2px solid #e8edf2', maxHeight: 280, objectFit: 'cover', display: 'block' },
  btnRow:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  retakeBtn:    { padding: '11px', background: '#f2f7f3', color: '#1B5E20', border: '1px solid #dfe8e2', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  saveBtn:      { padding: '11px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  retryBtn:     { padding: '11px 22px', background: '#e3f2fd', color: '#1565C0', border: '1px solid #bbdefb', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  stopBtn:      { padding: '10px', background: '#f9f1f1', color: '#a42f2f', border: '1px solid #f0dede', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', width: '100%' },
  errBox:       { background: '#FFEBEE', color: '#C62828', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600 },
};