// src/pages/ScanBinPage.js
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { db, auth } from '../firebase';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import useMediaQuery from '../hooks/useMediaQuery';

import { COLS, ROWS, LOCK_FRAMES, MIN_COVER, MIN_HEIGHT, MAX_ASPECT, MIN_QUADS, rgbToYuv, classifyCell, detectBinInFrame, saveTrainingSample } from '../lib/binDetectionModel';
import { loadClientModel, predictCanvas, predictBlobViaServer } from '../lib/binModelClient';

// ── Bin types ─────────────────────────────────────────────────────────────
const BIN_TYPES = [
  { value: 'bin', label: 'Recycling Bin', emoji: '🗑️', color: '#2E7D32' },
];
const getBinType = v => BIN_TYPES.find(t => t.value === v);

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
  const [modelVersion, setModelVersion]= useState(process.env.REACT_APP_BIN_MODEL_VERSION || '1');

  const videoRef      = useRef(null);
  const detectCanvas  = useRef(null);
  const captureCanvas = useRef(null);
  const streamRef     = useRef(null);
  const intervalRef   = useRef(null);
  const photoFileRef  = useRef(null);
  const streakRef     = useRef(0);
  const candidateRef  = useRef(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'model_config', 'bin'),
      snap => {
        const data = snap.exists() ? snap.data() : null;
        const currentVersion = data?.currentVersion;
        if (currentVersion !== undefined && currentVersion !== null && currentVersion !== '') {
          setModelVersion(String(currentVersion));
        }
      },
      err => {
        console.warn('Failed to load model version:', err?.message || err);
      }
    );
    return unsub;
  }, []);

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
            // Before auto-capture, validate with ML model (client first, then server fallback)
            (async () => {
              setStatus('Verifying with model…');
              const v = videoRef.current, c = detectCanvas.current;
              let verified = false;
              let verificationAttempted = false;

              try {
                await loadClientModel();
                const score = await predictCanvas(c, 224);
                if (score !== null) {
                  verificationAttempted = true;
                  verified = score >= 0.8;
                }

                if (!verified && process.env.REACT_APP_BIN_DETECTOR_URL) {
                  const snap = document.createElement('canvas'); snap.width = v.videoWidth; snap.height = v.videoHeight;
                  snap.getContext('2d').drawImage(v, 0, 0, snap.width, snap.height);
                  const blob = await new Promise(r => snap.toBlob(r, 'image/jpeg', 0.9));
                  const serverScore = await predictBlobViaServer(blob, process.env.REACT_APP_BIN_DETECTOR_URL + '/detect');
                  if (serverScore !== null) {
                    verificationAttempted = true;
                    verified = serverScore >= 0.8;
                  }
                }
              } catch (e) {
                console.warn(e);
              }

              if (verified) {
                setDetectedType(result);
                setStatus(`✅ ${bt.label} confirmed!`);
                clearInterval(intervalRef.current);
                intervalRef.current = null;
                capturePhoto();
                return;
              }

              if (!verificationAttempted) {
                setStatus('Model not installed yet — using live detector.');
                setDetectedType(result);
                clearInterval(intervalRef.current);
                intervalRef.current = null;
                capturePhoto();
                return;
              }

              streakRef.current = 0; candidateRef.current = null; setLockStreak(0);
              setStatus('Validation failed — try again with a real bin.');
            })();
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
      // Attempt to get a model score from the client model (optional)
      let predictedScore = null;
      try {
        await loadClientModel();
        const c = captureCanvas.current;
        if (c) {
          const score = await predictCanvas(c, 224);
          if (score !== null) predictedScore = score;
        }
      } catch (e) {
        console.warn('Model score unavailable:', e?.message || e);
      }

      const trainingSample = await saveTrainingSample(file, detectedType || 'bin', {
        predictedLabel: detectedType || 'bin',
        predictedScore,
        binId,
        verifiedBy: auth?.currentUser?.uid || 'admin',
        modelVersion,
      });

      if (!trainingSample?.imageUrl) {
        throw new Error('Training sample upload failed.');
      }

      // Save photo URL to the bin document
      await updateDoc(doc(db, 'bins', targetDocId), {
        photoUrl: trainingSample.imageUrl,
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