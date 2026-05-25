// src/lib/binModelClient.js
// Client-side TF.js model loader and inference helper.
// Drop your TF.js web model at: public/models/bin-model/model.json

let tf = null;
let model = null;

export async function loadClientModel(modelUrl = '/models/bin-model/model.json') {
  if (model) return model;
  try {
    if (!tf) tf = await import('@tensorflow/tfjs');
    model = await tf.loadLayersModel(modelUrl);
    return model;
  } catch (err) {
    console.warn('Client model load failed:', err.message || err);
    model = null;
    return null;
  }
}

export function unloadClientModel() {
  if (model && model.dispose) model.dispose();
  model = null;
}

async function runModelOnTensor(tensor) {
  if (!model) return null;
  try {
    const out = model.predict(tensor);
    // Normalize output handling: scalar, 1D, or logits
    let score = null;
    if (out.dataSync) {
      const a = out.dataSync();
      if (a.length === 1) score = a[0];
      else score = Math.max(...a);
    } else if (Array.isArray(out)) {
      const a = await Promise.all(out.map(o => o.data()));
      score = Math.max(...a.flat());
    }
    if (out.dispose) out.dispose();
    return score;
  } catch (err) {
    console.warn('Model inference failed:', err.message || err);
    return null;
  }
}

export async function predictCanvas(canvas, resizeTo = 224) {
  if (!model) await loadClientModel();
  if (!model) return null;
  try {
    const t = tf.browser.fromPixels(canvas).toFloat();
    let resized = t;
    if (resizeTo) resized = tf.image.resizeBilinear(t, [resizeTo, resizeTo]);
    const normalized = resized.div(255.0).expandDims(0);
    const score = await runModelOnTensor(normalized);
    t.dispose(); if (resized !== t) resized.dispose(); if (normalized) normalized.dispose();
    return score;
  } catch (err) {
    console.warn('predictCanvas error', err.message || err);
    return null;
  }
}

export async function predictBlobViaServer(blob, serverUrl) {
  try {
    const fd = new FormData();
    fd.append('image', blob, 'upload.jpg');
    const res = await fetch(serverUrl, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Server error: ' + res.status);
    const j = await res.json();
    return j.score ?? null;
  } catch (err) {
    console.warn('Server predict failed:', err.message || err);
    return null;
  }
}
