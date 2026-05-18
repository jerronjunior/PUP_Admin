// src/pages/BinsPage.js
// ─────────────────────────────────────────────────────────────────────────────
// Mirrors all Flutter admin bin screens:
//
// FLOW (add new bin):
//   Step 1 → ScanBinScreen   — camera detects bin color/type (YUV analysis)
//   Step 2 → AddBinScreen    — location search + OSM map + name + lat/lng
//   Step 3 → BinImageVerificationScreen — camera captures bin photo
//
// FLOW (edit existing bin):
//   → AddBinScreen directly (skip scan step)
//
// Manage Bins list:
//   → Live Firestore stream, edit/delete with confirm dialog
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { db, storage } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import useMediaQuery from '../hooks/useMediaQuery';

// ════════════════════════════════════════════════════════════════════════════
// YUV BIN DETECTION (mirrors scan_bin_screen.dart _BinDetector)
// ════════════════════════════════════════════════════════════════════════════
const COLS=16,ROWS=12,LOCK_FRAMES=8,MIN_COVER=0.15,MIN_HEIGHT=0.30,MAX_ASPECT=1.8,MIN_QUADS=3;

const BIN_TYPES = [
  { value:'coca_cola',    label:'Coca-Cola Give Back Life', emoji:'🔴', color:'#E53935' },
  { value:'cargills',     label:'Cargills Food City',       emoji:'🔴', color:'#C62828' },
  { value:'keells',       label:'Keells Plasticcycle',      emoji:'🟢', color:'#2E7D32' },
  { value:'eco_spindles', label:'Eco Spindles',             emoji:'🟣', color:'#6A1B9A' },
];
const getBT = v => BIN_TYPES.find(t=>t.value===v) || BIN_TYPES[0];

function yuv(r,g,b){return{Y:0.299*r+0.587*g+0.114*b,U:-0.169*r-0.331*g+0.500*b+128,V:0.500*r-0.419*g-0.081*b+128};}
function classifyCell(Y,U,V){
  if(Y>=40&&Y<=130&&V>=150&&V<=220&&U>=70 &&U<=122)return'coca_cola';
  if(Y>=40&&Y<=145&&V>=80 &&V<=132&&U>=132&&U<=195)return'keells';
  if(Y>=18&&Y<=90 &&V>=102&&V<=140&&U>=122&&U<=165)return'eco_spindles';
  return null;
}
function detectBinColor(canvas,video){
  const fw=video.videoWidth,fh=video.videoHeight;
  if(!fw||!fh)return null;
  canvas.width=fw;canvas.height=fh;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(video,0,0,fw,fh);
  const{data}=ctx.getImageData(0,0,fw,fh);
  const cw=Math.floor(fw/COLS),ch=Math.floor(fh/ROWS);
  const cells=new Array(COLS*ROWS).fill(null);
  const counts={coca_cola:0,keells:0,eco_spindles:0};
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
    let sY=0,sU=0,sV=0,n=0;
    for(let y=r*ch;y<Math.min((r+1)*ch,fh);y+=5)
      for(let x=c*cw;x<Math.min((c+1)*cw,fw);x+=5){
        const i=(y*fw+x)*4,{Y,U,V}=yuv(data[i],data[i+1],data[i+2]);
        sY+=Y;sU+=U;sV+=V;n++;
      }
    if(!n)continue;
    const t=classifyCell(sY/n,sU/n,sV/n);
    cells[r*COLS+c]=t;if(t)counts[t]++;
  }
  let dom=null,domN=0;
  for(const[t,n]of Object.entries(counts))if(n>domN){dom=t;domN=n;}
  if(!dom||domN/(COLS*ROWS)<MIN_COVER)return null;
  let minC=COLS,maxC=0,minR=ROWS,maxR=0;
  cells.forEach((t,i)=>{if(t!==dom)return;const c=i%COLS,r=Math.floor(i/COLS);if(c<minC)minC=c;if(c>maxC)maxC=c;if(r<minR)minR=r;if(r>maxR)maxR=r;});
  const sW=maxC-minC+1,sH=maxR-minR+1;
  if(sH/ROWS<MIN_HEIGHT||sH>0&&sW/sH>MAX_ASPECT)return null;
  const mC=Math.floor((minC+maxC)/2),mR=Math.floor((minR+maxR)/2);
  let filled=0;
  for(const[c0,r0,c1,r1]of[[minC,minR,mC,mR],[mC,minR,maxC,mR],[minC,mR,mC,maxR],[mC,mR,maxC,maxR]]){
    let ok=false;for(let r=r0;r<=r1&&!ok;r++)for(let c=c0;c<=c1&&!ok;c++)if(cells[r*COLS+c]===dom)ok=true;if(ok)filled++;
  }
  return filled>=MIN_QUADS?dom:null;
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 1 — ScanBinStep (mirrors ScanBinScreen + AdminAddBinFlowScreen Step 1)
// Camera opens, scans for bin color, locks after 8 frames, auto-proceeds
// ════════════════════════════════════════════════════════════════════════════
function ScanBinStep({ onDetected, onCancel }) {
  const [status,    setStatus]    = useState('Starting camera…');
  const [camErr,    setCamErr]    = useState('');
  const [streak,    setStreak]    = useState(0);
  const [candidate, setCandidate] = useState(null);
  const [camReady,  setCamReady]  = useState(false);

  const videoRef    = useRef(null);
  const canvasRef   = useRef(document.createElement('canvas'));
  const streamRef   = useRef(null);
  const timerRef    = useRef(null);
  const streakR     = useRef(0);
  const candidateR  = useRef(null);
  const startedRef  = useRef(false);

  const stop = useCallback(()=>{
    clearInterval(timerRef.current);timerRef.current=null;
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;}
    if(videoRef.current)videoRef.current.srcObject=null;
    setCamReady(false);
  },[]);

  useEffect(()=>()=>stop(),[stop]);

  const startLoop = useCallback(()=>{
    clearInterval(timerRef.current);
    streakR.current=0;candidateR.current=null;
    timerRef.current=setInterval(()=>{
      const v=videoRef.current,c=canvasRef.current;
      if(!v||!v.videoWidth)return;
      const result=detectBinColor(c,v);
      if(result){
        if(result===candidateR.current){
          streakR.current++;setStreak(streakR.current);setCandidate(result);
          const bt=getBT(result),rem=LOCK_FRAMES-streakR.current;
          setStatus(rem>0?`${bt.emoji} ${bt.label} — hold steady (${rem})`:`✅ ${bt.label} confirmed!`);
          if(streakR.current>=LOCK_FRAMES){
            const v = videoRef.current;
            const c = document.createElement('canvas');
            if(v && v.videoWidth) {
              c.width = v.videoWidth; c.height = v.videoHeight;
              c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
              c.toBlob(blob => {
                const file = new File([blob], `bin-${Date.now()}.jpg`, {type: 'image/jpeg'});
                clearInterval(timerRef.current); stop(); onDetected(result, file);
              }, 'image/jpeg', 0.92);
            } else {
              clearInterval(timerRef.current); stop(); onDetected(result, null);
            }
          }
        }else{candidateR.current=result;streakR.current=1;setStreak(1);setCandidate(result);setStatus(`${getBT(result).emoji} ${getBT(result).label} — hold steady…`);}
      }else{
        if(streakR.current>0){streakR.current=0;candidateR.current=null;setStreak(0);setCandidate(null);setStatus('🔍 Point camera at the bin…');}
      }
    },350);
  },[stop,onDetected]);

  const startCamera=useCallback(async()=>{
    if(startedRef.current)return;startedRef.current=true;
    setCamErr('');setStatus('Starting camera…');setCamReady(false);
    if(!navigator.mediaDevices?.getUserMedia){setCamErr('Camera not supported.');startedRef.current=false;return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      streamRef.current=stream;
      const v=videoRef.current;
      if(!v){stop();setCamErr('Video not ready.');startedRef.current=false;return;}
      v.srcObject=stream;
      let attempts=0;
      const poll=setInterval(()=>{
        attempts++;
        if(v.videoWidth>0){clearInterval(poll);setCamReady(true);setStatus('🔍 Point camera at the bin…');startLoop();}
        else if(attempts>30){clearInterval(poll);v.play().then(()=>{setCamReady(true);startLoop();}).catch(()=>{setCamReady(true);startLoop();});}
      },100);
    }catch(err){
      const msg=err.name==='NotAllowedError'?'Camera permission denied.':err.name==='NotFoundError'?'No camera found.':'Camera error: '+err.message;
      setCamErr(msg);startedRef.current=false;
    }
  },[stop,startLoop]);

  useEffect(()=>{const t=setTimeout(()=>startCamera(),100);return()=>clearTimeout(t);},[]);

  const bt=candidate?getBT(candidate):null;
  const pct=Math.min(100,(streak/LOCK_FRAMES)*100);

  return(
    <div style={M.stepWrap}>
      <div style={M.stepTitle}>Step 1 of 2 — Scan Bin</div>
      <div style={M.stepSub}>Point camera at the recycling bin to detect its type automatically</div>

      {/* Status */}
      <div style={{...M.statusPill,background:bt?bt.color+'18':'#f1f8e9',color:bt?bt.color:'#2E7D32',borderColor:bt?bt.color+'55':'#c8e6c9'}}>
        {status}
      </div>

      {/* Progress */}
      {streak>0&&streak<LOCK_FRAMES&&(
        <div style={M.progWrap}><div style={{...M.progBar,width:pct+'%',background:bt?.color||'#2E7D32'}}/></div>
      )}

      {/* Bin type guide */}
      <div style={M.guideBox}>
        <div style={M.guideLabel}>Detects automatically:</div>
        <div style={M.guideGrid}>
          {BIN_TYPES.map(t=>(
            <div key={t.value} style={{...M.guideItem,borderColor:candidate===t.value?t.color:'#eee',background:candidate===t.value?t.color+'18':'#fafafa'}}>
              <span style={{fontSize:20}}>{t.emoji}</span>
              <span style={{fontSize:10,color:'#555',textAlign:'center',lineHeight:1.2}}>{t.label.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Video */}
      <div style={M.vidBox}>
        <video ref={videoRef} autoPlay playsInline muted style={M.vid}/>
        {!camReady&&<div style={M.vidOverlay}><div style={M.spin}/><span>Opening camera…</span></div>}
        <div style={{...M.corner,top:10,left:10,borderRight:'none',borderBottom:'none'}}/>
        <div style={{...M.corner,top:10,right:10,borderLeft:'none',borderBottom:'none'}}/>
        <div style={{...M.corner,bottom:10,left:10,borderRight:'none',borderTop:'none'}}/>
        <div style={{...M.corner,bottom:10,right:10,borderLeft:'none',borderTop:'none'}}/>
      </div>

      {camErr&&<div style={M.errBox}>{camErr}<button onClick={()=>{startedRef.current=false;startCamera();}} style={M.retryBtn}>Retry</button></div>}

      <div style={M.hint}>Hold the camera steady in front of the bin. Auto-detects 🔴 🟢 🟣</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 2 — AddBinFormStep (mirrors AddBinScreen)
// Location search (Nominatim), OSM iframe map, bin name, lat/lng
// ════════════════════════════════════════════════════════════════════════════
function AddBinFormStep({ binType, existingBin, scannedFile, onSaved, onBack }) {
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState('');
  const [form,      setForm]      = useState({
    binId:        existingBin?.binId        || '',
    locationName: existingBin?.locationName || '',
    latitude:     existingBin?.latitude!=null?String(existingBin.latitude):'',
    longitude:    existingBin?.longitude!=null?String(existingBin.longitude):'',
    qrCode:       existingBin?.qrCode       || '',
    binType:      existingBin?.binType      || binType || 'eco_spindles',
  });
  const [searchQ,  setSearchQ]  = useState('');
  const [searching,setSearching]= useState(false);
  const [results,  setResults]  = useState([]);
  const [searchErr,setSearchErr]= useState('');
  const timer = useRef(null);
  const update = (k,v) => setForm(f=>({...f,[k]:v}));

  const doSearch = async q => {
    if(!q||q.length<2){setResults([]);return;}
    setSearching(true);setSearchErr('');
    try{
      const r=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&addressdetails=1`,
        {headers:{'User-Agent':'Price-ur-Plastic/1.0','Accept':'application/json'}});
      const d=await r.json();
      const list=d.map(x=>({name:x.display_name,lat:parseFloat(x.lat),lng:parseFloat(x.lon)}));
      setResults(list);if(!list.length)setSearchErr('No locations found');
    }catch{setSearchErr('Search failed.');}
    setSearching(false);
  };

  const handleSearchInput=e=>{
    setSearchQ(e.target.value);clearTimeout(timer.current);
    timer.current=setTimeout(()=>doSearch(e.target.value),500);
  };

  const pickResult=r=>{
    update('latitude',r.lat.toFixed(6));update('longitude',r.lng.toFixed(6));
    setSearchQ(r.name.split(',').slice(0,2).join(', '));setResults([]);
  };

  const handleSubmit=async e=>{
    e.preventDefault();
    if(!form.binId||!form.locationName||!form.latitude||!form.longitude)return;
    setSaving(true); setSaveErr('');
    try {
      let photoUrl = existingBin?.photoUrl || '';
      const payload = {
        binId: form.binId, locationName: form.locationName,
        binType: form.binType, qrCode: form.qrCode || form.binId,
        latitude: parseFloat(form.latitude) || 0,
        longitude: parseFloat(form.longitude) || 0,
        photoUrl,
      };
      
      let docRef;
      if (existingBin?.id) {
        docRef = doc(db, 'bins', existingBin.id);
        await updateDoc(docRef, payload);
      } else {
        docRef = await addDoc(collection(db, 'bins'), { ...payload, createdAt: serverTimestamp() });
      }

      onSaved(); // Close modal immediately

      // Upload image asynchronously if scanned
      if (scannedFile) {
        const r = storageRef(storage, `bin_photos/${form.binId}-${Date.now()}.jpg`);
        uploadBytes(r, scannedFile)
          .then(async () => {
            const dlUrl = await getDownloadURL(r);
            await updateDoc(docRef, { photoUrl: dlUrl });
          })
          .catch(err => console.error("Background upload failed:", err));
      }
    } catch (err) {
      setSaveErr('Save failed: ' + err.message);
      setSaving(false);
    }
  };

  const mapUrl=form.latitude&&form.longitude
    ?`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(form.longitude)-.006},${parseFloat(form.latitude)-.004},${parseFloat(form.longitude)+.006},${parseFloat(form.latitude)+.004}&layer=mapnik&marker=${form.latitude},${form.longitude}`
    :null;

  const bt=getBT(form.binType);

  return(
    <form onSubmit={handleSubmit} style={M.stepWrap}>
      <div style={M.stepTitle}>Step 2 of 2 — Bin Details</div>

      {saveErr && <div style={M.errBox}>{saveErr}</div>}

      {/* Scanned bin type badge — mirrors widget.scannedBinType card in Flutter */}
      <div style={{...M.scannedBadge,background:bt.color+'15',borderColor:bt.color+'44'}}>
        <span style={{fontSize:22}}>{bt.emoji}</span>
        <div>
          <div style={{fontSize:11,color:'#4CAF50',fontWeight:700}}>Bin Type Detected</div>
          <div style={{fontWeight:700,fontSize:14,color:bt.color}}>{bt.label}</div>
        </div>
        {/* Allow changing type for edit mode */}
        <select style={{marginLeft:'auto',padding:'4px 8px',borderRadius:7,border:'1px solid #ddd',fontSize:12}}
          value={form.binType} onChange={e=>update('binType',e.target.value)}>
          {BIN_TYPES.map(t=><option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
        </select>
      </div>

      {/* Location search — mirrors _searchLocation() in Flutter */}
      <Fld label="Search Location">
        <div style={{position:'relative'}}>
          <div style={{display:'flex',gap:8}}>
            <input style={{...M.inp,flex:1}} placeholder="Type a place or landmark…" value={searchQ} onChange={handleSearchInput}/>
            <button type="button" style={M.searchBtn} onClick={()=>doSearch(searchQ)} disabled={searching}>{searching?'⟳':'🔍'}</button>
          </div>
          {searchErr&&<div style={{fontSize:12,color:'#C62828',marginTop:4}}>{searchErr}</div>}
          {results.length>0&&(
            <div style={M.dropdown}>
              {results.map((r,i)=>(
                <button key={i} type="button" style={M.dropItem} onClick={()=>pickResult(r)}>
                  <span style={{color:'#2E7D32',flexShrink:0}}>📍</span>
                  <div><div style={{fontSize:13,color:'#222'}}>{r.name.split(',').slice(0,3).join(', ')}</div>
                  <div style={{fontSize:11,color:'#888'}}>{r.lat.toFixed(5)}, {r.lng.toFixed(5)}</div></div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Fld>

      {/* OSM Map — mirrors GoogleMap widget in Flutter */}
      <Fld label="Map Preview">
        {mapUrl?(
          <div style={M.mapWrap}>
            <iframe title="map" src={mapUrl} style={{width:'100%',height:220,border:'none',display:'block'}} scrolling="no"/>
            <a href={`https://www.openstreetmap.org/?mlat=${form.latitude}&mlon=${form.longitude}&zoom=17`}
              target="_blank" rel="noreferrer" style={M.mapLink}>Open full map ↗</a>
          </div>
        ):(
          <div style={M.mapPlaceholder}>Search a location to see the map</div>
        )}
      </Fld>

      {/* Bin fields */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <Fld label="Bin Name *"><input style={M.inp} required value={form.locationName} onChange={e=>update('locationName',e.target.value)} placeholder="e.g. Main Campus"/></Fld>
        <Fld label="Bin ID *"><input style={M.inp} required value={form.binId} onChange={e=>update('binId',e.target.value)} placeholder="e.g. BIN001"/></Fld>
        <Fld label="Latitude *"><input style={M.inp} required type="number" step="any" value={form.latitude} onChange={e=>update('latitude',e.target.value)} placeholder="6.9271"/></Fld>
        <Fld label="Longitude *"><input style={M.inp} required type="number" step="any" value={form.longitude} onChange={e=>update('longitude',e.target.value)} placeholder="79.8612"/></Fld>
      </div>
      <Fld label="QR Code (blank = Bin ID)"><input style={M.inp} value={form.qrCode} onChange={e=>update('qrCode',e.target.value)} placeholder="Optional"/></Fld>

      <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
        <button type="button" onClick={onBack} style={M.btnGray} disabled={saving}>← Back</button>
        <button type="submit" style={M.btnGreen} disabled={saving}>{saving ? 'Saving…' : '💾 Save Bin'}</button>
      </div>
    </form>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL — wraps the flow
// ════════════════════════════════════════════════════════════════════════════
function BinModal({ mode, bin, isMobile, onClose }) {
  // Edit mode → skip scan, start at form
  const [step,        setStep]        = useState(mode==='edit'?'form':'scan');
  const [binType,     setBinType]     = useState(bin?.binType||null);
  const [scannedFile, setScannedFile] = useState(null);

  const steps = { scan: 1, form: 2 };

  return(
    <div style={V.overlay} onClick={onClose}>
      <div style={{...V.modal,...(isMobile?V.modalM:{})}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={V.header}>
          <div>
            <h2 style={V.title}>
              {mode==='edit'?'✏️ Edit Bin':'📍 Add New Bin'}
            </h2>
            <div style={V.stepDots}>
              {mode==='add'&&[1,2].map(n=>(
                <div key={n} style={{...V.dot,background:steps[step]>=n?'#2E7D32':'#ddd'}}/>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={V.closeBtn}>✕</button>
        </div>

        {/* Step content */}
        <div style={{...V.body,paddingBottom:isMobile?110:24}}>
          {step==='scan'&&(
            <ScanBinStep
              onDetected={(t, file)=>{setBinType(t);setScannedFile(file);setStep('form');}}
              onCancel={onClose}/>
          )}
          {step==='form'&&(
            <AddBinFormStep
              binType={binType}
              existingBin={bin}
              scannedFile={scannedFile}
              onSaved={onClose}
              onBack={()=>mode==='add'?setStep('scan'):onClose()}/>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PAGE — ManageBinsScreen
// ════════════════════════════════════════════════════════════════════════════
export default function BinsPage() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [bins,    setBins]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [modal,   setModal]   = useState(null);
  const [deleting,setDeleting]= useState(null);

  useEffect(()=>onSnapshot(query(collection(db,'bins'),orderBy('createdAt','desc')),
    snap=>{setBins(snap.docs.map(d=>({id:d.id,...d.data()})));setLoading(false);}
  ),[]);

  const filtered=search?bins.filter(b=>(b.locationName||'').toLowerCase().includes(search.toLowerCase())||(b.binId||'').toLowerCase().includes(search.toLowerCase())):bins;

  const handleDelete=async bin=>{
    if(!window.confirm(`Delete "${bin.locationName}"?`))return;
    setDeleting(bin.id);
    await deleteDoc(doc(db,'bins',bin.id)).finally(()=>setDeleting(null));
  };

  return(
    <div>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20,...(isMobile?{flexDirection:'column',gap:10}:{})}}>
        <div>
          <h1 style={{margin:0,fontSize:isMobile?22:28,fontWeight:800,color:'#1B5E20'}}>Manage Bins</h1>
          <p style={{margin:'4px 0 0',color:'#888',fontSize:13}}>{bins.length} bin{bins.length!==1?'s':''} registered</p>
        </div>
        <button onClick={()=>setModal({mode:'add'})} style={{...L.addBtn,...(isMobile?{width:'100%'}:{})}}>📍 Add Bin Location</button>
      </div>

      <input style={L.search} placeholder="🔍  Search bins…" value={search} onChange={e=>setSearch(e.target.value)}/>

      {modal&&<BinModal mode={modal.mode} bin={modal.bin} isMobile={isMobile} onClose={()=>setModal(null)}/>}

      {loading?(
        <div style={{textAlign:'center',padding:60,color:'#aaa'}}>Loading bins…</div>
      ):filtered.length===0?(
        <div style={{textAlign:'center',padding:'60px 20px'}}>
          <div style={{fontSize:64,marginBottom:12}}>📍</div>
          <div style={{fontSize:20,fontWeight:700,color:'#555',marginBottom:8}}>{bins.length===0?'No bins added yet':'No results'}</div>
          <div style={{fontSize:14,color:'#888'}}>{bins.length===0?'Tap "Add Bin Location" to add your first bin':'Try a different search'}</div>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {filtered.map(bin=>{
            const bt=getBT(bin.binType);
            return(
              <div key={bin.id} style={{...L.card,...(isMobile?{flexWrap:'wrap'}:{})}}>
                {bin.photoUrl
                  ?<img src={bin.photoUrl} alt={bin.locationName} style={{width:60,height:60,borderRadius:10,objectFit:'cover',flexShrink:0,border:'1px solid #ddd'}}/>
                  :<div style={{width:52,height:52,borderRadius:10,background:bt.color+'18',color:bt.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{bt.emoji}</div>
                }
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:15,color:'#222',marginBottom:5}}>{bin.locationName||'—'}</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:4}}>
                    <span style={{background:'#E8F5E9',color:'#2E7D32',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700}}>{bin.binId}</span>
                    <span style={{background:bt.color+'18',color:bt.color,padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:600}}>{bt.emoji} {bt.label}</span>
                  </div>
                  <div style={{fontSize:11,color:'#aaa',fontFamily:'monospace'}}>
                    {bin.latitude!=null&&bin.longitude!=null?`${Number(bin.latitude).toFixed(6)}, ${Number(bin.longitude).toFixed(6)}`:'No coordinates'}
                  </div>
                </div>
                <div style={{display:'flex',gap:7,flexShrink:0,...(isMobile?{width:'100%',justifyContent:'flex-end'}:{})}}>
                  <button onClick={()=>setModal({mode:'edit',bin})} style={L.editBtn}>✏️ Edit</button>
                  <button onClick={()=>handleDelete(bin)} style={L.delBtn} disabled={deleting===bin.id}>{deleting===bin.id?'…':'🗑️ Delete'}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────
function Fld({label,children}){return<div style={{marginBottom:14}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'#555',marginBottom:5,textTransform:'uppercase',letterSpacing:.4}}>{label}</label>{children}</div>;}

// ── Shared styles ──────────────────────────────────────────────────────────
const M={
  stepWrap:   {display:'flex',flexDirection:'column',gap:12},
  stepTitle:  {fontSize:16,fontWeight:800,color:'#1B5E20',margin:'0 0 2px'},
  stepSub:    {fontSize:13,color:'#888',margin:'0 0 4px'},
  statusPill: {padding:'10px 14px',borderRadius:10,border:'1.5px solid',fontSize:13,fontWeight:700,textAlign:'center'},
  progWrap:   {height:6,background:'#e8edf2',borderRadius:3,overflow:'hidden'},
  progBar:    {height:'100%',borderRadius:3,transition:'width .35s ease'},
  guideBox:   {background:'#f8fafb',borderRadius:10,padding:'10px 12px',border:'1px solid #e8edf2'},
  guideLabel: {fontSize:11,fontWeight:700,color:'#888',textTransform:'uppercase',letterSpacing:.5,marginBottom:8},
  guideGrid:  {display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6},
  guideItem:  {display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'7px 4px',borderRadius:8,border:'1.5px solid',transition:'all .2s'},
  vidBox:     {position:'relative',background:'#000',borderRadius:12,overflow:'hidden',height:260,border:'2px solid #e8edf2'},
  vid:        {width:'100%',height:'100%',objectFit:'cover',display:'block'},
  vidOverlay: {position:'absolute',inset:0,background:'rgba(0,0,0,.5)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,color:'#fff',fontSize:13,fontWeight:600},
  vidStatusBar:{position:'absolute',bottom:0,left:0,right:0,background:'rgba(0,0,0,.62)',color:'#fff',fontSize:13,fontWeight:700,padding:'8px 14px',textAlign:'center'},
  corner:     {position:'absolute',width:20,height:20,border:'2.5px solid rgba(255,255,255,.75)',borderRadius:2,pointerEvents:'none'},
  spin:       {width:24,height:24,border:'3px solid rgba(255,255,255,.3)',borderTop:'3px solid #fff',borderRadius:'50%',animation:'spin .7s linear infinite'},
  hint:       {fontSize:12,color:'#aaa',textAlign:'center',marginTop:4},
  errBox:     {background:'#FFEBEE',color:'#C62828',padding:'10px 14px',borderRadius:9,fontSize:13,fontWeight:600,display:'flex',alignItems:'center',gap:10},
  retryBtn:   {padding:'5px 12px',background:'#C62828',color:'#fff',border:'none',borderRadius:7,cursor:'pointer',fontSize:12,fontWeight:700,marginLeft:'auto'},
  scannedBadge:{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:10,border:'1.5px solid',marginBottom:4},
  inp:        {width:'100%',padding:'9px 12px',borderRadius:9,border:'1.5px solid #ddd',fontSize:14,boxSizing:'border-box',outline:'none'},
  searchBtn:  {padding:'9px 14px',background:'#2E7D32',color:'#fff',border:'none',borderRadius:9,cursor:'pointer',fontSize:16,flexShrink:0},
  dropdown:   {position:'absolute',left:0,right:0,top:'100%',marginTop:4,background:'#fff',border:'1.5px solid #ddd',borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,.12)',zIndex:50,maxHeight:200,overflowY:'auto'},
  dropItem:   {display:'flex',alignItems:'flex-start',gap:8,width:'100%',padding:'9px 14px',background:'none',border:'none',borderBottom:'1px solid #f5f5f5',textAlign:'left',cursor:'pointer'},
  mapWrap:    {borderRadius:10,overflow:'hidden',border:'1.5px solid #ddd'},
  mapLink:    {display:'block',background:'#F1F8E9',padding:'6px 12px',fontSize:12,color:'#2E7D32',fontWeight:600,textDecoration:'none',textAlign:'center'},
  mapPlaceholder:{height:100,background:'#F9F9F9',border:'1.5px dashed #ddd',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',color:'#bbb',fontSize:13},
  btnGray:    {padding:'10px 18px',background:'#f5f5f5',border:'none',borderRadius:9,cursor:'pointer',fontSize:14,fontWeight:600,color:'#555'},
  btnGreen:   {padding:'10px 22px',background:'#2E7D32',color:'#fff',border:'none',borderRadius:9,cursor:'pointer',fontSize:14,fontWeight:700},
  btnRed:     {padding:'10px 14px',background:'#f9f1f1',color:'#a42f2f',border:'1px solid #f0dede',borderRadius:9,cursor:'pointer',fontSize:13,fontWeight:700},
  centerBox:  {display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,padding:30,textAlign:'center'},
};

const V={
  overlay:  {position:'fixed',inset:0,background:'rgba(0,0,0,.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:12},
  modal:    {background:'#fff',borderRadius:18,width:540,maxHeight:'94vh',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 24px 80px rgba(0,0,0,.30)'},
  modalM:   {width:'calc(100vw - 12px)',maxHeight:'92vh',borderRadius:14},
  header:   {display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'20px 24px 14px',borderBottom:'1px solid #f0f0f0',position:'sticky',top:0,background:'#fff',zIndex:1},
  title:    {margin:0,fontSize:18,fontWeight:800,color:'#1B5E20'},
  stepDots: {display:'flex',gap:5,marginTop:6},
  dot:      {width:8,height:8,borderRadius:'50%',transition:'background .2s'},
  closeBtn: {background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#888',padding:'4px 8px',flexShrink:0},
  body:     {flex:1,overflowY:'auto',padding:'16px 24px 24px'},
};

const L={
  addBtn: {padding:'11px 22px',background:'#2E7D32',color:'#fff',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'},
  search: {width:'100%',padding:'11px 16px',borderRadius:11,border:'1.5px solid #ddd',fontSize:14,marginBottom:16,boxSizing:'border-box',outline:'none'},
  card:   {display:'flex',alignItems:'flex-start',gap:14,background:'#fff',borderRadius:14,padding:'16px 20px',boxShadow:'0 2px 8px rgba(0,0,0,.06)',border:'1px solid #eee'},
  editBtn:{padding:'7px 14px',background:'#E3F2FD',color:'#1565C0',border:'none',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:700,whiteSpace:'nowrap'},
  delBtn: {padding:'7px 14px',background:'#FFEBEE',color:'#C62828',border:'none',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:700,whiteSpace:'nowrap'},
};