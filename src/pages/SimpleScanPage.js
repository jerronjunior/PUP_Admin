import React, { useEffect, useRef, useState, useCallback } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';

export default function SimpleScanPage({ onCapture }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [status, setStatus] = useState('Point camera at the bin and capture');
  const [camErr, setCamErr] = useState('');
  const [camReady, setCamReady] = useState(false);
  const [preview, setPreview] = useState(null);
  const [autoCapture, setAutoCapture] = useState(false);
  const [progress, setProgress] = useState(0);

  const videoRef = useRef(null);
  const captureCv = useRef(document.createElement('canvas'));
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const prevFrame = useRef(null);
  const stableCount = useRef(0);

  const STOP = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    prevFrame.current = null; stableCount.current = 0;
    setCamReady(false);
  }, []);

  const captureNow = useCallback(() => {
    const v = videoRef.current;
    const c = captureCv.current;
    if (!v || !v.videoWidth) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const url = URL.createObjectURL(file);
      setPreview(url);
      setStatus('Photo captured');
      STOP();
      if (typeof onCapture === 'function') onCapture(file);
    }, 'image/jpeg', 0.9);
  }, [onCapture, STOP]);

  const startCamera = useCallback(async () => {
    setCamErr(''); setStatus('Starting camera…');
    if (!navigator.mediaDevices?.getUserMedia) { setCamErr('Camera not supported.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) { STOP(); setCamErr('Video not ready.'); return; }
      v.srcObject = stream;
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if (v.videoWidth > 0) { clearInterval(poll); setCamReady(true); setStatus('Ready — capture when steady'); }
        else if (attempts > 30) { clearInterval(poll); v.play().then(() => { setCamReady(true); setStatus('Ready — capture when steady'); }).catch(() => { setCamReady(true); setStatus('Ready — capture when steady'); }); }
      }, 100);
    } catch (err) {
      setCamErr(err.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Camera error: ' + (err.message || err.name));
    }
  }, [STOP]);

  // Simple stability check for auto-capture
  const startAutoLoop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    prevFrame.current = null; stableCount.current = 0; setProgress(0);
    intervalRef.current = setInterval(() => {
      const v = videoRef.current;
      const c = captureCv.current;
      if (!v || !v.videoWidth) return;
      c.width = 80; c.height = 60;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const frame = ctx.getImageData(0, 0, c.width, c.height).data;
      if (!prevFrame.current) { prevFrame.current = new Uint8ClampedArray(frame); return; }
      let diff = 0;
      for (let i = 0; i < frame.length; i += 4) {
        diff += Math.abs(frame[i] - prevFrame.current[i]) + Math.abs(frame[i + 1] - prevFrame.current[i + 1]) + Math.abs(frame[i + 2] - prevFrame.current[i + 2]);
      }
      prevFrame.current = new Uint8ClampedArray(frame);
      const avg = diff / (c.width * c.height);
      // lower avg means steady; tune thresholds if needed
      if (avg < 18) {
        stableCount.current++;
        setProgress(Math.min(100, (stableCount.current / 6) * 100));
        if (stableCount.current >= 6) { captureNow(); clearInterval(intervalRef.current); }
      } else {
        stableCount.current = 0; setProgress(0);
      }
    }, 300);
  }, [captureNow]);

  useEffect(() => {
    // start camera on mount
    const t = setTimeout(() => startCamera(), 80);
    return () => { clearTimeout(t); STOP(); };
  }, [startCamera, STOP]);

  useEffect(() => {
    if (autoCapture && camReady) startAutoLoop();
    if (!autoCapture && intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; setProgress(0); prevFrame.current = null; stableCount.current = 0; }
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [autoCapture, camReady, startAutoLoop]);

  const handleRetake = () => {
    if (preview) { URL.revokeObjectURL(preview); setPreview(null); }
    setStatus('Ready — capture when steady');
    setCamErr('');
    startCamera();
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#1B5E20', marginBottom: 6 }}>Scan Bin</div>
      <div style={{ color: '#666', marginBottom: 12 }}>Point your camera at the bin and capture a clear photo.</div>

      <div style={{ padding: 10, borderRadius: 10, border: '1px solid #e8edf2', marginBottom: 10 }}>
        <div style={{ padding: 10, borderRadius: 8, background: '#f1f8e9', color: '#2E7D32', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>{status}</div>
          <div style={{ minWidth: 120 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={autoCapture} onChange={e => setAutoCapture(e.target.checked)} /> Auto-capture
            </label>
          </div>
        </div>
        {autoCapture && (
          <div style={{ height: 8, background: '#eee', borderRadius: 6, marginTop: 10 }}>
            <div style={{ width: `${progress}%`, height: '100%', background: '#2E7D32', borderRadius: 6, transition: 'width .18s linear' }} />
          </div>
        )}
      </div>

      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '2px solid #e8edf2', background: '#000', height: isMobile ? 380 : 420 }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: preview ? 'none' : 'block' }} />
        {(!camReady && !preview) && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', background: 'rgba(0,0,0,0.45)', fontWeight: 700 }}>Opening camera…</div>}
        {preview && <img src={preview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}

        <div style={{ position: 'absolute', left: 12, top: 12, right: 12, display: 'flex', justifyContent: 'space-between', pointerEvents: 'none' }}>
          <div style={{ width: 48, height: 48, borderRadius: 8, border: '3px solid rgba(255,255,255,.8)' }} />
          <div style={{ width: 48, height: 48, borderRadius: 8, border: '3px solid rgba(255,255,255,.8)' }} />
        </div>

        <div style={{ position: 'absolute', right: 14, bottom: 14, display: 'flex', gap: 8 }}>
          {!preview && (
            <button onClick={captureNow} style={{ background: '#2E7D32', color: '#fff', border: 'none', padding: '12px 16px', borderRadius: 10, fontWeight: 800, cursor: 'pointer' }}>Capture</button>
          )}
          {preview && (
            <button onClick={handleRetake} style={{ background: '#f5f5f5', color: '#333', border: 'none', padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}>Retake</button>
          )}
        </div>
      </div>

      {camErr && <div style={{ marginTop: 8, background: '#FFEBEE', color: '#C62828', padding: 10, borderRadius: 8 }}>{camErr}</div>}
    </div>
  );
}
