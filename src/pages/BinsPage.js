// src/pages/BinsPage.js
// Mirrors manage_bins_screen.dart + add_bin_screen.dart:
//   - List all bins with binId, location name, coordinates
//   - Add new bin with location search (Nominatim OSM — free, no API key)
//   - Edit existing bin
//   - Delete bin with confirm dialog
import React, { useEffect, useState, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy
} from 'firebase/firestore';

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
  const [bins,     setBins]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState(null); // bin doc id
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(null);

  // Location search (Nominatim — same as OSM/flutter_map, free)
  const [searchQ,   setSearchQ]   = useState('');
  const [searching, setSearching] = useState(false);
  const [results,   setResults]   = useState([]);
  const searchTimer = useRef(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'bins'), orderBy('createdAt', 'desc')),
      snap => {
        setBins(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      }
    );
  }, []);

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

  const openAdd = () => {
    setEditing(null); setForm(EMPTY_FORM); setShowForm(true);
    setSearchQ(''); setResults([]);
  };

  const openEdit = bin => {
    setEditing(bin.id);
    setForm({
      binId:        bin.binId        || '',
      locationName: bin.locationName || '',
      binType:      bin.binType      || 'eco_spindles',
      latitude:     bin.latitude     != null ? String(bin.latitude)  : '',
      longitude:    bin.longitude    != null ? String(bin.longitude) : '',
      qrCode:       bin.qrCode       || '',
    });
    setSearchQ(''); setResults([]);
    setShowForm(true);
  };

  const handleSave = async e => {
    e.preventDefault();
    if (!form.binId || !form.locationName) return;
    setSaving(true);
    try {
      const payload = {
        binId:        form.binId,
        locationName: form.locationName,
        binType:      form.binType,
        qrCode:       form.qrCode || form.binId,
        latitude:     parseFloat(form.latitude)  || 0,
        longitude:    parseFloat(form.longitude) || 0,
      };
      if (editing) {
        await updateDoc(doc(db, 'bins', editing), payload);
      } else {
        await addDoc(collection(db, 'bins'), {
          ...payload, createdAt: serverTimestamp(),
        });
      }
      setShowForm(false);
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
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.h1}>Manage Bins</h1>
          <p style={s.sub}>{bins.length} bin{bins.length !== 1 ? 's' : ''} registered</p>
        </div>
        <button onClick={openAdd} style={s.addBtn}>＋ Add Bin Location</button>
      </div>

      {/* ── Form modal ─────────────────────────────────────────────── */}
      {showForm && (
        <div style={s.overlay} onClick={() => setShowForm(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>{editing ? '✏️ Edit Bin' : '📍 Add New Bin'}</h2>
              <button onClick={() => setShowForm(false)} style={s.closeBtn}>✕</button>
            </div>

            <form onSubmit={handleSave}>
              <div style={s.formGrid}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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
                <button type="button" onClick={() => setShowForm(false)} style={s.cancelBtn}>
                  Cancel
                </button>
                <button type="submit" style={s.saveBtn} disabled={saving}>
                  {saving ? 'Saving…' : editing ? '✓ Save Changes' : '＋ Add Bin'}
                </button>
              </div>
            </form>
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
                <div key={b.id} style={s.binCard}>
                  <div style={s.binIcon}>📍</div>
                  <div style={{ flex: 1 }}>
                    <div style={s.binName}>{b.locationName}</div>
                    <div style={s.binMeta}>
                      <span style={s.binTag}>{b.binId}</span>
                      {binTypeMeta && <span style={s.typePill}>{binTypeMeta.label}</span>}
                    </div>
                    <div style={s.binCoords}>
                      {b.latitude != null && b.longitude != null
                        ? `${Number(b.latitude).toFixed(5)}, ${Number(b.longitude).toFixed(5)}`
                        : 'No coordinates'}
                    </div>
                  </div>
                  <div style={s.binActions}>
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
  h1:           { margin: 0, fontSize: 28, fontWeight: 800, color: '#1B5E20' },
  sub:          { margin: '4px 0 0', color: '#888', fontSize: 14 },
  addBtn:       { padding: '10px 20px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  overlay:      { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:        { background: '#fff', borderRadius: 16, padding: '28px 28px 20px', width: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' },
  modalHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  modalTitle:   { margin: 0, fontSize: 20, fontWeight: 800, color: '#1B5E20' },
  closeBtn:     { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888', padding: '4px 8px' },
  formGrid:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  input:        { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1.5px solid #ddd', fontSize: 14, boxSizing: 'border-box', outline: 'none' },
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
  binIcon:      { fontSize: 28, flexShrink: 0 },
  binName:      { fontWeight: 700, fontSize: 16, color: '#222', marginBottom: 4 },
  binMeta:      { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 },
  binTag:       { background: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
  typePill:     { background: '#F3E5F5', color: '#6A1B9A', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 },
  binCoords:    { fontSize: 12, color: '#888', fontFamily: 'monospace' },
  binActions:   { display: 'flex', gap: 8, flexShrink: 0 },
  editBtn:      { padding: '7px 14px', background: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  delBtn:       { padding: '7px 12px', background: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 },
};
