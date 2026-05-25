// src/pages/ScanBinPage.js
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { db, storage } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import useMediaQuery from '../hooks/useMediaQuery';

// ── Detection constants — calibrated from 78 real bin images ──────────────
const COLS        = 16;
const ROWS        = 12;
const LOCK_FRAMES = 15;   // 15 consistent frames before confirming
const MIN_COVER   = 0.22; // bin must fill 22% of frame
const MIN_HEIGHT  = 0.35; // bin must span 35% of frame height
const MAX_ASPECT  = 1.8;
const MIN_QUADS   = 4;    // color must appear in all 4 quadrants

// Single generic bin type — no brand labels
const BIN_TYPE = { value: 'bin', label: 'Recycling Bin', emoji: '♻️', color: '#2E7D32' };

// ── RGB → YUV ─────────────────────────────────────────────────────────────
function rgbToYuv(r, g, b) {
  return {
    Y:  0.299 * r + 0.587 * g + 0.114 * b,
    U: -0.169 * r - 0.331 * g + 0.500 * b + 128,
    V:  0.500 * r - 0.419 * g - 0.081 * b + 128,
  };
}

// ── classifyCell ──────────────────────────────────────────────────────────
// Calibrated from 78 real Sri Lankan bin images.
// Pre-checks raw RGB to reject common false positives BEFORE YUV check:
//   - Keyboard/laptop:  barely-green gray (G-B only 6) → REJECTED by G>B+8
//   - Wooden desk:      yellow-brown → V too high → REJECTED
//   - Dark gray objects: G not dominant → REJECTED by G>R*1.08
function classifyCell(Y, U, V, r, g, b) {

  // ── GREEN bins (wire cage, Keells, Carekleen, Colombo Port) ────────────
  // RGB pre-check: green must be clearly dominant over blue
  // This rejects: laptops (G-B≈6), gray objects, blue objects
  if (g > b + 8 && g > r * 1.05) {
    // YUV check: Y=40-145, U=112-134, V=82-125
    if (Y >= 40 && Y <= 145 &&
        U >= 112 && U <= 134 &&
        V >= 82  && V <= 125) {
      return 'bin';
    }
  }

  // ── RED bins (Coca-Cola, Cargills) ─────────────────────────────────────
  // RGB pre-check: red clearly dominant
  if (r > g * 1.25 && r > b * 1.25) {
    if (Y >= 39 && Y <= 144 &&
        U >= 101 && U <= 124 &&
        V >= 137 && V <= 197) {
      return 'bin';
    }
  }

  // ── PURPLE bins (Eco Spindles) ─────────────────────────────────────────
  if (Y >= 18 && Y <= 90 &&
      U >= 118 && U <= 160 &&
      V >= 108 && V <= 145) {
    return 'bin';
  }

  return null;
}

// ── Bin detection ─────────────────────────────────────────────────────────
function detectBinInFrame(canvas, video) {
  const fw = video.videoWidth, fh = video.videoHeight;
  if (!fw || !fh) return false;

  canvas.width = fw; canvas.height = fh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, fw, fh);
  const { data } = ctx.getImageData(0, 0, fw, fh);

  const cellW = Math.floor(fw / COLS);
  const cellH = Math.floor(fh / ROWS);
  const cells = new Array(COLS * ROWS).fill(false);
  let binCount = 0;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = col * cellW, y0 = row * cellH;
      let sumY=0, sumU=0, sumV=0, sumR=0, sumG=0, sumB=0, cnt=0;

      for (let py = y0; py < Math.min(y0+cellH, fh); py += 5) {
        for (let px = x0; px < Math.min(x0+cellW, fw); px += 5) {
          const i = (py * fw + px) * 4;
          const ri=data[i], gi=data[i+1], bi=data[i+2];
          const { Y, U, V } = rgbToYuv(ri, gi, bi);
          sumY+=Y; sumU+=U; sumV+=V;
          sumR+=ri; sumG+=gi; sumB+=bi;
          cnt++;
        }
      }
      if (!cnt) continue;

      const isBin = classifyCell(
        sumY/cnt, sumU/cnt, sumV/cnt,
        sumR/cnt, sumG/cnt, sumB/cnt   // pass avg RGB for pre-check
      );
      if (isBin) { cells[row*COLS+col] = true; binCount++; }
    }
  }

  // Check 1: coverage
  if (binCount / (COLS*ROWS) < MIN_COVER) return false;

  // Bounding box
  let minC=COLS, maxC=0, minR=ROWS, maxR=0;
  cells.forEach((v,i) => {
    if (!v) return;
    const c=i%COLS, r=Math.floor(i/COLS);
    if(c<minC)minC=c; if(c>maxC)maxC=c;
    if(r<minR)minR=r; if(r>maxR)maxR=r;
  });
  const spanH = maxR-minR+1, spanW = maxC-minC+1;

  // Check 2: height
  if (spanH/ROWS < MIN_HEIGHT) return false;

  // Check 3: aspect ratio
  if (spanH > 0 && spanW/spanH > MAX_ASPECT) return false;

  // Check 4: all 4 quadrants
  const mC=Math.floor((minC+maxC)/2), mR=Math.floor((minR+maxR)/2);
  const quads=[[minC,minR,mC,mR],[mC,minR,maxC,mR],[minC,mR,mC,maxR],[mC,mR,maxC,maxR]];
  let filled=0;
  for (const [c0,r0,c1,r1] of quads) {
    let ok=false;
    for(let r=r0;r<=r1&&!ok;r++)
      for(let c=c0;c<=c1&&!ok;c++)
        if(cells[r*COLS+c])ok=true;
    if(ok)filled++;
  }
  if (filled < MIN_QUADS) return false;

  return true;
}

// ══════════════════════════════════════════════════════════════════════════
export default function ScanBinPage({ binId, binData, onComplete, onCancel }) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  const [phase,       setPhase]      = useState('camera');
  const [status,      setStatus]     = useState('Starting camera…');
  const [cameraReady, setCameraReady]= useState(false);
  const [cameraErr,   setCameraErr]  = useState('');
  const [lockStreak,  setLockStreak] = useState(0);
  const [photoPreview,setPhotoPreview]=useState('');
  const [saving,      setSaving]     = useState(false);

  const videoRef      = useRef(null);
  const detectCanvas  = useRef(null);
  const captureCanvas = useRef(null);
  const streamRef     = useRef(null);
  const intervalRef   = useRef(null);
  const photoFileRef  = useRef(null);
  const streakRef     = useRef(0);

  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current=null; }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; }
    streakRef.current = 0;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const closeScanPage = useCallback(() => {
    stopCamera();
    if (typeof onCancel==='function') { onCancel(); return; }
    if (window.history.length>1) window.history.back();
  }, [onCancel, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const capturePhoto = useCallback(() => {
    const v=videoRef.current, c=captureCanvas.current;
    if (!v||!c||!v.videoWidth) return;
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext('2d').drawImage(v,0,0,c.width,c.height);
    c.toBlob(blob => {
      if (!blob) return;
      const file=new File([blob],`bin-${Date.now()}.jpg`,{type:'image/jpeg'});
      photoFileRef.current=file;
      setPhotoPreview(URL.createObjectURL(file));
      stopCamera();
      setPhase('review');
      setStatus('✅ Bin captured! Review and save.');
    },'image/jpeg',0.92);
  }, [stopCamera]);

  const startDetectionLoop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    streakRef.current = 0;

    intervalRef.current = setInterval(() => {
      const v=videoRef.current, c=detectCanvas.current;
      if (!v||!c||!v.videoWidth||!v.videoHeight) return;

      const detected = detectBinInFrame(c, v);

      if (detected) {
        streakRef.current++;
        setLockStreak(streakRef.current);
        const rem = LOCK_FRAMES - streakRef.current;
        if (rem > 0) {
          setStatus(`${BIN_TYPE.emoji} Bin detected — hold steady (${rem})`);
        }
        if (streakRef.current >= LOCK_FRAMES) {
          setStatus('✅ Bin confirmed!');
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          capturePhoto();
        }
      } else {
        if (streakRef.current > 0) {
          streakRef.current = 0;
          setLockStreak(0);
          setStatus('🔍 Point camera at the recycling bin…');
        }
      }
    }, 350);
  }, [capturePhoto]);

  const startCamera = useCallback(async () => {
    setCameraErr(''); setCameraReady(false);
    setStatus('Starting camera…'); setLockStreak(0);
    setPhase('camera');

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraErr('Camera not supported in this browser.');
      setPhase('error'); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal:'environment' }, width: { ideal:1280 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { setCameraErr('Video element not ready.'); setPhase('error'); return; }
      video.srcObject = stream;
      await new Promise(resolve => {
        if (video.readyState>=2) { resolve(); return; }
        video.addEventListener('loadeddata', resolve, { once:true });
        setTimeout(resolve, 3000);
      });
      try { await video.play(); } catch(_) {}
      setCameraReady(true);
      setStatus('🔍 Point camera at the recycling bin…');
      startDetectionLoop();
    } catch(err) {
      const msg = err.name==='NotAllowedError'
        ? 'Camera permission denied. Please allow camera access.'
        : err.name==='NotFoundError'
        ? 'No camera found on this device.'
        : 'Cannot access camera: '+err.message;
      setCameraErr(msg); setPhase('error');
    }
  }, [startDetectionLoop]);

  useEffect(() => { startCamera(); }, []); // eslint-disable-line

  const handleSave = async () => {
    const file = photoFileRef.current;
    const targetDocId = binData?.docId || binData?.id;
    if (!file||!binId||!targetDocId) {
      setCameraErr('Cannot save: missing bin information.'); return;
    }
    setSaving(true);
    try {
      const sRef = ref(storage, `bin_photos/${binId}-${Date.now()}.jpg`);
      await uploadBytes(sRef, file);
      const photoUrl = await getDownloadURL(sRef);
      await updateDoc(doc(db,'bins',targetDocId), { photoUrl, binType:'bin' });
      setPhase('saved');
      setTimeout(() => onComplete?.(), 1500);
    } catch(err) {
      setCameraErr('Save failed: '+err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRetake = () => {
    setPhotoPreview(''); photoFileRef.current=null; setLockStreak(0);
    startCamera();
  };

  const lockPct   = Math.round(Math.min(100,(lockStreak/LOCK_FRAMES)*100));
  const showVideo = phase==='camera';

  return (
    <div style={S.container}>
      <div style={S.overlay} onClick={closeScanPage}/>
      <div style={{...S.modal,...(isMobile?S.modalMobile:{})}}>

        {/* Header */}
        <div style={S.header}>
          <h2 style={S.title}>📸 Scan Bin</h2>
          <button type="button" onClick={closeScanPage} style={S.closeBtn}>✕</button>
        </div>

        <div style={S.body}>

          {/* Camera view */}
          <div style={{display:showVideo?'flex':'none', flexDirection:'column', gap:12}}>

            {/* Status pill */}
            <div style={{
              ...S.statusPill,
              background: lockStreak>0 ? '#E8F5E9' : '#f1f8e9',
              color:       lockStreak>0 ? '#1B5E20' : '#2E7D32',
              borderColor: lockStreak>0 ? '#4CAF5055' : '#c8e6c9',
            }}>
              {status}
            </div>

            {/* Lock progress */}
            {lockStreak>0 && lockStreak<LOCK_FRAMES && (
              <div style={S.progressWrap}>
                <div style={{...S.progressBar, width:lockPct+'%'}}/>
              </div>
            )}

            {/* Tip box */}
            <div style={S.infoBox}>
              <div style={S.infoLabel}>How to scan</div>
              <div style={{fontSize:12, color:'#556', marginTop:4, lineHeight:1.6}}>
                Hold phone <strong>30–50 cm</strong> from the bin.<br/>
                Keep the bin centred and filling the frame.<br/>
                Detects 🔴 red &nbsp;•&nbsp; 🟢 green &nbsp;•&nbsp; 🟣 purple bins.
              </div>
            </div>

            {/* Video */}
            <div style={S.videoWrap}>
              <video ref={videoRef} autoPlay playsInline muted style={S.video}/>
              {!cameraReady && (
                <div style={S.videoOverlay}>
                  <div style={S.spinner}/>
                  <span>Opening camera…</span>
                </div>
              )}
              {/* Corner brackets */}
              <svg style={S.bracketSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d="M5,18 L5,5 L18,5"    fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="3" strokeLinecap="round"/>
                <path d="M82,5 L95,5 L95,18"   fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="3" strokeLinecap="round"/>
                <path d="M5,82 L5,95 L18,95"   fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="3" strokeLinecap="round"/>
                <path d="M82,95 L95,95 L95,82"  fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              {/* Lock indicator overlay */}
              {lockStreak>0 && lockStreak<LOCK_FRAMES && (
                <div style={S.lockOverlay}>
                  <div style={{fontSize:13, fontWeight:700}}>
                    ♻️ Bin detected — hold steady…
                  </div>
                  <div style={{...S.lockBar}}>
                    <div style={{...S.lockBarFill, width:lockPct+'%'}}/>
                  </div>
                </div>
              )}
            </div>

            {cameraErr && <div style={S.errBox}>{cameraErr}</div>}
            <button type="button" onClick={stopCamera} style={S.stopBtn}>⏸ Stop Camera</button>
          </div>

          {/* Review */}
          {phase==='review' && (
            <div style={{display:'flex', flexDirection:'column', gap:14}}>
              <div style={S.detectedBadge}>
                <span style={{fontSize:28}}>♻️</span>
                <div>
                  <div style={{fontWeight:700, fontSize:15}}>Recycling Bin</div>
                  <div style={{fontSize:12, color:'#888'}}>Auto-detected successfully</div>
                </div>
              </div>
              <img src={photoPreview} alt="bin" style={S.preview}/>
              <div style={S.btnRow}>
                <button type="button" onClick={handleRetake} style={S.retakeBtn} disabled={saving}>📷 Retake</button>
                <button type="button" onClick={handleSave}   style={S.saveBtn}   disabled={saving}>
                  {saving?'Saving…':'💾 Save Photo'}
                </button>
              </div>
              {cameraErr && <div style={S.errBox}>{cameraErr}</div>}
            </div>
          )}

          {/* Success */}
          {phase==='saved' && (
            <div style={S.centerBox}>
              <div style={{fontSize:64}}>✅</div>
              <div style={S.successTitle}>Bin photo saved!</div>
              <div style={S.successSub}>Returning to bin list…</div>
            </div>
          )}

          {/* Error */}
          {phase==='error' && (
            <div style={S.centerBox}>
              <div style={S.errBox}>{cameraErr}</div>
              <button type="button" onClick={startCamera} style={S.retryBtn}>🔄 Retry</button>
            </div>
          )}
        </div>

        <div style={S.footer}>
          <p style={S.hint}>
            {phase==='review'
              ? 'Looks good? Tap Save to confirm.'
              : 'Fill the frame with the bin and hold steady.'}
          </p>
        </div>
      </div>

      <canvas ref={detectCanvas}  style={{display:'none'}}/>
      <canvas ref={captureCanvas} style={{display:'none'}}/>
    </div>
  );
}

const S = {
  container:    {position:'fixed',inset:0,zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'},
  overlay:      {position:'absolute',inset:0,background:'rgba(0,0,0,.55)'},
  modal:        {position:'relative',zIndex:2001,background:'#fff',borderRadius:18,boxShadow:'0 24px 80px rgba(0,0,0,.35)',width:480,maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'hidden'},
  modalMobile:  {width:'calc(100vw - 16px)',maxHeight:'91vh',borderRadius:14},
  header:       {display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 22px',borderBottom:'1px solid #e8edf2',background:'#fafbfc',flexShrink:0},
  title:        {margin:0,fontSize:18,fontWeight:800,color:'#1B5E20'},
  closeBtn:     {background:'none',border:'none',fontSize:22,color:'#888',cursor:'pointer',padding:'4px 8px'},
  body:         {flex:1,overflowY:'auto',padding:'16px 20px'},
  footer:       {padding:'10px 20px 14px',borderTop:'1px solid #e8edf2',background:'#fafbfc',flexShrink:0},
  hint:         {margin:0,fontSize:12,color:'#8897a3',lineHeight:1.5},
  statusPill:   {padding:'10px 14px',borderRadius:10,border:'1.5px solid',fontSize:13,fontWeight:700,textAlign:'center',transition:'all .2s'},
  progressWrap: {height:5,background:'#e8edf2',borderRadius:3,overflow:'hidden'},
  progressBar:  {height:'100%',borderRadius:3,background:'#2E7D32',transition:'width .35s ease'},
  infoBox:      {background:'#f8fafb',borderRadius:10,padding:'10px 14px',border:'1px solid #e8edf2'},
  infoLabel:    {fontSize:11,fontWeight:700,color:'#888',textTransform:'uppercase',letterSpacing:.5},
  videoWrap:    {position:'relative',borderRadius:12,overflow:'hidden',background:'#111',border:'2px solid #e8edf2',aspectRatio:'4/3',minHeight:200},
  video:        {width:'100%',height:'100%',objectFit:'cover',display:'block'},
  videoOverlay: {position:'absolute',inset:0,background:'rgba(0,0,0,.5)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,color:'#fff',fontSize:13,fontWeight:600},
  spinner:      {width:28,height:28,border:'3px solid rgba(255,255,255,.3)',borderTop:'3px solid #fff',borderRadius:'50%',animation:'spin .7s linear infinite'},
  bracketSvg:   {position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'},
  lockOverlay:  {position:'absolute',bottom:0,left:0,right:0,background:'rgba(46,125,50,0.85)',color:'#fff',padding:'10px 14px',display:'flex',flexDirection:'column',gap:6},
  lockBar:      {height:4,background:'rgba(255,255,255,.3)',borderRadius:2,overflow:'hidden'},
  lockBarFill:  {height:'100%',background:'#fff',borderRadius:2,transition:'width .35s ease'},
  centerBox:    {display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,minHeight:240,textAlign:'center'},
  successTitle: {fontSize:20,fontWeight:800,color:'#1B5E20'},
  successSub:   {fontSize:14,color:'#888'},
  detectedBadge:{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',borderRadius:12,border:'2px solid #4CAF50',background:'#E8F5E9'},
  preview:      {width:'100%',borderRadius:12,border:'2px solid #e8edf2',maxHeight:280,objectFit:'cover',display:'block'},
  btnRow:       {display:'grid',gridTemplateColumns:'1fr 1fr',gap:10},
  retakeBtn:    {padding:'11px',background:'#f2f7f3',color:'#1B5E20',border:'1px solid #dfe8e2',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer'},
  saveBtn:      {padding:'11px',background:'#2E7D32',color:'#fff',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer'},
  retryBtn:     {padding:'11px 22px',background:'#e3f2fd',color:'#1565C0',border:'1px solid #bbdefb',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer'},
  stopBtn:      {padding:'10px',background:'#f9f1f1',color:'#a42f2f',border:'1px solid #f0dede',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',width:'100%'},
  errBox:       {background:'#FFEBEE',color:'#C62828',padding:'10px 14px',borderRadius:10,fontSize:13,fontWeight:600},
};