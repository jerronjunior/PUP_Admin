// src/lib/binDetectionModel.js
// ─────────────────────────────────────────────────────────────────────────────
// Shape + color + wire-mesh validation for Sri Lankan recycling bins.
// Ported 1:1 from the Flutter BinDetector class so web and mobile detection
// always agree. Calibrated from 78 reference bin photos.
//
// A frame must pass every check before it counts toward the lock streak:
//   1. Frame coverage      — enough matching pixels exist at all
//   2. Bbox color density  — the matched region is solid, not scattered
//   3. Texture variance    — real bins have texture; screens/photos don't
//   4. Mesh fraction       — wire-mesh bins show a high-frequency Y pattern
//   5. Neutral-surface cap — background bleeding into the bbox is rejected
//   6. Height span/aspect  — bin must be a tall, plausible shape
//   7. Quadrant fill       — color must be spread across all 4 quadrants
//   8. Dark slot / sign band / strong mesh — at least one structural cue
// ─────────────────────────────────────────────────────────────────────────────
import { db, storage } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { getAuth } from 'firebase/auth';

export const BinType = {
  COCA_COLA:    'coca_cola',
  KEELLS:       'keells',
  ECO_SPINDLES: 'eco_spindles',
  UNKNOWN:      'unknown',
};

const COLS = 16;
const ROWS = 12;

// Coverage: wire-mesh bins have white sign bands and see-through mesh —
// real bbox color density is typically 18–35%. Texture + mesh checks
// remain the primary anti-spoofing layer.
const MIN_BBOX_COLOR_FRACTION  = 0.18;
const MIN_FRAME_COVER_FRACTION = 0.09;

// Real-world close-up shots span ~22–30% of frame height; wide-angle
// photos of bins at slight angles push aspect ratio past 1.75.
const MIN_HEIGHT_SPAN = 0.22;
const MIN_QUADRANTS   = 4;

// Slot openings in field photos are dark-gray (Y ≈ 69–82), not pitch-black.
const DARK_Y           = 82.0;
const MIN_DARK_CLUSTER = 2;

const MIN_TEXTURE_STD      = 15.0;
const MIN_MESH_CELL_FRACTION = 0.30;
const STRONG_MESH_FRACTION = 0.45;
const STRONG_MESH_TEXTURE  = 19.0;

const LOCK_FRAMES = 16;

export { COLS, ROWS, LOCK_FRAMES };

// ── Color classification — YUV ranges from 78 reference bin photos ────────
function matchBinColor(mY, mU, mV) {
  const uOff = mU - 128, vOff = mV - 128;
  const rApprox = mY + 1.402 * vOff;
  const gApprox = mY - 0.344136 * uOff - 0.714136 * vOff;
  const bApprox = mY + 1.772 * uOff;

  const isGreenDominant = gApprox > rApprox * 1.24 && gApprox > bApprox * 1.10 && gApprox > 58;
  const isRedDominant   = rApprox > gApprox * 1.38 && rApprox > bApprox * 1.45 && rApprox > 75;
  const isPurplish      = rApprox > gApprox * 0.88 && bApprox > gApprox * 0.88 && rApprox < 135 && mY < 120;

  if (isRedDominant && mY >= 52 && mY <= 145 && mU >= 95 && mU <= 125 && mV >= 142 && mV <= 235) {
    return BinType.COCA_COLA;
  }
  if (isGreenDominant && mY >= 45 && mY <= 145 && mU >= 108 && mU <= 138 && mV >= 70 && mV <= 115) {
    return BinType.KEELLS;
  }
  if (isPurplish && mY >= 65 && mY <= 115 && mU >= 125 && mU <= 158 && mV >= 130 && mV <= 162) {
    return BinType.ECO_SPINDLES;
  }
  return BinType.UNKNOWN;
}

function isNeutralSurface(mY, mU, mV) {
  const chroma = Math.abs(mU - 128) + Math.abs(mV - 128);
  return mY > 185 && chroma < 32;
}

// Many Sri Lankan bins (Clean Sri Lanka, Carekleen) have a white sign band.
function hasWhiteSignBand(minRow, maxRow, minCol, maxCol, cellY, cellU, cellV) {
  const midStart = minRow + Math.floor((maxRow - minRow) * 0.22);
  const midEnd   = minRow + Math.floor((maxRow - minRow) * 0.78);

  for (let row = midStart; row <= midEnd; row++) {
    let run = 0, maxRun = 0;
    for (let col = minCol; col <= maxCol; col++) {
      const idx = row * COLS + col;
      if (isNeutralSurface(cellY[idx], cellU[idx], cellV[idx])) {
        run++; if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }
    if (maxRun >= 4) return true;
  }
  return false;
}

// Flood-fill (iterative DFS) to find the largest connected dark region —
// this is the bin's slot opening, scanned only in the upper ~62% of the bbox.
function largestDarkCluster(minRow, maxRow, minCol, maxCol, cellY, cellColors, dominant) {
  const visited = new Array(COLS * ROWS).fill(false);
  let largest = 0;

  const isDark = idx =>
    cellY[idx] < DARK_Y &&
    (cellColors[idx] === dominant || cellColors[idx] === BinType.UNKNOWN);

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const start = row * COLS + col;
      if (visited[start] || !isDark(start)) continue;

      let size = 0;
      const stack = [start];
      visited[start] = true;

      while (stack.length) {
        const cur = stack.pop();
        size++;
        const r = Math.floor(cur / COLS), c = cur % COLS;
        const neighbors = [];
        if (r > minRow) neighbors.push((r - 1) * COLS + c);
        if (r < maxRow) neighbors.push((r + 1) * COLS + c);
        if (c > minCol) neighbors.push(r * COLS + (c - 1));
        if (c < maxCol) neighbors.push(r * COLS + (c + 1));
        for (const n of neighbors) {
          if (!visited[n] && isDark(n)) { visited[n] = true; stack.push(n); }
        }
      }
      if (size > largest) largest = size;
    }
  }
  return largest;
}

// ══════════════════════════════════════════════════════════════════════════
// BinDetector — stateful, frame-by-frame detector matching the Dart class
// exactly. Call `.update(canvas, video)` every tick, then read:
//   .hasDetection   — true once the lock streak is reached
//   .detectedType   — BinType.COCA_COLA / KEELLS / ECO_SPINDLES
//   .colorCells     — how many cells matched (debug/UI)
//   .darkSlotCells  — size of the detected slot cluster (debug/UI)
//   .passedShape    — true if shape checks passed this frame
//   .streak         — current consecutive-match count (for progress UI)
// ══════════════════════════════════════════════════════════════════════════
export class BinDetector {
  constructor() {
    this.reset();
  }

  reset() {
    this.streak = 0;
    this.candidate = BinType.UNKNOWN;
    this.detectedType = BinType.UNKNOWN;
    this.hasDetection = false;
    this.colorCells = 0;
    this.darkSlotCells = 0;
    this.passedShape = false;
  }

  _miss() {
    this.passedShape = false;
    // Gradual decay instead of a hard reset — tolerates a single noisy
    // frame without throwing away an otherwise-good detection streak.
    this.streak = Math.max(0, this.streak - 1);
    if (this.streak === 0) {
      this.detectedType = BinType.UNKNOWN;
      this.hasDetection = false;
      this.candidate = BinType.UNKNOWN;
    }
  }

  update(canvas, video) {
    const fw = video.videoWidth, fh = video.videoHeight;
    if (!fw || !fh) return;

    canvas.width = fw; canvas.height = fh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, fw, fh);
    const { data } = ctx.getImageData(0, 0, fw, fh);

    const cellW = Math.floor(fw / COLS);
    const cellH = Math.floor(fh / ROWS);
    const totalCells = COLS * ROWS;

    const cellColors = new Array(totalCells).fill(BinType.UNKNOWN);
    const cellY    = new Array(totalCells).fill(128);
    const cellU    = new Array(totalCells).fill(128);
    const cellV    = new Array(totalCells).fill(128);
    const cellYStd = new Array(totalCells).fill(0);
    const cellMesh = new Array(totalCells).fill(0);

    let rCount = 0, gCount = 0, pCount = 0;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col;
        const x0 = col * cellW, y0 = row * cellH;
        const x1 = Math.min(x0 + cellW, fw), y1 = Math.min(y0 + cellH, fh);

        let sumY = 0, sumU = 0, sumV = 0, sumY2 = 0, cnt = 0, meshHits = 0;
        let prevRowY = null;

        for (let py = y0; py < y1; py += 4) {
          let prevColY = null;
          for (let px = x0; px < x1; px += 4) {
            const i = (py * fw + px) * 4;
            const r = data[i], g = data[i+1], b = data[i+2];
            const Y =  0.299*r + 0.587*g + 0.114*b;
            const U = -0.169*r - 0.331*g + 0.500*b + 128;
            const V =  0.500*r - 0.419*g - 0.081*b + 128;
            sumY += Y; sumU += U; sumV += V; sumY2 += Y*Y;
            // Mesh detection — wire cages produce sharp Y jumps between
            // adjacent samples both horizontally and vertically.
            if (prevColY !== null && Math.abs(Y - prevColY) > 18) meshHits++;
            if (prevRowY !== null && Math.abs(Y - prevRowY) > 18) meshHits++;
            prevColY = Y; cnt++;
          }
          if (prevColY !== null) prevRowY = prevColY;
        }

        if (cnt === 0) continue;

        const mY = sumY/cnt, mU = sumU/cnt, mV = sumV/cnt;
        cellY[idx] = mY; cellU[idx] = mU; cellV[idx] = mV;
        cellYStd[idx] = cnt > 1 ? Math.sqrt(Math.max(0, sumY2/cnt - mY*mY)) : 0;
        cellMesh[idx] = cnt > 0 ? meshHits/cnt : 0;

        const matched = matchBinColor(mY, mU, mV);
        if (matched !== BinType.UNKNOWN) {
          cellColors[idx] = matched;
          if (matched === BinType.COCA_COLA) rCount++;
          else if (matched === BinType.KEELLS) gCount++;
          else if (matched === BinType.ECO_SPINDLES) pCount++;
        }
      }
    }

    let dominant = BinType.UNKNOWN, domCount = 0;
    if (rCount >= gCount && rCount >= pCount) { dominant = BinType.COCA_COLA;    domCount = rCount; }
    if (gCount > rCount  && gCount >= pCount) { dominant = BinType.KEELLS;       domCount = gCount; }
    if (pCount > rCount  && pCount > gCount)  { dominant = BinType.ECO_SPINDLES; domCount = pCount; }

    this.colorCells = domCount;

    // Check 1 — frame coverage
    const frameCover = domCount / totalCells;
    if (dominant === BinType.UNKNOWN || frameCover < MIN_FRAME_COVER_FRACTION) {
      this._miss(); return;
    }

    let minCol = COLS, maxCol = 0, minRow = ROWS, maxRow = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (cellColors[row * COLS + col] === dominant) {
          minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
          minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
        }
      }
    }

    const spanW = maxCol - minCol + 1, spanH = maxRow - minRow + 1;
    const bboxCells = spanW * spanH;

    let bboxMatches = 0, neutralInBbox = 0, sumStd = 0, stdCount = 0, meshCells = 0;

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const idx = row * COLS + col;
        if (cellColors[idx] === dominant) {
          bboxMatches++; sumStd += cellYStd[idx]; stdCount++;
          if (cellYStd[idx] >= 12 || cellMesh[idx] >= 0.10) meshCells++;
        } else if (isNeutralSurface(cellY[idx], cellU[idx], cellV[idx])) {
          neutralInBbox++;
        }
      }
    }

    const bboxColorFraction = bboxCells > 0 ? bboxMatches/bboxCells : 0;
    const avgTextureStd     = stdCount > 0 ? sumStd/stdCount : 0;
    const meshFraction       = stdCount > 0 ? meshCells/stdCount : 0;

    // Check 2 — bbox color density / texture / mesh (anti-spoof core)
    if (bboxColorFraction < MIN_BBOX_COLOR_FRACTION ||
        avgTextureStd < MIN_TEXTURE_STD ||
        meshFraction < MIN_MESH_CELL_FRACTION) {
      this._miss(); return;
    }

    // Check 3 — too much background bleeding into the bbox
    if (bboxCells > 0 && neutralInBbox/bboxCells > 0.42) {
      this._miss(); return;
    }

    // Check 4 — height span / aspect ratio
    const heightFrac = spanH / ROWS;
    const aspectRatio = spanH > 0 ? spanW/spanH : 99;
    if (heightFrac < MIN_HEIGHT_SPAN || aspectRatio > 3.0) {
      this._miss(); return;
    }

    // Check 5 — quadrant fill
    const midCol = Math.floor((minCol+maxCol)/2), midRow = Math.floor((minRow+maxRow)/2);
    const quads = [
      [minCol,minRow,midCol,midRow], [midCol,minRow,maxCol,midRow],
      [minCol,midRow,midCol,maxRow], [midCol,midRow,maxCol,maxRow],
    ];
    let quadrantsFilled = 0;
    for (const [c0,r0,c1,r1] of quads) {
      let filled = false;
      for (let r=r0; r<=r1 && !filled; r++)
        for (let c=c0; c<=c1 && !filled; c++)
          if (cellColors[r*COLS+c] === dominant) filled = true;
      if (filled) quadrantsFilled++;
    }
    if (quadrantsFilled < MIN_QUADRANTS) { this._miss(); return; }

    // Check 6 — structural cue: dark slot, white sign band, or strong mesh
    const slotScanMaxRow = minRow + Math.floor((maxRow-minRow) * 0.62);
    const clusterSize = largestDarkCluster(minRow, slotScanMaxRow, minCol, maxCol, cellY, cellColors, dominant);
    const signBand = hasWhiteSignBand(minRow, maxRow, minCol, maxCol, cellY, cellU, cellV);
    const strongMesh = meshFraction >= STRONG_MESH_FRACTION && avgTextureStd >= STRONG_MESH_TEXTURE;

    this.darkSlotCells = clusterSize;
    this.passedShape = true;

    if (clusterSize < MIN_DARK_CLUSTER && !signBand && !strongMesh) {
      this.passedShape = false;
      this._miss(); return;
    }

    // ── All checks passed — advance the lock streak ────────────────────────
    if (dominant === this.candidate) {
      this.streak = Math.min(this.streak + 1, LOCK_FRAMES + 1);
    } else {
      this.streak = 1;
      this.candidate = dominant;
    }

    if (this.streak >= LOCK_FRAMES) {
      this.detectedType = dominant;
      this.hasDetection = true;
    }
  }
}

// ── saveTrainingSample — unchanged from before ────────────────────────────
export async function saveTrainingSample(imageBlob, label = 'bin', meta = {}) {
  try {
    const auth = getAuth();
    const uid  = auth.currentUser?.uid || 'admin';
    const ts   = Date.now();
    const path = `training_data/${label}/${uid}_${ts}.jpg`;

    const compressed = await compressImage(imageBlob, 320, 240, 0.70);

    const imgRef = ref(storage, path);
    await uploadBytes(imgRef, compressed);

    await addDoc(collection(db, 'training_samples'), {
      label,
      storagePath:     path,
      userId:          uid,
      source:          'admin_scan',
      verified:        true,
      modelWasCorrect: true,
      binId:           meta.binId        || null,
      binType:         meta.binType      || label,
      locationName:    meta.locationName || null,
      timestamp:       serverTimestamp(),
    });

    console.log(`[Training] Saved sample: ${label} → ${path}`, meta.binId ? `(bin ${meta.binId})` : '');
  } catch (err) {
    console.warn('[Training] Failed to save sample:', err.message);
  }
}

function compressImage(blob, maxW, maxH, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxW || height > maxH) {
        const ratio = Math.min(maxW / width, maxH / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(resolve, 'image/jpeg', quality);
    };
    img.src = URL.createObjectURL(blob);
  });
}