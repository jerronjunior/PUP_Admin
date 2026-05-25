// server/index.js — minimal inference server
const express = require('express');
const multer = require('multer');
const tf = require('@tensorflow/tfjs-node');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

let model = null;
const MODEL_PATH = path.join(__dirname, 'models', 'bin-model', 'model.json');

async function loadModel() {
  if (model) return model;
  try {
    model = await tf.loadLayersModel('file://' + MODEL_PATH);
    console.log('Model loaded from', MODEL_PATH);
    return model;
  } catch (err) {
    console.error('Failed to load model:', err.message || err);
    throw err;
  }
}

app.post('/detect', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image' });
  try {
    await loadModel();
    const img = tf.node.decodeImage(req.file.buffer, 3).toFloat();
    const resized = tf.image.resizeBilinear(img, [224, 224]);
    const normalized = resized.div(255.0).expandDims(0);
    const out = model.predict(normalized);
    const data = out.dataSync();
    let score = null;
    if (data.length === 1) score = data[0]; else score = Math.max(...data);
    // dispose tensors
    img.dispose(); resized.dispose(); normalized.dispose(); if (out.dispose) out.dispose();
    return res.json({ score });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log('Detector server listening on', PORT));
