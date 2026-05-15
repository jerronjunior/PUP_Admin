// src/pages/BinsPage.js
// ─────────────────────────────────────────────────────────────────────────────
// Full feature parity with Flutter admin bin screens:
//   manage_bins_screen.dart   → live list, edit/delete, empty state
//   bins_admin_screen.dart    → real-time Firestore stream
//   admin_add_bin_flow_screen → 2-step flow: bin type → form
//   add_bin_screen.dart       → Nominatim search, OSM map, camera capture,
//                               image upload, lat/lng, bin name, QR, save
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { db, storage } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import useMediaQuery from '../hooks/useMediaQuery';

// ── Motion-detection constants (mirrors BinImageVerificationScreen) ────────
const FRAME_W              = 96;
const FRAME_H              = 72;
const MOTION_THRESHOLD     = 16;  // avg pixel diff to count as "motion"
const STABLE_THRESHOLD     = 8;   // avg pixel diff to count as "stable"
const STABLE_FRAMES_NEEDED = 4;   // consecutive stable frames before capture

// ── Bin type options (mirrors BinType enum) ────────────────────────────────
const BIN_TYPES = [
  { value: 'coca_cola',    label: 'Coca-Cola Give Back Life', emoji: '🔴', color: '#E53935' },
  { value: 'cargills',     label: 'Cargills Food City',       emoji: '🔴', color: '#C62828' },
  { value: 'keells',       label: 'Keells Plasticcycle',      emoji: '🟢', color: '#2E7D32' },
  { value: 'eco_spindles', label: 'Eco Spindles',             emoji: '🟣', color: '#6A1B9A' },
  { value: 'unknown',      label: 'Unknown / Other',          emoji: '⚪', color: '#888'    },
];
const getBinType = v => BIN_TYPES.find(t => t.value === v) ?? BIN_TYPES[4];

const EMPTY_FORM = {
  binId: '', locationName: '', binType: 'eco_spindles',
  latitude: '', longitude: '', qrCode: '',
};

// ══════════════════════════════════════════════════════════════════════════════
// BinsPage — main list view
// ══════════════════════════════════════════════════════════════════════════════
export default function BinsPage() {
  const isMobile    = useMediaQuery('(max-width: 768px)');
  const isTinyMobile= useMediaQuery('(max-width: 400px)');

  const [bins,    setBins]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [modal,   setModal]   = useState(null); // null | {mode,bin?}
  const [deleting,setDeleting]= useState(null);

  // Live stream — mirrors FirestoreService.getAllBinsStream()
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'bins'), orderBy('createdAt', 'desc')),
      snap => { setBins(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); }
    );
    return unsub;
  }, []);

  const filtered = search
    ? bins.filter(b =>
        (b.locationName || '').toLowerCase().includes(search.toLowerCase()) ||
        (b.binId        || '').toLowerCase().includes(search.toLowerCase()))
    : bins;

  const handleDelete = async bin => {
    if (!window.confirm(`Delete "${bin.locationName}"?\nThis cannot be undone.`)) return;
    setDeleting(bin.id);
    try { await deleteDoc(doc(db, 'bins', bin.id)); }
    finally { setDeleting(null); }
  };

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ ...S.row, ...(isMobile ? { flexDirection:'column', gap:10 } : {}) }}>
        <div>
          <h1 style={{ margin:0, fontSize: isTinyMobile?20:isMobile?22:28, fontWeight:800, color:'#1B5E20' }}>
            Manage Bins
          </h1>
          <p style={{ margin:'4px 0 0', color:'#888', fontSize:13 }}>
            {bins.length} bin{bins.length!==1?'s':''} registered
          </p>
        </div>
        <button
          onClick={() => setModal({ mode:'add' })}
          style={{ ...S.addBtn, ...(isMobile?{width:'100%'}:{}) }}>
          📍 Add Bin Location
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────────── */}
      <input style={S.search}
        placeholder="🔍  Search by name or Bin ID…"
        value={search} onChange={e => setSearch(e.target.value)} />

      {/* ── Modal ──────────────────────────────────────────────────── */}
      {modal && (
        <BinModal
          mode={modal.mode}
          bin={modal.bin}
          isMobile={isMobile}
          onClose={() => setModal(null)} />
      )}

      {/* ── List ───────────────────────────────────────────────────── */}
      {loading ? (
        <p style={{ textAlign:'center', padding:60, color:'#aaa' }}>Loading bins…</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 20px' }}>
          <div style={{ fontSize:64, marginBottom:12 }}>📍</div>
          <div style={{ fontSize:20, fontWeight:700, color:'#555', marginBottom:8 }}>
            {bins.length===0 ? 'No bins added yet' : 'No matching bins'}
          </div>
          <div style={{ fontSize:14, color:'#888' }}>
            {bins.length===0
              ? 'Tap "Add Bin Location" to register your first bin'
              : 'Try a different search term'}
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {filtered.map(bin => {
            const bt = getBinType(bin.binType);
            return (
              <div key={bin.id} style={{
                display:'flex', alignItems:'flex-start', gap:14,
                background:'#fff', borderRadius:14,
                padding: isMobile?'12px 14px':'16px 20px',
                boxShadow:'0 2px 8px rgba(0,0,0,.06)', border:'1px solid #eee',
                ...(isMobile ? { flexWrap:'wrap' } : {}),
              }}>
                {/* Photo or icon */}
                {bin.photoUrl
                  ? <img src={bin.photoUrl} alt={bin.locationName}
                      style={{ width:64, height:64, borderRadius:10, objectFit:'cover',
                               flexShrink:0, border:'1px solid #ddd' }} />
                  : <div style={{ ...S.binIconBox, background:bt.color+'18', color:bt.color }}>
                      {bt.emoji}
                    </div>}

                {/* Info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:15, color:'#222', marginBottom:5 }}>
                    {bin.locationName || '—'}
                  </div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:4 }}>
                    <span style={S.idTag}>{bin.binId}</span>
                    <span style={{ ...S.typeTag, background:bt.color+'18', color:bt.color }}>
                      {bt.emoji} {bt.label}
                    </span>
                  </div>
                  <div style={{ fontSize:11, color:'#aaa', fontFamily:'monospace' }}>
                    {bin.latitude!=null && bin.longitude!=null
                      ? `${Number(bin.latitude).toFixed(6)}, ${Number(bin.longitude).toFixed(6)}`
                      : 'No coordinates set'}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display:'flex', gap:7, flexShrink:0,
                              ...(isMobile?{width:'100%',justifyContent:'flex-end'}:{}) }}>
                  <button onClick={() => setModal({ mode:'edit', bin })} style={S.editBtn}>✏️ Edit</button>
                  <button onClick={() => handleDelete(bin)} style={S.delBtn}
                    disabled={deleting===bin.id}>
                    {deleting===bin.id ? '…' : '🗑️ Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BinModal — 2-step flow mirroring admin_add_bin_flow_screen.dart
//   Step 1 (add only): bin type picker
//   Step 2: full form — search, OSM map, camera/upload, fields, save
// ══════════════════════════════════════════════════════════════════════════════
function BinModal({ mode, bin, isMobile, onClose }) {
  // Step 1 only shown when adding a new bin
  const [step, setStep] = useState(mode==='edit' ? 'form' : 'type');

  const [form,    setForm]    = useState(bin ? {
    binId:        bin.binId        || '',
    locationName: bin.locationName || '',
    binType:      bin.binType      || 'eco_spindles',
    latitude:     bin.latitude!=null ? String(bin.latitude)  : '',
    longitude:    bin.longitude!=null? String(bin.longitude) : '',
    qrCode:       bin.qrCode       || '',
  } : EMPTY_FORM);

  const [saving,      setSaving]      = useState(false);
  const [saveErr,     setSaveErr]     = useState('');
  const [photoFile,   setPhotoFile]   = useState(null);
  const [photoPreview,setPhotoPreview]= useState(bin?.photoUrl || '');
  const [existingUrl, setExistingUrl] = useState(bin?.photoUrl || '');
  const [photoErr,    setPhotoErr]    = useState('');

  // Location search
  const [searchQ,   setSearchQ]   = useState('');
  const [searching, setSearching] = useState(false);
  const [results,   setResults]   = useState([]);
  const [searchErr, setSearchErr] = useState('');
  const searchTimer = useRef(null);

  // Camera
  const [camOpen,    setCamOpen]    = useState(false);
  const [camErr,     setCamErr]     = useState('');
  const [camStatus,  setCamStatus]  = useState('');
  const videoRef       = useRef(null);
  const detectCanvas   = useRef(null);
  const captureCanvas  = useRef(null);
  const streamRef      = useRef(null);
  const intervalRef    = useRef(null);
  const prevFrame      = useRef(null);
  const stableCount    = useRef(0);
  const motionSeen     = useRef(false);
  const fileInputRef   = useRef(null);

  const update = (k,v) => setForm(f => ({ ...f, [k]:v }));

  // ── Stop camera on unmount / modal close ─────────────────────────────────
  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current=null; }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; }
    prevFrame.current=null; stableCount.current=0; motionSeen.current=false;
    setCamOpen(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── Photo file → preview URL ─────────────────────────────────────────────
  useEffect(() => {
    if (!photoFile) return;
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  // ── Location search (Nominatim — same as Flutter app) ───────────────────
  const doSearch = async q => {
    if (!q || q.length < 2) { setResults([]); return; }
    setSearching(true); setSearchErr('');
    try {
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&addressdetails=1`,
        { headers:{ 'User-Agent':'Price-ur-Plastic/1.0','Accept':'application/json' } }
      );
      const data = await res.json();
      const list = data.map(r=>({ name:r.display_name, lat:parseFloat(r.lat), lng:parseFloat(r.lon) }));
      setResults(list);
      if (!list.length) setSearchErr('No locations found');
    } catch { setSearchErr('Search failed. Check your connection.'); }
    setSearching(false);
  };

  const handleSearchInput = e => {
    setSearchQ(e.target.value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(()=>doSearch(e.target.value), 500);
  };

  const pickResult = r => {
    update('latitude',  r.lat.toFixed(6));
    update('longitude', r.lng.toFixed(6));
    setSearchQ(r.name.split(',').slice(0,2).join(', '));
    setResults([]);
  };

  // ── Camera auto-capture (mirrors BinImageVerificationScreen) ────────────
  const captureNow = () => {
    const v=videoRef.current, c=captureCanvas.current;
    if(!v||!c||!v.videoWidth) return;
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext('2d').drawImage(v,0,0,c.width,c.height);
    c.toBlob(blob=>{
      if(!blob) return;
      const f=new File([blob],`bin-${Date.now()}.jpg`,{type:'image/jpeg'});
      setPhotoFile(f); setPhotoErr('');
      setCamStatus('✅ Photo captured automatically!');
      stopCamera();
    },'image/jpeg',0.9);
  };

  const startDetectionLoop = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(()=>{
      const v=videoRef.current, c=detectCanvas.current;
      if(!v||!c||!v.videoWidth) return;
      c.width=FRAME_W; c.height=FRAME_H;
      const ctx=c.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(v,0,0,FRAME_W,FRAME_H);
      const frame=ctx.getImageData(0,0,FRAME_W,FRAME_H).data;
      if(!prevFrame.current){ prevFrame.current=new Uint8ClampedArray(frame); return; }

      let diff=0;
      for(let i=0;i<frame.length;i+=4)
        diff+=( Math.abs(frame[i]-prevFrame.current[i])
              + Math.abs(frame[i+1]-prevFrame.current[i+1])
              + Math.abs(frame[i+2]-prevFrame.current[i+2]) ) /3;
      prevFrame.current=new Uint8ClampedArray(frame);
      const avg=diff/(FRAME_W*FRAME_H);

      if(!motionSeen.current && avg>MOTION_THRESHOLD){
        motionSeen.current=true; stableCount.current=0;
        setCamStatus('🎯 Bin detected — hold steady…');
        return;
      }
      if(motionSeen.current){
        if(avg<STABLE_THRESHOLD){
          stableCount.current++;
          const rem=STABLE_FRAMES_NEEDED-stableCount.current;
          if(rem>0) setCamStatus(`Hold steady… ${rem}`);
          if(stableCount.current>=STABLE_FRAMES_NEEDED) captureNow();
        } else {
          stableCount.current=0;
        }
      }
    },350);
  };

  const startCamera = async () => {
    setCamErr(''); setCamStatus('Starting camera…');
    if(!navigator.mediaDevices?.getUserMedia){
      setCamErr('Camera not supported in this browser.'); return;
    }
    try {
      const stream=await navigator.mediaDevices.getUserMedia(
        {video:{facingMode:{ideal:'environment'}},audio:false});
      streamRef.current=stream;
      setCamOpen(true);
      if(videoRef.current){ videoRef.current.srcObject=stream; await videoRef.current.play(); }
      prevFrame.current=null; stableCount.current=0; motionSeen.current=false;
      setCamStatus('📷 Point camera at the bin…');
      startDetectionLoop();
    } catch {
      setCamOpen(false);
      setCamErr('Cannot access camera. Allow permission or upload a photo instead.');
    }
  };

  const handleFileChange = e => {
    const file=e.target.files?.[0]; if(!file) return;
    if(!file.type.startsWith('image/')){ setPhotoErr('Please choose a valid image file.'); return; }
    if(file.size>8*1024*1024){ setPhotoErr('Image must be 8MB or smaller.'); return; }
    setPhotoErr(''); setPhotoFile(file);
    stopCamera(); setCamStatus('📁 Photo selected from file');
  };

  // ── Save to Firestore (mirrors fs.addBinLocation / updateBinLocation) ───
  const handleSave = async e => {
    e.preventDefault(); setSaveErr('');
    if(!form.binId||!form.locationName){ setSaveErr('Bin ID and Location Name are required.'); return; }
    if(!form.latitude||!form.longitude){ setSaveErr('Please set a location using the search above.'); return; }
    if(!photoFile && !existingUrl){ setPhotoErr('A bin photo is required.'); return; }

    setSaving(true);
    try {
      let photoUrl = existingUrl;
      if(photoFile){
        const safeName=photoFile.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        const storageRef=ref(storage,`bin_photos/${form.binId}-${Date.now()}-${safeName}`);
        await uploadBytes(storageRef, photoFile);
        photoUrl=await getDownloadURL(storageRef);
      }

      const payload={
        binId:        form.binId,
        locationName: form.locationName,
        binType:      form.binType,
        qrCode:       form.qrCode || form.binId,
        latitude:     parseFloat(form.latitude)  || 0,
        longitude:    parseFloat(form.longitude) || 0,
        photoUrl,
      };

      if(mode==='edit' && bin?.id){
        await updateDoc(doc(db,'bins',bin.id), payload);
      } else {
        await addDoc(collection(db,'bins'),{ ...payload, createdAt:serverTimestamp() });
      }
      stopCamera(); onClose();
    } catch(err){
      setSaveErr('Save failed: '+err.message);
    } finally { setSaving(false); }
  };

  // OSM embed URL
  const mapUrl = form.latitude && form.longitude
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${
        (parseFloat(form.longitude)-.006)},${(parseFloat(form.latitude)-.004)},${
        (parseFloat(form.longitude)+.006)},${(parseFloat(form.latitude)+.004)
      }&layer=mapnik&marker=${form.latitude},${form.longitude}`
    : null;

  return (
    <div style={M.overlay} onClick={()=>{stopCamera();onClose();}}>
      <div style={{ ...M.modal, ...(isMobile?M.modalMobile:{}) }}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={M.header}>
          <div>
            <h2 style={M.title}>
              {step==='type' ? '🏷️ Select Bin Type'
               : mode==='edit' ? '✏️ Edit Bin Location'
               : '📍 Add New Bin'}
            </h2>
            {step==='form' && mode==='add' && (
              <div style={M.backLink} onClick={()=>setStep('type')}>
                ← Change bin type
              </div>
            )}
          </div>
          <button onClick={()=>{stopCamera();onClose();}} style={M.closeBtn}>✕</button>
        </div>

        {/* ── STEP 1: Bin type picker ─────────────────────────────── */}
        {step==='type' && (
          <div style={{ padding:'8px 24px 24px' }}>
            <p style={{ color:'#777', fontSize:13, marginBottom:16 }}>
              Select the type of recycling bin you are adding.
            </p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              {BIN_TYPES.filter(t=>t.value!=='unknown').map(t=>(
                <button key={t.value} style={M.typeCard}
                  onClick={()=>{ update('binType',t.value); setStep('form'); }}>
                  <div style={{ fontSize:34 }}>{t.emoji}</div>
                  <div style={{ fontWeight:700, fontSize:13, color:t.color, marginTop:8 }}>
                    {t.label}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2: Full form ───────────────────────────────────── */}
        {step==='form' && (
          <form onSubmit={handleSave} style={{ padding:'0 24px 24px' }}>

            {/* Bin type badge — mirrors widget.scannedBinType card */}
            {(() => { const bt=getBinType(form.binType); return (
              <div style={{ ...M.typeBadge, background:bt.color+'15', borderColor:bt.color+'44' }}>
                <span style={{ fontSize:22 }}>{bt.emoji}</span>
                <div>
                  <div style={{ fontSize:11, color:'#4CAF50', fontWeight:700 }}>
                    {mode==='add' ? 'Bin Type Selected' : 'Bin Type'}
                  </div>
                  <div style={{ fontWeight:700, fontSize:14, color:bt.color }}>
                    {bt.label}
                  </div>
                </div>
                {mode==='edit' && (
                  <select style={{ marginLeft:'auto', padding:'4px 8px', borderRadius:7,
                                   border:'1px solid #ddd', fontSize:13 }}
                    value={form.binType} onChange={e=>update('binType',e.target.value)}>
                    {BIN_TYPES.map(t=>(
                      <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>
                    ))}
                  </select>
                )}
              </div>
            );})()}

            {/* Basic fields */}
            <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:12, marginBottom:14 }}>
              <Fld label="Bin Name *">
                <input style={M.input} required placeholder="e.g. Main Campus Entrance"
                  value={form.locationName} onChange={e=>update('locationName',e.target.value)} />
              </Fld>
              <Fld label="Bin ID *">
                <input style={M.input} required placeholder="e.g. BIN001"
                  value={form.binId} onChange={e=>update('binId',e.target.value)} />
              </Fld>
              <Fld label="Bin Type (select)">
                <select style={M.input} value={form.binType}
                  onChange={e=>update('binType',e.target.value)}>
                  {BIN_TYPES.map(t=>(
                    <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>
                  ))}
                </select>
              </Fld>
              <Fld label="QR Code (blank = Bin ID)">
                <input style={M.input} placeholder="Optional"
                  value={form.qrCode} onChange={e=>update('qrCode',e.target.value)} />
              </Fld>
            </div>

            {/* ── Location search ──────────────────────────────────── */}
            <Fld label="🔍 Search Location (OpenStreetMap)">
              <div style={{ position:'relative' }}>
                <div style={{ display:'flex', gap:8 }}>
                  <input style={{ ...M.input, flex:1 }}
                    placeholder="Type a place, road or landmark…"
                    value={searchQ} onChange={handleSearchInput} />
                  <button type="button" style={M.searchBtn}
                    onClick={()=>doSearch(searchQ)} disabled={searching}>
                    {searching?'⟳':'🔍'}
                  </button>
                </div>
                {searchErr && <div style={{ fontSize:12, color:'#C62828', marginTop:4 }}>{searchErr}</div>}
                {results.length>0 && (
                  <div style={M.dropdown}>
                    {results.map((r,i)=>(
                      <button key={i} type="button" style={M.dropItem} onClick={()=>pickResult(r)}>
                        <span style={{ color:'#2E7D32', flexShrink:0 }}>📍</span>
                        <div>
                          <div style={{ fontSize:13, color:'#222' }}>
                            {r.name.split(',').slice(0,3).join(', ')}
                          </div>
                          <div style={{ fontSize:11, color:'#888' }}>
                            {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Fld>

            {/* ── OSM Map preview — mirrors GoogleMap widget ────────── */}
            <Fld label="🗺️ Map Preview">
              {mapUrl ? (
                <div style={M.mapWrap}>
                  <iframe title="osm-map" src={mapUrl}
                    style={{ width:'100%', height:200, border:'none', display:'block' }}
                    scrolling="no" />
                  <a href={`https://www.openstreetmap.org/?mlat=${form.latitude}&mlon=${form.longitude}&zoom=17`}
                    target="_blank" rel="noreferrer" style={M.mapLink}>
                    Open full map ↗
                  </a>
                </div>
              ) : (
                <div style={M.mapPlaceholder}>
                  Search a location above to see the map
                </div>
              )}
            </Fld>

            {/* Lat / Lng manual fields */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
              <Fld label="Latitude *">
                <input style={M.input} required type="number" step="any"
                  placeholder="e.g. 6.9271"
                  value={form.latitude} onChange={e=>update('latitude',e.target.value)} />
              </Fld>
              <Fld label="Longitude *">
                <input style={M.input} required type="number" step="any"
                  placeholder="e.g. 79.8612"
                  value={form.longitude} onChange={e=>update('longitude',e.target.value)} />
              </Fld>
            </div>

            {/* ── Bin Image Verification ──────────────────────────── */}
            {/* Mirrors BinImageVerificationScreen + auto-capture logic */}
            <div style={{ ...M.imageCard,
              borderColor: (photoPreview||existingUrl)?'#4CAF5055':'#ddd',
              background: (photoPreview||existingUrl)?'#F1F8E9':'#FAFAFA' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                <span style={{ fontSize:22 }}>
                  {(photoPreview||existingUrl) ? '✅' : '📷'}
                </span>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>Bin Image Verification</div>
                  <div style={{ fontSize:12, color:'#888' }}>
                    {(photoPreview||existingUrl)
                      ? 'Photo ready ✓'
                      : 'A bin photo is required'}
                  </div>
                </div>
              </div>

              {/* Camera auto-detect */}
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                {!camOpen ? (
                  <button type="button" style={M.camBtn} onClick={startCamera}>
                    📷 Auto-Detect &amp; Capture
                  </button>
                ) : (
                  <button type="button" style={M.camStopBtn} onClick={stopCamera}>
                    ⏹ Stop Camera
                  </button>
                )}
                <button type="button" style={M.uploadBtn}
                  onClick={()=>fileInputRef.current?.click()}>
                  📁 Upload Photo
                </button>
              </div>

              {camStatus && (
                <div style={{ fontSize:12, color: camStatus.startsWith('✅')?'#2E7D32':'#555',
                              marginBottom:6, fontWeight:500 }}>
                  {camStatus}
                </div>
              )}
              {camErr && <div style={{ fontSize:12, color:'#C62828', marginBottom:6 }}>{camErr}</div>}
              {photoErr && <div style={{ fontSize:12, color:'#C62828', marginBottom:6 }}>{photoErr}</div>}

              {/* Live camera feed */}
              {camOpen && (
                <div style={{ borderRadius:10, overflow:'hidden', border:'1px solid #ccc',
                              marginBottom:10, position:'relative' }}>
                  <video ref={videoRef} autoPlay playsInline muted
                    style={{ width:'100%', maxHeight:220, objectFit:'cover',
                             display:'block', background:'#000' }} />
                  <div style={{ position:'absolute', left:8, right:8, bottom:8,
                                background:'rgba(0,0,0,.55)', color:'#fff',
                                fontSize:12, padding:'5px 8px', borderRadius:6,
                                textAlign:'center' }}>
                    {camStatus || 'Detecting bin…'}
                  </div>
                </div>
              )}

              {/* Photo preview */}
              {(photoPreview || existingUrl) && (
                <div style={{ marginTop:8 }}>
                  <img
                    src={photoPreview || existingUrl}
                    alt="bin"
                    style={{ width:'100%', maxHeight:180, objectFit:'cover',
                             borderRadius:10, border:'1px solid #ddd', display:'block' }} />
                  <button type="button"
                    onClick={()=>{setPhotoFile(null);setPhotoPreview('');setExistingUrl('');}}
                    style={{ marginTop:8, padding:'5px 12px', background:'#FFEBEE',
                             color:'#C62828', border:'none', borderRadius:7,
                             cursor:'pointer', fontSize:12, fontWeight:700 }}>
                    ✕ Remove photo
                  </button>
                </div>
              )}

              <input ref={fileInputRef} type="file" accept="image/*"
                style={{ display:'none' }} onChange={handleFileChange} />
            </div>

            {/* Hidden canvases for motion detection */}
            <canvas ref={detectCanvas}  style={{ display:'none' }} />
            <canvas ref={captureCanvas} style={{ display:'none' }} />

            {saveErr && (
              <div style={{ background:'#FFEBEE', color:'#C62828', padding:'10px 14px',
                            borderRadius:8, fontSize:13, marginTop:14 }}>
                {saveErr}
              </div>
            )}

            {/* Footer */}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10,
                          marginTop:20, paddingTop:16, borderTop:'1px solid #f0f0f0' }}>
              <button type="button" onClick={()=>{stopCamera();onClose();}}
                style={M.cancelBtn}>Cancel</button>
              <button type="submit" style={M.saveBtn} disabled={saving}>
                {saving ? 'Saving…' : mode==='edit' ? '✓ Save Changes' : '📍 Add Bin'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────
function Fld({ label, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#666',
                      marginBottom:5, textTransform:'uppercase', letterSpacing:.4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Style tokens ──────────────────────────────────────────────────────────────
const S = {
  row:       { display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20 },
  addBtn:    { padding:'11px 22px', background:'#2E7D32', color:'#fff', border:'none',
               borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' },
  search:    { width:'100%', padding:'11px 16px', borderRadius:11, border:'1.5px solid #ddd',
               fontSize:14, marginBottom:16, boxSizing:'border-box', outline:'none' },
  binIconBox:{ width:52, height:52, borderRadius:10, display:'flex', alignItems:'center',
               justifyContent:'center', fontSize:24, flexShrink:0 },
  idTag:     { background:'#E8F5E9', color:'#2E7D32', padding:'2px 8px', borderRadius:6,
               fontSize:11, fontWeight:700 },
  typeTag:   { padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600 },
  editBtn:   { padding:'7px 14px', background:'#E3F2FD', color:'#1565C0', border:'none',
               borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700, whiteSpace:'nowrap' },
  delBtn:    { padding:'7px 14px', background:'#FFEBEE', color:'#C62828', border:'none',
               borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700, whiteSpace:'nowrap' },
};

const M = {
  overlay:     { position:'fixed', inset:0, background:'rgba(0,0,0,.50)',
                 display:'flex', alignItems:'center', justifyContent:'center',
                 zIndex:1000, padding:12 },
  modal:       { background:'#fff', borderRadius:18, width:580, maxHeight:'92vh',
                 overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,.28)' },
  modalMobile: { width:'calc(100vw - 16px)', maxHeight:'90vh', borderRadius:12 },
  header:      { display:'flex', alignItems:'flex-start', justifyContent:'space-between',
                 padding:'22px 24px 16px', borderBottom:'1px solid #f0f0f0',
                 position:'sticky', top:0, background:'#fff', zIndex:1 },
  title:       { margin:0, fontSize:19, fontWeight:800, color:'#1B5E20' },
  backLink:    { fontSize:12, color:'#2E7D32', cursor:'pointer', marginTop:3, fontWeight:600 },
  closeBtn:    { background:'none', border:'none', fontSize:18, cursor:'pointer',
                 color:'#888', padding:'4px 8px', flexShrink:0 },
  typeCard:    { background:'#FAFAFA', border:'1.5px solid #eee', borderRadius:12,
                 padding:'20px 12px', cursor:'pointer', textAlign:'center' },
  typeBadge:   { display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
                 borderRadius:10, border:'1.5px solid', marginBottom:16 },
  input:       { width:'100%', padding:'9px 12px', borderRadius:9, border:'1.5px solid #ddd',
                 fontSize:14, boxSizing:'border-box', outline:'none' },
  searchBtn:   { padding:'9px 14px', background:'#2E7D32', color:'#fff', border:'none',
                 borderRadius:9, cursor:'pointer', fontSize:16, flexShrink:0 },
  dropdown:    { position:'absolute', left:0, right:0, top:'100%', marginTop:4,
                 background:'#fff', border:'1.5px solid #ddd', borderRadius:10,
                 boxShadow:'0 8px 24px rgba(0,0,0,.12)', zIndex:50,
                 maxHeight:220, overflowY:'auto' },
  dropItem:    { display:'flex', alignItems:'flex-start', gap:8, width:'100%',
                 padding:'9px 14px', background:'none', border:'none',
                 borderBottom:'1px solid #f5f5f5', textAlign:'left', cursor:'pointer' },
  mapWrap:     { borderRadius:10, overflow:'hidden', border:'1.5px solid #ddd', marginBottom:4 },
  mapLink:     { display:'block', background:'#F1F8E9', padding:'6px 12px',
                 fontSize:12, color:'#2E7D32', fontWeight:600, textDecoration:'none',
                 textAlign:'center' },
  mapPlaceholder:{ height:100, background:'#F9F9F9', border:'1.5px dashed #ddd',
                   borderRadius:10, display:'flex', alignItems:'center',
                   justifyContent:'center', color:'#bbb', fontSize:13 },
  imageCard:   { border:'1.5px solid', borderRadius:12, padding:'16px', marginBottom:4 },
  camBtn:      { padding:'8px 14px', background:'#1565C0', color:'#fff', border:'none',
                 borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  camStopBtn:  { padding:'8px 14px', background:'#eceff1', color:'#455A64', border:'none',
                 borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  uploadBtn:   { padding:'8px 14px', background:'#fff', color:'#2E7D32',
                 border:'1.5px solid #2E7D32', borderRadius:8, cursor:'pointer',
                 fontSize:13, fontWeight:700 },
  cancelBtn:   { padding:'10px 20px', background:'#f5f5f5', border:'none',
                 borderRadius:9, cursor:'pointer', fontSize:14, fontWeight:600, color:'#555' },
  saveBtn:     { padding:'10px 26px', background:'#2E7D32', color:'#fff', border:'none',
                 borderRadius:9, cursor:'pointer', fontSize:14, fontWeight:700 },
};