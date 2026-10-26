// src/pages/BinsPage.js
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { db, storage } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import useMediaQuery from '../hooks/useMediaQuery';

// ── Import detection model + training data collector ──────────────────────
// saveTrainingSample: called when an admin saves a bin — uploads the bin
// photo as a verified, labelled training image linked to the bin record.
// Uploads the image to Firebase Storage so retrain.py can use it later.
import {
  BinDetector, LOCK_FRAMES,
  saveTrainingSample,   // ← auto-collects training data from admin scans
} from '../lib/binDetectionModel';

const BIN_TYPE = { value:'bin', label:'Recycling Bin', emoji:'♻️', color:'#2E7D32' };
const getBT = () => BIN_TYPE;

function ScanBinStep({ onDetected, onCancel }) {
  const [status,    setStatus]    = useState('Starting camera…');
  const [camErr,    setCamErr]    = useState('');
  const [streak,    setStreak]    = useState(0);
  const [camReady,  setCamReady]  = useState(false);

  const videoRef    = useRef(null);
  const canvasRef   = useRef(document.createElement('canvas'));
  const streamRef   = useRef(null);
  const timerRef    = useRef(null);
  const detectorR   = useRef(new BinDetector()); // ported from Flutter BinDetector
  const startedRef  = useRef(false);

  const stop = useCallback(()=>{
    clearInterval(timerRef.current);timerRef.current=null;
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;}
    detectorR.current.reset();
    if(videoRef.current)videoRef.current.srcObject=null;
    setCamReady(false);
  },[]);

  useEffect(()=>()=>stop(),[stop]);

  const startLoop = useCallback(()=>{
    clearInterval(timerRef.current);
    detectorR.current.reset();
    timerRef.current=setInterval(()=>{
      const v=videoRef.current,c=canvasRef.current;
      if(!v||!v.videoWidth)return;

      const detector = detectorR.current;
      detector.update(c, v); // ported BinDetector — 8-check pipeline
      setStreak(detector.streak);

      if (detector.hasDetection) {
        setStatus('✅ Bin confirmed!');
        const cap = document.createElement('canvas');
        if (v && v.videoWidth) {
          cap.width = v.videoWidth; cap.height = v.videoHeight;
          cap.getContext('2d').drawImage(v, 0, 0, cap.width, cap.height);
          cap.toBlob(blob => {
            const file = new File([blob], `bin-${Date.now()}.jpg`, {type: 'image/jpeg'});
            // The captured photo is passed to the form step. The training
            // sample is saved later in handleSubmit() WITH the bin's real
            // ID/type/location metadata — so we don't save it twice here.
            clearInterval(timerRef.current); stop(); onDetected('bin', file);
          }, 'image/jpeg', 0.92);
        } else {
          clearInterval(timerRef.current); stop(); onDetected('bin', null);
        }
      } else if (detector.streak > 0) {
        const rem = LOCK_FRAMES - detector.streak;
        setStatus(rem > 0 ? `♻️ Bin detected — hold steady (${rem})` : '✅ Bin confirmed!');
      } else {
        setStatus('🔍 Point camera at the bin…');
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

  const pct=Math.min(100,(streak/LOCK_FRAMES)*100);

  return(
    <div style={M.stepWrap}>
      <div style={M.stepTitle}>Step 1 of 2 — Scan Bin</div>
      <div style={M.stepSub}>Point camera at the recycling bin to detect it automatically</div>
      <div style={{...M.statusPill,background:'#f1f8e9',color:'#2E7D32',borderColor:'#c8e6c9'}}>{status}</div>
      {streak>0&&streak<LOCK_FRAMES&&(
        <div style={M.progWrap}><div style={{...M.progBar,width:pct+'%',background:'#2E7D32'}}/></div>
      )}
      <div style={M.vidBox}>
        <video ref={videoRef} autoPlay playsInline muted style={M.vid}/>
        {!camReady&&<div style={M.vidOverlay}><div style={M.spin}/><span>Opening camera…</span></div>}
        <div style={{...M.corner,top:10,left:10,borderRight:'none',borderBottom:'none'}}/>
        <div style={{...M.corner,top:10,right:10,borderLeft:'none',borderBottom:'none'}}/>
        <div style={{...M.corner,bottom:10,left:10,borderRight:'none',borderTop:'none'}}/>
        <div style={{...M.corner,bottom:10,right:10,borderLeft:'none',borderTop:'none'}}/>
      </div>
      {camErr&&<div style={M.errBox}>{camErr}<button onClick={()=>{startedRef.current=false;startCamera();}} style={M.retryBtn}>Retry</button></div>}
      <div style={M.hint}>Hold the camera steady in front of the bin for auto-capture.</div>
    </div>
  );
}

function AddBinFormStep({ binType, existingBin, scannedFile, onSaved, onBack }) {
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState('');
  const [form,      setForm]      = useState({
    binId:        existingBin?.binId        || '',
    locationName: existingBin?.locationName || '',
    latitude:     existingBin?.latitude!=null?String(existingBin.latitude):'',
    longitude:    existingBin?.longitude!=null?String(existingBin.longitude):'',
    qrCode:       existingBin?.qrCode       || '',
    binType:      existingBin?.binType      || binType || 'bin',
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
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if(!form.binId.trim()||!form.locationName.trim()||!Number.isFinite(latitude)||!Number.isFinite(longitude)){
      setSaveErr('Enter a bin ID, location name, and valid coordinates.');
      return;
    }
    setSaving(true); setSaveErr('');
    try {
      let photoUrl = existingBin?.photoUrl || 'https://firebasestorage.googleapis.com/v0/b/price-ur-plastic-faab5.firebasestorage.app/o/placeholder.png?alt=media';
      const payload = {
        binId:form.binId.trim(), locationName:form.locationName.trim(),
        binType:form.binType, qrCode:form.qrCode||form.binId,
        latitude, longitude,
        photoUrl,
      };
      let docRef;
      if(existingBin?.id){
        docRef=doc(db,'bins',existingBin.id);
        await updateDoc(docRef,payload);
      }else{
        docRef=await addDoc(collection(db,'bins'),{...payload,createdAt:serverTimestamp()});
      }
      if(scannedFile){
        const r=storageRef(storage,`bin_photos/${form.binId}-${Date.now()}.jpg`);
        const photoUpload = uploadBytes(r,scannedFile).then(async()=>{
          const dlUrl=await getDownloadURL(r);
          await updateDoc(docRef,{photoUrl:dlUrl});
        });
        const trainingUpload = saveTrainingSample(scannedFile, 'bin', {
          binId:        form.binId,
          binType:      form.binType,
          locationName: form.locationName,
        });
        const results = await Promise.allSettled([photoUpload, trainingUpload]);
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length) {
          setSaveErr('Bin saved, but an image upload failed: '+failures[0].reason.message);
          setSaving(false);
          return;
        }
      }
    }catch(err){setSaveErr('Save failed: '+err.message);setSaving(false);return;}
    setSaving(false);
    onSaved();
  };

  const mapUrl=form.latitude&&form.longitude
    ?`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(form.longitude)-.006},${parseFloat(form.latitude)-.004},${parseFloat(form.longitude)+.006},${parseFloat(form.latitude)+.004}&layer=mapnik&marker=${form.latitude},${form.longitude}`
    :null;
  const bt=getBT();

  return(
    <form onSubmit={handleSubmit} style={M.stepWrap}>
      <div style={M.stepTitle}>Step 2 of 2 — Bin Details</div>
      {saveErr&&<div style={M.errBox}>{saveErr}</div>}
      <div style={{...M.scannedBadge,background:bt.color+'15',borderColor:bt.color+'44'}}>
        <span style={{fontSize:22}}>{bt.emoji}</span>
        <div>
          <div style={{fontSize:11,color:'#4CAF50',fontWeight:700}}>Bin Detected</div>
          <div style={{fontWeight:700,fontSize:14,color:bt.color}}>{bt.label}</div>
        </div>
      </div>
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
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <Fld label="Bin Name *"><input style={M.inp} required value={form.locationName} onChange={e=>update('locationName',e.target.value)} placeholder="e.g. Main Campus"/></Fld>
        <Fld label="Bin ID *"><input style={M.inp} required value={form.binId} onChange={e=>update('binId',e.target.value)} placeholder="e.g. BIN001"/></Fld>
        <Fld label="Latitude *"><input style={M.inp} required type="number" step="any" value={form.latitude} onChange={e=>update('latitude',e.target.value)} placeholder="6.9271"/></Fld>
        <Fld label="Longitude *"><input style={M.inp} required type="number" step="any" value={form.longitude} onChange={e=>update('longitude',e.target.value)} placeholder="79.8612"/></Fld>
      </div>
      <Fld label="QR Code (blank = Bin ID)"><input style={M.inp} value={form.qrCode} onChange={e=>update('qrCode',e.target.value)} placeholder="Optional"/></Fld>
      <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
        <button type="button" onClick={onBack} style={M.btnGray} disabled={saving}>← Back</button>
        <button type="submit" style={M.btnGreen} disabled={saving}>{saving?'Saving…':'💾 Save Bin'}</button>
      </div>
    </form>
  );
}

function BinModal({ mode, bin, isMobile, onClose }) {
  const [step,        setStep]        = useState(mode==='edit'?'form':'scan');
  const [binType,     setBinType]     = useState(bin?.binType||null);
  const [scannedFile, setScannedFile] = useState(null);
  const steps = { scan:1, form:2 };
  return(
    <div style={V.overlay} onClick={onClose}>
      <div style={{...V.modal,...(isMobile?V.modalM:{})}} onClick={e=>e.stopPropagation()}>
        <div style={V.header}>
          <div>
            <h2 style={V.title}>{mode==='edit'?'✏️ Edit Bin':'📍 Add New Bin'}</h2>
            <div style={V.stepDots}>
              {mode==='add'&&[1,2].map(n=>(
                <div key={n} style={{...V.dot,background:steps[step]>=n?'#2E7D32':'#ddd'}}/>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={V.closeBtn}>✕</button>
        </div>
        <div style={{...V.body,paddingBottom:isMobile?110:24}}>
          {step==='scan'&&(
            <ScanBinStep
              onDetected={(t,file)=>{setBinType(t);setScannedFile(file);setStep('form');}}
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

export default function BinsPage() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [bins,    setBins]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [modal,   setModal]   = useState(null);
  const [deleting,setDeleting]= useState(null);
  const [loadErr, setLoadErr] = useState('');

  useEffect(()=>onSnapshot(
    query(collection(db,'bins'),orderBy('createdAt','desc')),
    snap=>{setBins(snap.docs.map(d=>({id:d.id,...d.data()})));setLoading(false);},
    err=>{setLoadErr('Could not load bins: '+err.message);setLoading(false);}
  ),[]);

  const filtered=search?bins.filter(b=>(b.locationName||'').toLowerCase().includes(search.toLowerCase())||(b.binId||'').toLowerCase().includes(search.toLowerCase())):bins;

  const handleDelete=async bin=>{
    if(!window.confirm(`Delete "${bin.locationName}"?`))return;
    setDeleting(bin.id);
    try {
      await deleteDoc(doc(db,'bins',bin.id));
    } catch (err) {
      setLoadErr('Could not delete bin: '+err.message);
    } finally {
      setDeleting(null);
    }
  };

  return(
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20,...(isMobile?{flexDirection:'column',gap:10}:{})}}>
        <div>
          <h1 style={{margin:0,fontSize:isMobile?22:28,fontWeight:800,color:'#1B5E20'}}>Manage Bins</h1>
          <p style={{margin:'4px 0 0',color:'#888',fontSize:13}}>{bins.length} bin{bins.length!==1?'s':''} registered</p>
        </div>
        <button onClick={()=>setModal({mode:'add'})} style={{...L.addBtn,...(isMobile?{width:'100%'}:{})}}>📍 Add Bin Location</button>
      </div>
      <input style={L.search} placeholder="🔍  Search bins…" value={search} onChange={e=>setSearch(e.target.value)}/>
      {loadErr&&<div style={M.errBox}>{loadErr}</div>}
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
            const bt=getBT();
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

function Fld({label,children}){return<div style={{marginBottom:14}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'#555',marginBottom:5,textTransform:'uppercase',letterSpacing:.4}}>{label}</label>{children}</div>;}

const M={
  stepWrap:{display:'flex',flexDirection:'column',gap:12},
  stepTitle:{fontSize:16,fontWeight:800,color:'#1B5E20',margin:'0 0 2px'},
  stepSub:{fontSize:13,color:'#888',margin:'0 0 4px'},
  statusPill:{padding:'10px 14px',borderRadius:10,border:'1.5px solid',fontSize:13,fontWeight:700,textAlign:'center'},
  progWrap:{height:6,background:'#e8edf2',borderRadius:3,overflow:'hidden'},
  progBar:{height:'100%',borderRadius:3,transition:'width .35s ease'},
  vidBox:{position:'relative',background:'#000',borderRadius:12,overflow:'hidden',height:260,border:'2px solid #e8edf2'},
  vid:{width:'100%',height:'100%',objectFit:'cover',display:'block'},
  vidOverlay:{position:'absolute',inset:0,background:'rgba(0,0,0,.5)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,color:'#fff',fontSize:13,fontWeight:600},
  corner:{position:'absolute',width:20,height:20,border:'2.5px solid rgba(255,255,255,.75)',borderRadius:2,pointerEvents:'none'},
  spin:{width:24,height:24,border:'3px solid rgba(255,255,255,.3)',borderTop:'3px solid #fff',borderRadius:'50%',animation:'spin .7s linear infinite'},
  hint:{fontSize:12,color:'#aaa',textAlign:'center',marginTop:4},
  errBox:{background:'#FFEBEE',color:'#C62828',padding:'10px 14px',borderRadius:9,fontSize:13,fontWeight:600,display:'flex',alignItems:'center',gap:10},
  retryBtn:{padding:'5px 12px',background:'#C62828',color:'#fff',border:'none',borderRadius:7,cursor:'pointer',fontSize:12,fontWeight:700,marginLeft:'auto'},
  scannedBadge:{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:10,border:'1.5px solid',marginBottom:4},
  inp:{width:'100%',padding:'9px 12px',borderRadius:9,border:'1.5px solid #ddd',fontSize:14,boxSizing:'border-box',outline:'none'},
  searchBtn:{padding:'9px 14px',background:'#2E7D32',color:'#fff',border:'none',borderRadius:9,cursor:'pointer',fontSize:16,flexShrink:0},
  dropdown:{position:'absolute',left:0,right:0,top:'100%',marginTop:4,background:'#fff',border:'1.5px solid #ddd',borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,.12)',zIndex:50,maxHeight:200,overflowY:'auto'},
  dropItem:{display:'flex',alignItems:'flex-start',gap:8,width:'100%',padding:'9px 14px',background:'none',border:'none',borderBottom:'1px solid #f5f5f5',textAlign:'left',cursor:'pointer'},
  mapWrap:{borderRadius:10,overflow:'hidden',border:'1.5px solid #ddd'},
  mapLink:{display:'block',background:'#F1F8E9',padding:'6px 12px',fontSize:12,color:'#2E7D32',fontWeight:600,textDecoration:'none',textAlign:'center'},
  mapPlaceholder:{height:100,background:'#F9F9F9',border:'1.5px dashed #ddd',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',color:'#bbb',fontSize:13},
  btnGray:{padding:'10px 18px',background:'#f5f5f5',border:'none',borderRadius:9,cursor:'pointer',fontSize:14,fontWeight:600,color:'#555'},
  btnGreen:{padding:'10px 22px',background:'#2E7D32',color:'#fff',border:'none',borderRadius:9,cursor:'pointer',fontSize:14,fontWeight:700},
};

const V={
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:12},
  modal:{background:'#fff',borderRadius:18,width:540,maxHeight:'94vh',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 24px 80px rgba(0,0,0,.30)'},
  modalM:{width:'calc(100vw - 12px)',maxHeight:'92vh',borderRadius:14},
  header:{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'20px 24px 14px',borderBottom:'1px solid #f0f0f0',position:'sticky',top:0,background:'#fff',zIndex:1},
  title:{margin:0,fontSize:18,fontWeight:800,color:'#1B5E20'},
  stepDots:{display:'flex',gap:5,marginTop:6},
  dot:{width:8,height:8,borderRadius:'50%',transition:'background .2s'},
  closeBtn:{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#888',padding:'4px 8px',flexShrink:0},
  body:{flex:1,overflowY:'auto',padding:'16px 24px 24px'},
};

const L={
  addBtn:{padding:'11px 22px',background:'#2E7D32',color:'#fff',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'},
  search:{width:'100%',padding:'11px 16px',borderRadius:11,border:'1.5px solid #ddd',fontSize:14,marginBottom:16,boxSizing:'border-box',outline:'none'},
  card:{display:'flex',alignItems:'flex-start',gap:14,background:'#fff',borderRadius:14,padding:'16px 20px',boxShadow:'0 2px 8px rgba(0,0,0,.06)',border:'1px solid #eee'},
  editBtn:{padding:'7px 14px',background:'#E3F2FD',color:'#1565C0',border:'none',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:700,whiteSpace:'nowrap'},
  delBtn:{padding:'7px 14px',background:'#FFEBEE',color:'#C62828',border:'none',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:700,whiteSpace:'nowrap'},
};