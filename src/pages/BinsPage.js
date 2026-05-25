// src/pages/ScanBinPage.js
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { db, storage } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import useMediaQuery from '../hooks/useMediaQuery';

// ── Detection constants — calibrated from 78 real Sri Lankan bin images ───
const COLS            = 16;
const ROWS            = 12;
const LOCK_FRAMES     = 15;
const MIN_COVER       = 0.22;
const MIN_HEIGHT      = 0.35;
const MAX_ASPECT      = 1.8;
const MIN_QUADS       = 4;
const MIN_TEXTURE_STD = 12;   // anti-spoof: screens <3, real bins >12

// ── Bin types ─────────────────────────────────────────────────────────────
const BIN_TYPES = [
  { value: 'bin', label: 'Recycling Bin', emoji: '🗑️', color: '#2E7D32' },
];
const getBinType = v => BIN_TYPES.find(t => t.value === v);

// ── RGB → YUV — returns R,G,B too for Stage 1 pre-filter ──────────────────
function rgbToYuv(r, g, b) {
  return {
    Y:  0.299 * r + 0.587 * g + 0.114 * b,
    U: -0.169 * r - 0.331 * g + 0.500 * b + 128,
    V:  0.500 * r - 0.419 * g - 0.081 * b + 128,
    R: r, G: g, B: b,
  };
}

// ── classifyCell — TWO-STAGE FILTER ───────────────────────────────────────
function classifyCell(Y, U, V, R, G, B) {
  const isGreenDominant = G > R * 1.30 && G > B * 1.05 && G > 75;
  const isRedDominant   = R > G * 1.40 && R > B * 1.50 && R > 80;
  const isPurplish      = R > G * 0.90 && B > G * 0.90 && R < 130 && Y < 90;

  if (!isGreenDominant && !isRedDominant && !isPurplish) return null;

  if (isRedDominant &&
      Y >= 39 && Y <= 144 && U >= 101 && U <= 124 && V >= 137 && V <= 197)
    return 'bin';

  if (isGreenDominant &&
      Y >= 40 && Y <= 145 && U >= 112 && U <= 134 && V >= 88  && V <= 125)
    return 'bin';

  if (isPurplish &&
      Y >= 18 && Y <= 90  && U >= 118 && U <= 160 && V >= 108 && V <= 145)
    return 'bin';

  return null;
}

// ── detectBinInFrame ───────────────────────────────────────────────────────
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
  const counts = { bin: 0, _std: 0 };

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = col * cellW, y0 = row * cellH;
      let sumY=0, sumU=0, sumV=0, sumR=0, sumG=0, sumB=0, sumY2=0, cnt=0;
      for (let py = y0; py < Math.min(y0 + cellH, fh); py += 5) {
        for (let px = x0; px < Math.min(x0 + cellW, fw); px += 5) {
          const i = (py * fw + px) * 4;
          const yuv = rgbToYuv(data[i], data[i+1], data[i+2]);
          sumY+=yuv.Y; sumU+=yuv.U; sumV+=yuv.V;
          sumR+=yuv.R; sumG+=yuv.G; sumB+=yuv.B;
          sumY2+=yuv.Y*yuv.Y; cnt++;
        }
      }
      if (!cnt) continue;
      const c = classifyCell(sumY/cnt, sumU/cnt, sumV/cnt, sumR/cnt, sumG/cnt, sumB/cnt);
      const cellStd = cnt > 1 ? Math.sqrt(Math.max(0, sumY2/cnt - (sumY/cnt)*(sumY/cnt))) : 0;
      cells[row * COLS + col] = c;
      if (c) { counts[c]++; counts._std += cellStd; }
    }
  }

  let dominant = null, domCount = 0;
  for (const [t, n] of Object.entries(counts)) {
    if (t.startsWith('_')) continue;
    if (n > domCount) { dominant = t; domCount = n; }
  }

  if (!dominant || domCount / (COLS * ROWS) < MIN_COVER) return null;

  // Anti-spoof: reject screens and photos of bins
  const avgStd = counts._std / domCount;
  if (avgStd < MIN_TEXTURE_STD) return null;

  let minC = COLS, maxC = 0, minR = ROWS, maxR = 0;
  cells.forEach((c, i) => {
    if (c !== dominant) return;
    const col = i % COLS, row = Math.floor(i / COLS);
    if (col < minC) minC = col; if (col > maxC) maxC = col;
    if (row < minR) minR = row; if (row > maxR) maxR = row;
  });
  const spanW = maxC - minC + 1, spanH = maxR - minR + 1;
  if (spanH / ROWS < MIN_HEIGHT) return null;
  if (spanH > 0 && spanW / spanH > MAX_ASPECT) return null;

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

  const [phase,        setPhase]       = useState('camera');
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
  const photoFileRef  = useRef(null);
  const streakRef     = useRef(0);
  const candidateRef  = useRef(null);

  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    streakRef.current = 0; candidateRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const closeScanPage = useCallback(() => {
    stopCamera();
    if (typeof onCancel === 'function') { onCancel(); return; }
    if (window.history.length > 1) window.history.back();
  }, [onCancel, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

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

      video.srcObject = stream;
      await new Promise(resolve => {
        if (video.readyState >= 2) { resolve(); return; }
        video.addEventListener('loadeddata', resolve, { once: true });
        setTimeout(resolve, 3000);
      });

      try { await video.play(); } catch (_) {}

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

  useEffect(() => { startCamera(); }, []); // eslint-disable-line

  const handleSave = async () => {
    const file = photoFileRef.current;
    const targetDocId = binData?.docId || binData?.id;
    if (!file || !binId || !targetDocId) {
      setCameraErr('Cannot save: missing bin record information.'); return;
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

  const bt      = detectedType ? getBinType(detectedType) : null;
  const lockPct = Math.round(Math.min(100, (lockStreak / LOCK_FRAMES) * 100));
  const showVideo = phase === 'camera';

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

          {/* VIDEO — always in DOM, shown/hidden by CSS */}
          <div style={{ display: showVideo ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>

            {/* Status */}
            <div style={{
              ...S.statusPill,
              background:  bt ? bt.color + '18' : '#f1f8e9',
              color:       bt ? bt.color        : '#2E7D32',
              borderColor: bt ? bt.color + '55' : '#c8e6c9',
            }}>
              {status}
            </div>

            {/* Progress bar */}
            {lockStreak > 0 && lockStreak < LOCK_FRAMES && (
              <div style={S.progressWrap}>
                <div style={{ ...S.progressBar, width: lockPct + '%', background: bt?.color || '#2E7D32' }} />
              </div>
            )}

            {/* Info */}
            <div style={S.infoBox}>
              <div style={S.infoLabel}>Detects recycling bins automatically</div>
              <div style={{ fontSize: 13, color: '#556', marginTop: 6 }}>
                🔴 Red bins &nbsp;•&nbsp; 🟢 Green bins &nbsp;•&nbsp; 🟣 Purple bins
              </div>
            </div>

            {/* Video feed */}
            <div style={S.videoWrap}>
              <video ref={videoRef} autoPlay playsInline muted style={S.video} />
              {!cameraReady && (
                <div style={S.videoOverlay}>
                  <div style={S.spinner} />
                  <span>Opening camera…</span>
                </div>
              )}
              <svg style={S.bracketSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d="M5,18 L5,5 L18,5"    fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M82,5 L95,5 L95,18"   fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M5,82 L5,95 L18,95"   fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M82,95 L95,95 L95,82"  fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>

            {cameraErr && <div style={S.errBox}>{cameraErr}</div>}
            <button type="button" onClick={stopCamera} style={S.stopBtn}>⏸ Stop Camera</button>
          </div>

          {/* REVIEW */}
          {phase === 'review' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {bt && (
                <div style={{ ...S.detectedBadge, background: bt.color+'18', borderColor: bt.color+'55', color: bt.color }}>
                  <span style={{ fontSize: 22 }}>{bt.emoji}</span>
                  <div>
                    <div style={{ fontWeight: 700 }}>{bt.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.8 }}>Bin auto-detected</div>
                  </div>
                </div>
              )}
              <img src={photoPreview} alt="captured bin" style={S.preview} />
              <div style={S.btnRow}>
                <button type="button" onClick={handleRetake} style={S.retakeBtn} disabled={saving}>📷 Retake</button>
                <button type="button" onClick={handleSave}   style={S.saveBtn}   disabled={saving}>
                  {saving ? 'Saving…' : '💾 Save Photo'}
                </button>
              </div>
              {cameraErr && <div style={S.errBox}>{cameraErr}</div>}
            </div>
          )}

          {/* SUCCESS */}
          {phase === 'saved' && (
            <div style={S.centerBox}>
              <div style={{ fontSize: 64 }}>✅</div>
              <div style={S.successTitle}>Bin photo saved!</div>
              <div style={S.successSub}>Returning to bin list…</div>
            </div>
          )}

          {/* ERROR */}
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
              ? 'Review photo. Tap Save to confirm.'
              : 'Point camera at bin. Hold steady for auto-capture.'}
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
  container:    { position:'fixed', inset:0, zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' },
  overlay:      { position:'absolute', inset:0, background:'rgba(0,0,0,.55)' },
  modal:        { position:'relative', zIndex:2001, background:'#fff', borderRadius:18, boxShadow:'0 24px 80px rgba(0,0,0,.35)', width:480, maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden' },
  modalMobile:  { width:'calc(100vw - 16px)', maxHeight:'91vh', borderRadius:14 },
  header:       { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 22px', borderBottom:'1px solid #e8edf2', background:'#fafbfc', flexShrink:0 },
  title:        { margin:0, fontSize:18, fontWeight:800, color:'#1B5E20' },
  closeBtn:     { background:'none', border:'none', fontSize:22, color:'#888', cursor:'pointer', padding:'4px 8px' },
  body:         { flex:1, overflowY:'auto', padding:'16px 20px' },
  footer:       { padding:'10px 20px 14px', borderTop:'1px solid #e8edf2', background:'#fafbfc', flexShrink:0 },
  hint:         { margin:0, fontSize:12, color:'#8897a3', lineHeight:1.5 },
  statusPill:   { padding:'10px 14px', borderRadius:10, border:'1.5px solid', fontSize:13, fontWeight:700, textAlign:'center' },
  progressWrap: { height:6, background:'#e8edf2', borderRadius:3, overflow:'hidden' },
  progressBar:  { height:'100%', borderRadius:3, transition:'width .35s ease' },
  infoBox:      { background:'#f8fafb', borderRadius:10, padding:'10px 12px', border:'1px solid #e8edf2' },
  infoLabel:    { fontSize:11, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:.5 },
  videoWrap:    { position:'relative', borderRadius:12, overflow:'hidden', background:'#111', border:'2px solid #e8edf2', aspectRatio:'4/3', minHeight:180 },
  video:        { width:'100%', height:'100%', objectFit:'cover', display:'block' },
  videoOverlay: { position:'absolute', inset:0, background:'rgba(0,0,0,.5)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, color:'#fff', fontSize:13, fontWeight:600 },
  spinner:      { width:28, height:28, border:'3px solid rgba(255,255,255,.3)', borderTop:'3px solid #fff', borderRadius:'50%', animation:'spin .7s linear infinite' },
  bracketSvg:   { position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' },
  centerBox:    { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, minHeight:240, textAlign:'center' },
  successTitle: { fontSize:20, fontWeight:800, color:'#1B5E20' },
  successSub:   { fontSize:14, color:'#888' },
  detectedBadge:{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:10, border:'1.5px solid' },
  preview:      { width:'100%', borderRadius:12, border:'2px solid #e8edf2', maxHeight:280, objectFit:'cover', display:'block' },
  btnRow:       { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 },
  retakeBtn:    { padding:'11px', background:'#f2f7f3', color:'#1B5E20', border:'1px solid #dfe8e2', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer' },
  saveBtn:      { padding:'11px', background:'#2E7D32', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer' },
  retryBtn:     { padding:'11px 22px', background:'#e3f2fd', color:'#1565C0', border:'1px solid #bbdefb', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer' },
  stopBtn:      { padding:'10px', background:'#f9f1f1', color:'#a42f2f', border:'1px solid #f0dede', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', width:'100%' },
  errBox:       { background:'#FFEBEE', color:'#C62828', padding:'10px 14px', borderRadius:10, fontSize:13, fontWeight:600 },
};