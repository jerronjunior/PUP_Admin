import React, { useEffect, useState, useRef } from 'react';
import { db, storage } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import useMediaQuery from '../hooks/useMediaQuery';

const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 72;
const MOTION_THRESHOLD = 16;
const STABLE_THRESHOLD = 8;
const STABLE_FRAMES_REQUIRED = 4;

export default function ScanBinPage({ binId, binData, onComplete, onCancel }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isTinyMobile = useMediaQuery('(max-width: 360px)');

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraErr, setCameraErr] = useState('');
  const [autoStatus, setAutoStatus] = useState('Initializing camera...');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewSrc, setPhotoPreviewSrc] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef(null);
  const detectCanvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectIntervalRef = useRef(null);
  const previousFrameRef = useRef(null);
  const stableCountRef = useRef(0);
  const motionSeenRef = useRef(false);

  // Auto-start camera on mount
  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  // Cleanup when unmounting
  useEffect(() => {
    return () => {
      if (detectIntervalRef.current) clearInterval(detectIntervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Preview photo URL
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewSrc('');
      return;
    }
    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photoFile]);

  const saveCapturedPhoto = async file => {
    if (!file || !binId || !binData?.docId) return;

    setSaving(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const imageRef = ref(storage, `bin_photos/${binId}-${Date.now()}-${safeName}`);
      await uploadBytes(imageRef, file);
      const uploadedPhotoUrl = await getDownloadURL(imageRef);

      await updateDoc(doc(db, 'bins', binData.docId), { photoUrl: uploadedPhotoUrl });

      setSuccess(true);
      setTimeout(() => {
        onComplete?.();
      }, 1500);
    } catch (err) {
      setCameraErr('Failed to save photo: ' + (err.message || 'Unknown error'));
      setPhotoFile(file);
    } finally {
      setSaving(false);
    }
  };

  const stopCamera = () => {
    if (detectIntervalRef.current) {
      clearInterval(detectIntervalRef.current);
      detectIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    previousFrameRef.current = null;
    stableCountRef.current = 0;
    motionSeenRef.current = false;
    setCameraReady(false);
    setCameraOpen(false);
  };

  const attachStreamToVideo = async stream => {
    const video = videoRef.current;
    if (!video) return;

    video.srcObject = stream;

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        await video.play();
      } catch {
        // Some browsers reject play() even after a successful camera grant.
      }
      setCameraReady(true);
      return;
    }

    await new Promise(resolve => {
      let settled = false;
      const fallbackTimer = setTimeout(onReady, 1500);

      const finish = async () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        try {
          await video.play();
        } catch {
          // Ignore autoplay rejections; the stream is still attached.
        }
        setCameraReady(true);
        resolve();
      };

      function onReady() {
        video.removeEventListener('loadeddata', onReady);
        finish();
      }

      video.addEventListener('loadeddata', onReady, { once: true });
    });
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return;
      const autoFile = new File([blob], `bin-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setPhotoFile(autoFile);
      setCameraErr('');
      setAutoStatus('Uploading and saving automatically...');
      stopCamera();
      saveCapturedPhoto(autoFile);
    }, 'image/jpeg', 0.9);
  };

  const startDetectionLoop = () => {
    if (detectIntervalRef.current) clearInterval(detectIntervalRef.current);
    detectIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      const canvas = detectCanvasRef.current;
      if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;

      canvas.width = FRAME_WIDTH;
      canvas.height = FRAME_HEIGHT;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      const frame = ctx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT).data;

      if (!previousFrameRef.current) {
        previousFrameRef.current = new Uint8ClampedArray(frame);
        setAutoStatus('Detecting bin... Point camera at bin');
        return;
      }

      let diffSum = 0;
      let pixels = 0;
      for (let i = 0; i < frame.length; i += 4) {
        const diff =
          Math.abs(frame[i] - previousFrameRef.current[i]) +
          Math.abs(frame[i + 1] - previousFrameRef.current[i + 1]) +
          Math.abs(frame[i + 2] - previousFrameRef.current[i + 2]);
        diffSum += diff / 3;
        pixels += 1;
      }

      previousFrameRef.current = new Uint8ClampedArray(frame);
      const avgDiff = diffSum / Math.max(1, pixels);

      if (!motionSeenRef.current && avgDiff > MOTION_THRESHOLD) {
        motionSeenRef.current = true;
        setAutoStatus('Bin detected! Hold steady...');
        stableCountRef.current = 0;
        return;
      }

      if (motionSeenRef.current) {
        if (avgDiff < STABLE_THRESHOLD) {
          stableCountRef.current += 1;
          const remaining = STABLE_FRAMES_REQUIRED - stableCountRef.current;
          if (remaining > 0) setAutoStatus(`Hold steady... ${remaining}`);
          if (stableCountRef.current >= STABLE_FRAMES_REQUIRED) {
            captureFromCamera();
          }
        } else {
          stableCountRef.current = 0;
        }
      }
    }, 350);
  };

  const startCamera = async () => {
    setCameraErr('');
    setAutoStatus('Starting camera...');
    setCameraReady(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraErr('Camera API is not supported in this browser.');
      setAutoStatus('Camera unavailable');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);

      await attachStreamToVideo(stream);

      previousFrameRef.current = null;
      stableCountRef.current = 0;
      motionSeenRef.current = false;
      startDetectionLoop();
    } catch {
      setCameraOpen(false);
      setAutoStatus('Camera unavailable');
      setCameraErr('Could not access camera. Please check your camera permission.');
    }
  };

  const handleSavePhoto = async () => {
    await saveCapturedPhoto(photoFile);
  };

  const handleRetake = () => {
    setPhotoFile(null);
    setAutoStatus('Starting camera...');
    startCamera();
  };

  return (
    <div style={s.container}>
      <div style={s.overlay} onClick={onCancel} />

      <div style={{ ...s.modal, ...(isMobile ? s.modalMobile : {}) }}>
        <div style={s.header}>
          <h2 style={s.title}>📸 Scan Bin Photo</h2>
          <button onClick={onCancel} style={s.closeBtn}>✕</button>
        </div>

        <div style={s.content}>
          {success ? (
            <div style={s.successBox}>
              <div style={s.successIcon}>✓</div>
              <div style={s.successText}>Bin photo saved successfully!</div>
              <div style={s.successSub}>Returning to bin list...</div>
            </div>
          ) : photoFile ? (
            <div style={s.section}>
              <div style={s.sectionTitle}>Preview</div>
              <img alt="Captured bin" src={photoPreviewSrc} style={s.preview} />
              <div style={s.buttonRow}>
                <button onClick={handleRetake} style={s.retakeBtn} disabled={saving}>
                  📷 Retake Photo
                </button>
                <button onClick={handleSavePhoto} style={s.saveBtn} disabled={saving}>
                  {saving ? 'Saving…' : '✓ Save Photo'}
                </button>
              </div>
            </div>
          ) : cameraOpen ? (
            <div style={s.section}>
              <div style={s.statusBar}>{autoStatus}</div>
              <div style={s.videoWrap}>
                <video ref={videoRef} style={s.video} autoPlay playsInline muted />
                {!cameraReady && <div style={s.loadingOverlay}>Opening camera preview…</div>}
              </div>
              {cameraErr && <div style={s.error}>{cameraErr}</div>}
              <button onClick={stopCamera} style={s.stopBtn}>⏸ Stop Camera</button>
            </div>
          ) : (
            <div style={s.section}>
              <div style={s.errorMsg}>{cameraErr || autoStatus}</div>
              <button onClick={startCamera} style={s.retryBtn}>
                🔄 Retry Camera
              </button>
            </div>
          )}
        </div>

        <div style={s.footer}>
          <p style={s.hint}>
            {photoFile ? 'Review the photo. If satisfied, click Save.' : 'Point camera at the bin. Auto-detection will capture when bin is still.'}
          </p>
        </div>
      </div>
    </div>
  );
}

const s = {
  container: { position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' },
  modal: { position: 'relative', zIndex: 2001, background: '#fff', borderRadius: 18, boxShadow: '0 20px 80px rgba(0,0,0,.4)', width: 500, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  modalMobile: { width: 'calc(100vw - 20px)', maxHeight: '88vh', borderRadius: 16 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px', borderBottom: '1px solid #e8edf2', background: '#fafbfc' },
  title: { margin: 0, fontSize: 18, fontWeight: 800, color: '#1B5E20' },
  closeBtn: { background: 'none', border: 'none', fontSize: 22, color: '#888', cursor: 'pointer', padding: '4px 8px' },
  content: { flex: 1, overflow: 'auto', padding: '20px 22px' },
  section: { display: 'flex', flexDirection: 'column', gap: 14 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: .4 },
  videoWrap: { position: 'relative', width: '100%', borderRadius: 12, overflow: 'hidden', background: '#e9eef2', border: '1px solid #dfe8ee' },
  video: { width: '100%', height: 'auto', minHeight: 260, display: 'block', background: '#e9eef2', aspectRatio: '4/3', objectFit: 'cover' },
  preview: { width: '100%', height: 'auto', borderRadius: 12, border: '2px solid #e8edf2', maxHeight: 320 },
  statusBar: { background: '#f1f8e9', color: '#2E7D32', padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, textAlign: 'center' },
  loadingOverlay: { position: 'absolute', inset: 0, background: 'rgba(255,255,255,.76)', color: '#455A64', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, textAlign: 'center' },
  error: { background: '#FFEBEE', color: '#C62828', padding: '12px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600 },
  errorMsg: { background: '#FFF3CD', color: '#856404', padding: '16px', borderRadius: 10, fontSize: 14, fontWeight: 600, textAlign: 'center', lineHeight: 1.5 },
  buttonRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  stopBtn: { padding: '12px 18px', background: '#f9f1f1', color: '#a42f2f', border: '1px solid #f0dede', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  retakeBtn: { padding: '12px 18px', background: '#f2f7f3', color: '#1B5E20', border: '1px solid #dfe8e2', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  retryBtn: { padding: '12px 18px', background: '#e3f2fd', color: '#1565C0', border: '1px solid #bbdefb', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  saveBtn: { padding: '12px 18px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  successBox: { textAlign: 'center', padding: '40px 20px' },
  successIcon: { fontSize: 64, marginBottom: 16, animation: 'scaleIn .5s ease-out' },
  successText: { fontSize: 18, fontWeight: 800, color: '#1B5E20', marginBottom: 8 },
  successSub: { fontSize: 14, color: '#888' },
  footer: { padding: '12px 22px', borderTop: '1px solid #e8edf2', background: '#fafbfc' },
  hint: { margin: 0, fontSize: 12, color: '#8897a3', lineHeight: 1.5 },
};
