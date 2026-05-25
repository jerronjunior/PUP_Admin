// src/lib/binDetectionModel.js
// Shared bin detection model (ported from provided model snippet)

export const COLS = 16;
export const ROWS = 12;
export const LOCK_FRAMES = 15;
export const MIN_COVER = 0.22;
export const MIN_HEIGHT = 0.35;
export const MAX_ASPECT = 1.8;
export const MIN_QUADS = 4;

// RGB -> YUV, also return R,G,B for pre-filter
export function rgbToYuv(r, g, b) {
  return {
    Y:  0.299 * r + 0.587 * g + 0.114 * b,
    U: -0.169 * r - 0.331 * g + 0.500 * b + 128,
    V:  0.500 * r - 0.419 * g - 0.081 * b + 128,
    R: r, G: g, B: b,
  };
}

// classifyCell — two-stage filter (RGB prefilter + YUV fine filter)
export function classifyCell(Y, U, V, R, G, B) {
  const isGreenDominant = G > R * 1.30 && G > B * 1.05 && G > 75;
  const isRedDominant   = R > G * 1.40 && R > B * 1.50 && R > 80;
  const isPurplish      = R > G * 0.90 && B > G * 0.90 && R < 130 && Y < 90;

  if (!isGreenDominant && !isRedDominant && !isPurplish) return null;

  // RED bins
  if (isRedDominant
      && Y >= 39 && Y <= 144
      && U >= 101 && U <= 124
      && V >= 137 && V <= 197) return 'bin';

  // GREEN bins
  if (isGreenDominant
      && Y >= 40 && Y <= 145
      && U >= 112 && U <= 134
      && V >= 88  && V <= 125) return 'bin';

  // PURPLE bins
  if (isPurplish
      && Y >= 18 && Y <= 90
      && U >= 118 && U <= 160
      && V >= 108 && V <= 145) return 'bin';

  return null;
}

// detectBinInFrame: grid-based accumulation and checks
export function detectBinInFrame(canvas, video) {
  const fw = video.videoWidth, fh = video.videoHeight;
  if (!fw || !fh) return null;

  canvas.width = fw; canvas.height = fh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, fw, fh);
  const { data } = ctx.getImageData(0, 0, fw, fh);

  const cellW = Math.floor(fw / COLS);
  const cellH = Math.floor(fh / ROWS);
  const cells = new Array(COLS * ROWS).fill(null);
  const counts = { bin: 0 };

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = col * cellW, y0 = row * cellH;
      let sumY=0, sumU=0, sumV=0, sumR=0, sumG=0, sumB=0, cnt=0;
      for (let py = y0; py < Math.min(y0 + cellH, fh); py += 5) {
        for (let px = x0; px < Math.min(x0 + cellW, fw); px += 5) {
          const i = (py * fw + px) * 4;
          const yuv = rgbToYuv(data[i], data[i+1], data[i+2]);
          sumY+=yuv.Y; sumU+=yuv.U; sumV+=yuv.V;
          sumR+=yuv.R; sumG+=yuv.G; sumB+=yuv.B; cnt++;
        }
      }
      if (!cnt) continue;
      const c = classifyCell(sumY/cnt, sumU/cnt, sumV/cnt, sumR/cnt, sumG/cnt, sumB/cnt);
      cells[row * COLS + col] = c;
      if (c) counts[c]++;
    }
  }
  // Dominant type
  let dominant = null, domCount = 0;
  for (const [t, n] of Object.entries(counts)) {
    if (n > domCount) { dominant = t; domCount = n; }
  }

  if (!dominant || domCount / (COLS * ROWS) < MIN_COVER) return null;

  let minC = COLS, maxC = 0, minR = ROWS, maxR = 0;
  cells.forEach((c, i) => {
    if (c !== dominant) return;
    const col = i % COLS, row = Math.floor(i / COLS);
    if (col < minC) minC = col; if (col > maxC) maxC = col;
    if (row < minR) minR = row; if (row > maxR) maxR = row;
  });
  const spanW = maxC - minC + 1, spanH = maxR - minR + 1;

  if (spanH / ROWS < MIN_HEIGHT) return null;
  if (spanH > 0 && spanW / spanH > MAX_ASPECT) return null;

  const mC = Math.floor((minC + maxC) / 2), mR = Math.floor((minR + maxR) / 2);
  const quads = [[minC,minR,mC,mR],[mC,minR,maxC,mR],[minC,mR,mC,maxR],[mC,mR,maxC,maxR]];
  let filled = 0;
  for (const [c0,r0,c1,r1] of quads) {
    let ok = false;
    for (let r = r0; r <= r1 && !ok; r++)
      for (let c = c0; c <= c1 && !ok; c++)
        if (cells[r * COLS + c] === dominant) ok = true;
    if (ok) filled++;
  }
  if (filled < MIN_QUADS) return null;

  return dominant;
}
