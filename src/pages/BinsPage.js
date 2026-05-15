// src/pages/BinsPage.js
// Mirrors manage_bins_screen.dart + add_bin_screen.dart:
//   - List all bins with binId, location name, coordinates
//   - Add new bin with location search (Nominatim OSM — free, no API key)
//   - Edit existing bin
//   - Delete bin with confirm dialog
import React, { useEffect, useState, useRef } from 'react';
import { db, storage } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import useMediaQuery from '../hooks/useMediaQuery';
import ScanBinPage from './ScanBinPage';

const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 72;
const MOTION_THRESHOLD = 16;
const STABLE_THRESHOLD = 8;
const STABLE_FRAMES_REQUIRED = 4;

const BIN_TYPES = [
  { value: 'coca_cola',    label: '🔴 Coca-Cola Give Back Life' },
  { value: 'cargills',     label: '🔴 Cargills Food City' },
  { value: 'keells',       label: '🟢 Keells Plasticcycle' },
  { value: 'eco_spindles', label: '🟣 Eco Spindles' },
  { value: 'unknown',      label: '⚪ Unknown' },
];

const EMPTY_FORM = {
  binId: '', locationName: '', binType: 'eco_spindles',
  latitude: '', longitude: '', qrCode: '',
};

export default function BinsPage() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isTinyMobile = useMediaQuery('(max-width: 360px)');
  const [bins,     setBins]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState(null); // bin doc id
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrl,  setPhotoUrl]  = useState('');
  const [photoPreviewSrc, setPhotoPreviewSrc] = useState('');
  const [photoErr,  setPhotoErr]  = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraErr, setCameraErr] = useState('');
  const [autoStatus, setAutoStatus] = useState('Camera idle');
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [scanningBin, setScanningBin] = useState(null);

  // Location search (Nominatim — same as OSM/flutter_map, free)
  const [searchQ,   setSearchQ]   = useState('');
  const [searching, setSearching] = useState(false);
  const [results,   setResults]   = useState([]);
  const searchTimer = useRef(null);
  const videoRef = useRef(null);
  const detectCanvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectIntervalRef = useRef(null);
  const previousFrameRef = useRef(null);
  const stableCountRef = useRef(0);
  const motionSeenRef = useRef(false);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'bins'), orderBy('createdAt', 'desc')),
      snap => {
        setBins(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      }
    );
  }, []);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewSrc('');
      return;
    }

    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photoFile]);

  useEffect(() => {
    if (!showForm) {
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
      setCameraOpen(false);
      setCameraErr('');
      setAutoStatus('Camera idle');
    }
  }, [showForm]);

  // Debounced location search using Nominatim (free, no key)
  useEffect(() => {
    if (searchQ.length < 3) { setResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQ)}&format=json&limit=5`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setResults(data.map(r => ({
          name: r.display_name,
          lat:  parseFloat(r.lat),
          lng:  parseFloat(r.lon),
        })));
      } catch { setResults([]); }
      setSearching(false);
    }, 500);
  }, [searchQ]);

  const pickLocation = loc => {
    setForm(f => ({ ...f, latitude: loc.lat.toFixed(6), longitude: loc.lng.toFixed(6) }));
    setSearchQ(loc.name.split(',')[0]);
    setResults([]);
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
        // Some browsers reject play() even when the camera stream is attached.
      }
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
          // Ignore autoplay rejections and continue with the attached stream.
        }
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
      const safeName = autoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const imageRef = ref(storage, `bin_photos/${form.binId || 'bin'}-${Date.now()}-${safeName}`);

      setPhotoFile(autoFile);
      setPhotoErr('');
      setCameraErr('');
      setAutoStatus('Uploading scanned photo...');

      uploadBytes(imageRef, autoFile)
        .then(() => getDownloadURL(imageRef))
        .then(uploadedPhotoUrl => {
          setPhotoUrl(uploadedPhotoUrl);
          setAutoStatus('Captured and added automatically');
          stopCamera();
        })
        .catch(err => {
          setCameraErr('Failed to upload captured photo: ' + (err.message || 'Unknown error'));
          setAutoStatus('Capture ready, upload failed');
        });
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
        setAutoStatus('Detecting bin... point camera at bin');
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
        setAutoStatus('Bin detected. Hold steady...');
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
      setCameraErr('Could not access camera. Allow camera permission or upload a photo manually.');
    }
  };

  const openAdd = () => {
    stopCamera();
    setEditing(null); setForm(EMPTY_FORM); setShowForm(true);
    setPhotoFile(null); setPhotoUrl(''); setPhotoErr('');
    setCameraErr(''); setAutoStatus('Camera idle');
    setSearchQ(''); setResults([]);
  };

  const openScan = bin => {
    setScanningBin({ ...bin, docId: bin.id });
  };

  const openEdit = bin => {
    stopCamera();
    setEditing(bin.id);
    setForm({
      binId:        bin.binId        || '',
      locationName: bin.locationName || '',
      binType:      bin.binType      || 'eco_spindles',
      latitude:     bin.latitude     != null ? String(bin.latitude)  : '',
      longitude:    bin.longitude    != null ? String(bin.longitude) : '',
      qrCode:       bin.qrCode       || '',
    });
    setPhotoFile(null);
    setPhotoUrl(bin.photoUrl || '');
    setPhotoErr('');
    setCameraErr(''); setAutoStatus('Camera idle');
    setSearchQ(''); setResults([]);
    setShowForm(true);
  };

  const handlePhotoChange = e => {
    const file = e.target.files?.[0];
    if (!file) {
      setPhotoFile(null);
      setPhotoUrl('');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setPhotoErr('Please choose a valid image file.');
      setPhotoFile(null);
      return;
    }

    const maxSize = 8 * 1024 * 1024;
    if (file.size > maxSize) {
      setPhotoErr('Image must be 8MB or less.');
      setPhotoFile(null);
      return;
    }

    setPhotoErr('');
    setPhotoFile(file);
    setPhotoUrl('');
    stopCamera();
    setAutoStatus('Photo selected');
  };

  const handleSave = async e => {
    e.preventDefault();
    if (!form.binId || !form.locationName) return;

    if (!photoFile && !photoUrl) {
      setPhotoErr('Bin photo is mandatory. Please add a photo before saving.');
      return;
    }

    setSaving(true);
    try {
      let uploadedPhotoUrl = photoUrl;

      if (photoFile && !photoUrl) {
        const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const imageRef = ref(storage, `bin_photos/${form.binId}-${Date.now()}-${safeName}`);
        await uploadBytes(imageRef, photoFile);
        uploadedPhotoUrl = await getDownloadURL(imageRef);
      }

      const payload = {
        binId:        form.binId,
        locationName: form.locationName,
        binType:      form.binType,
        qrCode:       form.qrCode || form.binId,
        latitude:     parseFloat(form.latitude)  || 0,
        longitude:    parseFloat(form.longitude) || 0,
        photoUrl:     uploadedPhotoUrl,
      };
      if (editing) {
        await updateDoc(doc(db, 'bins', editing), payload);
      } else {
        await addDoc(collection(db, 'bins'), {
          ...payload, createdAt: serverTimestamp(),
        });
      }
      setShowForm(false);
      setPhotoFile(null);
      setPhotoUrl('');
      setPhotoErr('');
      stopCamera();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async id => {
    setDeleting(id);
    if (!window.confirm('Delete this bin? This cannot be undone.')) {
      setDeleting(null); return;
    }
    await deleteDoc(doc(db, 'bins', id));
    setDeleting(null);
  };

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      <div style={{ ...s.pageHeader, ...(isMobile ? s.pageHeaderMobile : {}) }}>
        <div>
          <h1 style={{ ...s.h1, ...(isMobile ? s.h1Mobile : {}), ...(isTinyMobile ? s.h1Tiny : {}) }}>Manage Bins</h1>
          <p style={s.sub}>{bins.length} bin{bins.length !== 1 ? 's' : ''} registered</p>
        </div>
        <button onClick={openAdd} style={{ ...s.addBtn, ...(isMobile ? s.addBtnMobile : {}) }}>＋ Add Bin Location</button>
      </div>

      {/* ── Form modal ─────────────────────────────────────────────── */}
      {showForm && (
        <div style={s.overlay} onClick={() => { stopCamera(); setShowForm(false); }}>
          <div style={{ ...s.modal, ...(isMobile ? s.modalMobile : {}) }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>{editing ? '✏️ Edit Bin' : '📍 Add New Bin'}</h2>
              <button onClick={() => { stopCamera(); setShowForm(false); }} style={s.closeBtn}>✕</button>
            </div>

            <form onSubmit={handleSave}>
              <div style={{ ...s.formGrid, ...(isMobile ? s.formGridMobile : {}) }}>
                {/* Bin ID */}
                <Field label="Bin ID *">
                  <input style={s.input} required value={form.binId}
                    onChange={e => update('binId', e.target.value)}
                    placeholder="e.g. BIN001" />
                </Field>

                {/* Location Name */}
                <Field label="Location Name *">
                  <input style={s.input} required value={form.locationName}
                    onChange={e => update('locationName', e.target.value)}
                    placeholder="e.g. Main Campus Entrance" />
                </Field>

                {/* Bin Type */}
                <Field label="Bin Type">
                  <select style={s.input} value={form.binType}
                    onChange={e => update('binType', e.target.value)}>
                    {BIN_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </Field>

                {/* QR Code */}
                <Field label="QR Code (leave blank = same as Bin ID)">
                  <input style={s.input} value={form.qrCode}
                    onChange={e => update('qrCode', e.target.value)}
                    placeholder="Optional" />
                </Field>
              </div>

              {/* Bin photo upload */}
              <Field label="Bin Photo *">
                <div style={s.cameraActionRow}>
                  <button type="button" style={s.cameraBtn} onClick={startCamera}>
                    📷 Detect + Auto Capture
                  </button>
                  {cameraOpen && (
                    <button type="button" style={s.cameraStopBtn} onClick={stopCamera}>
                      Stop Camera
                    </button>
                  )}
                </div>
                <div style={s.fileHint}>{autoStatus}</div>
                {cameraErr && <div style={s.fileError}>{cameraErr}</div>}

                {cameraOpen && (
                  <div style={s.cameraPreviewWrap}>
                    <video ref={videoRef} style={s.cameraPreview} autoPlay playsInline muted />
                    <div style={s.cameraOverlay}>Auto-detecting bin. Hold camera steady.</div>
                  </div>
                )}

                <input
                  style={s.fileInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoChange}
                />
                <div style={s.fileHint}>Take or upload a clear photo of the bin. This is required.</div>
                {photoErr && <div style={s.fileError}>{photoErr}</div>}
                {(photoFile || photoUrl) && (
                  <div style={s.photoPreviewWrap}>
                    <img
                      alt="Bin preview"
                      style={s.photoPreview}
                      src={photoFile ? photoPreviewSrc : photoUrl}
                    />
                  </div>
                )}
              </Field>

              {/* Location search */}
              <Field label="Search Location (OpenStreetMap)">
                <div style={{ position: 'relative' }}>
                  <input style={s.input} value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                    placeholder="Type to search address…" />
                  {searching && <div style={s.searchingMsg}>Searching…</div>}
                  {results.length > 0 && (
                    <div style={s.dropdown}>
                      {results.map((r, i) => (
                        <button key={i} type="button" style={s.dropdownItem}
                          onClick={() => pickLocation(r)}>
                          📍 {r.name.slice(0, 80)}{r.name.length > 80 ? '…' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              {/* Manual lat/lng */}
              <div style={{ ...s.latLngGrid, ...(isMobile ? s.latLngGridMobile : {}) }}>
                <Field label="Latitude *">
                  <input style={s.input} required type="number" step="any"
                    value={form.latitude} onChange={e => update('latitude', e.target.value)}
                    placeholder="e.g. 6.9271" />
                </Field>
                <Field label="Longitude *">
                  <input style={s.input} required type="number" step="any"
                    value={form.longitude} onChange={e => update('longitude', e.target.value)}
                    placeholder="e.g. 79.8612" />
                </Field>
              </div>

              {/* Map preview link */}
              {form.latitude && form.longitude && (
                <div style={s.mapPreview}>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${form.latitude}&mlon=${form.longitude}&zoom=16`}
                    target="_blank" rel="noreferrer" style={s.mapLink}>
                    🗺️ Preview on OpenStreetMap ↗
                  </a>
                </div>
              )}

              <div style={s.modalFooter}>
                <button type="button" onClick={() => { stopCamera(); setShowForm(false); }} style={s.cancelBtn}>
                  Cancel
                </button>
                <button type="submit" style={s.saveBtn} disabled={saving}>
                  {saving ? 'Saving…' : editing ? '✓ Save Changes' : '＋ Add Bin'}
                </button>
              </div>
            </form>
            <canvas ref={detectCanvasRef} style={{ display: 'none' }} />
            <canvas ref={captureCanvasRef} style={{ display: 'none' }} />
          </div>
        </div>
      )}

      {/* ── Bins list ─────────────────────────────────────────────── */}
      {loading ? <div style={s.loading}>Loading bins…</div> : (
        bins.length === 0 ? (
          <div style={s.empty}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>📍</div>
            <div style={s.emptyTitle}>No bins added yet</div>
            <div style={s.emptySub}>Tap "Add Bin Location" to register your first bin</div>
          </div>
        ) : (
          <div style={s.list}>
            {bins.map(b => {
              const binTypeMeta = BIN_TYPES.find(t => t.value === b.binType);
              return (
                <div key={b.id} style={{ ...s.binCard, ...(isMobile ? s.binCardMobile : {}) }}>
                  {b.photoUrl
                    ? <img src={b.photoUrl} alt={b.locationName || 'Bin'} style={s.binPhoto} />
                    : <div style={s.binIcon}>📍</div>}
                  <div style={{ flex: 1 }}>
                    <div style={s.binName}>{b.locationName}</div>
                    <div style={{ ...s.binMeta, ...(isMobile ? s.binMetaMobile : {}) }}>
                      <span style={s.binTag}>{b.binId}</span>
                      {binTypeMeta && <span style={s.typePill}>{binTypeMeta.label}</span>}
                    </div>
                    <div style={s.binCoords}>
                      {b.latitude != null && b.longitude != null
                        ? `${Number(b.latitude).toFixed(5)}, ${Number(b.longitude).toFixed(5)}`
                        : 'No coordinates'}
                    </div>
                  </div>
                  <div style={{ ...s.binActions, ...(isMobile ? s.binActionsMobile : {}) }}>
                    <button onClick={() => openScan(b)} style={s.scanBtn}>📸 Scan</button>
                    <button onClick={() => openEdit(b)} style={s.editBtn}>✏️ Edit</button>
                    <button onClick={() => handleDelete(b.id)} style={s.delBtn}
                      disabled={deleting === b.id}>
                      {deleting === b.id ? '…' : '🗑️'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {scanningBin && (
        <ScanBinPage
          binId={scanningBin.binId}
          binData={scanningBin}
          onComplete={() => setScanningBin(null)}
          onCancel={() => setScanningBin(null)}
        />
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 5, textTransform: 'uppercase', letterSpacing: .4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const s = {
  pageHeader:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  pageHeaderMobile: { flexDirection: 'column', gap: 10, marginBottom: 16 },
  h1:           { margin: 0, fontSize: 28, fontWeight: 800, color: '#1B5E20' },
  h1Mobile:     { fontSize: 24 },
  h1Tiny:       { fontSize: 21 },
  sub:          { margin: '4px 0 0', color: '#888', fontSize: 14 },
  addBtn:       { padding: '10px 20px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  addBtnMobile: { width: '100%' },
  overlay:      { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:        { background: '#fff', borderRadius: 16, padding: '28px 28px 20px', width: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' },
  modalMobile:  { width: 'calc(100vw - 20px)', maxHeight: '86vh', padding: '18px 14px 14px', borderRadius: 12 },
  modalHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  modalTitle:   { margin: 0, fontSize: 20, fontWeight: 800, color: '#1B5E20' },
  closeBtn:     { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888', padding: '4px 8px' },
  formGrid:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  formGridMobile: { gridTemplateColumns: '1fr', gap: 10 },
  latLngGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  latLngGridMobile: { gridTemplateColumns: '1fr', gap: 10 },
  input:        { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1.5px solid #ddd', fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  cameraActionRow:{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  cameraBtn:    { padding: '8px 12px', background: '#1565C0', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  cameraStopBtn:{ padding: '8px 12px', background: '#eceff1', color: '#455A64', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  cameraPreviewWrap:{ marginBottom: 8, borderRadius: 10, overflow: 'hidden', border: '1px solid #d9e3e8', position: 'relative' },
  cameraPreview:{ width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block', background: '#000' },
  cameraOverlay:{ position: 'absolute', left: 8, right: 8, bottom: 8, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 12, padding: '6px 8px', borderRadius: 7, textAlign: 'center' },
  fileInput:    { width: '100%', padding: '8px 0', fontSize: 14, color: '#333' },
  fileHint:     { fontSize: 12, color: '#6f7d88', marginTop: 4 },
  fileError:    { fontSize: 12, color: '#C62828', marginTop: 6, fontWeight: 600 },
  photoPreviewWrap: { marginTop: 10, borderRadius: 10, overflow: 'hidden', border: '1px solid #e6ecef', width: 180, height: 120, background: '#f7faf9' },
  photoPreview: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  dropdown:     { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1.5px solid #ddd', borderRadius: 10, boxShadow: '0 6px 20px rgba(0,0,0,.12)', zIndex: 100, maxHeight: 200, overflowY: 'auto' },
  dropdownItem: { display: 'block', width: '100%', padding: '10px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, color: '#333', borderBottom: '1px solid #f0f0f0' },
  searchingMsg: { position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#888' },
  mapPreview:   { background: '#F1F8E9', borderRadius: 8, padding: '8px 12px', marginBottom: 14 },
  mapLink:      { color: '#2E7D32', fontSize: 13, fontWeight: 600, textDecoration: 'none' },
  modalFooter:  { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0f0f0' },
  cancelBtn:    { padding: '10px 20px', background: '#f5f5f5', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#555' },
  saveBtn:      { padding: '10px 24px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  loading:      { textAlign: 'center', color: '#aaa', padding: 60 },
  empty:        { textAlign: 'center', padding: '60px 20px' },
  emptyTitle:   { fontSize: 20, fontWeight: 700, color: '#555', marginBottom: 8 },
  emptySub:     { fontSize: 14, color: '#888' },
  list:         { display: 'flex', flexDirection: 'column', gap: 12 },
  binCard:      { display: 'flex', alignItems: 'center', gap: 16, background: '#fff', borderRadius: 14, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,.06)', border: '1px solid #eee' },
  binCardMobile:{ flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '14px 12px' },
  binIcon:      { fontSize: 28, flexShrink: 0 },
  binPhoto:     { width: 68, height: 68, objectFit: 'cover', borderRadius: 10, flexShrink: 0, border: '1px solid #e3eaee' },
  binName:      { fontWeight: 700, fontSize: 16, color: '#222', marginBottom: 4 },
  binMeta:      { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 },
  binMetaMobile:{ flexWrap: 'wrap' },
  binTag:       { background: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
  typePill:     { background: '#F3E5F5', color: '#6A1B9A', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 },
  binCoords:    { fontSize: 12, color: '#888', fontFamily: 'monospace' },
  binActions:   { display: 'flex', gap: 8, flexShrink: 0 },
  binActionsMobile: { width: '100%', justifyContent: 'flex-end' },
  scanBtn:      { padding: '7px 12px', background: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  editBtn:      { padding: '7px 14px', background: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  delBtn:       { padding: '7px 12px', background: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 },
};
