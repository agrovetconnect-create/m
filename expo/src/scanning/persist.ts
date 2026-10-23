/**
 * Stage 5 paper-detection engine — TypeScript port of the Stage 1 PoC's
 * measured classical detector (proof-of-concept/live-paper-detection/detector.py:
 * downscale → grayscale → blur → Otsu threshold → close → connected components
 * → geometric validation), so the app and the PoC speak the same language.
 *
 * Framework-free and synchronous: platform adapters (web canvas frames, native
 * camera plugins, synthetic test buffers) hand in a `GrayFrame` and get
 * candidate regions back. The detector knows NOTHING about marks, handwriting,
 * OCR or students — a rectangle is only a candidate paper until the geometric
 * criteria are satisfied.
 *
 * All thresholds live in `DetectionConfig` (mirrors DetectorConfig.py).
 */

export type GrayFrame = {
  w: number;
  h: number;
  /** Row-major grayscale, 0–255. */
  px: Uint8ClampedArray;
};

export type PaperRegion = {
  /** Bounding box in downscaled-frame pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** bbox area ÷ frame area. */
  areaFraction: number;
  /** Laplacian variance of the ROI — measured, not invented. */
  sharpness: number;
  /** Mean ROI luminance 0–255. */
  luminance: number;
  /** Paper reaches (or crosses) the frame edge → likely partial page. */
  touchesEdge: boolean;
  /** Component pixels ÷ bbox area — rejects hollow "frames" (desk borders). */
  fillRatio: number;
};

export type DetectionConfig = {
  /** Paper must fill ≥ this fraction of the frame. */
  minAreaFraction: number;
  minAspect: number;
  maxAspect: number;
  /** Page must be brighter than the desk median by this ratio. */
  minContrastRatio: number;
  /** Component ÷ bbox area floor. */
  minFillRatio: number;
  /** Page touching within this many px of the frame edge = partial. */
  edgeMarginPx: number;
  /** Longest side of the analysis frame (downscale target). */
  analysisWidth: number;
  /** Ignore components smaller than this fraction of the frame. */
  minComponentFraction: number;
  maxRegions: number;
};

export const defaultDetectionConfig: DetectionConfig = {
  minAreaFraction: 0.12,
  minAspect: 0.42,
  maxAspect: 2.4,
  minContrastRatio: 1.5,
  minFillRatio: 0.5,
  edgeMarginPx: 4,
  analysisWidth: 320,
  minComponentFraction: 0.004,
  maxRegions: 8,
};

/** IoU of two (x, y, w, h) boxes. */
export function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.w, b.x + b.w);
  const iy1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Otsu threshold from a 256-bin histogram. Returns the threshold value. */
export function otsuThreshold(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/** Separable 3×3 box blur (cheap noise reduction before thresholding). */
function boxBlur3(px: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = px[y * w + Math.max(0, x - 1)];
      const b = px[y * w + x];
      const c = px[y * w + Math.min(w - 1, x + 1)];
      tmp[y * w + x] = (a + b + c) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = tmp[Math.max(0, y - 1) * w + x];
      const b = tmp[y * w + x];
      const c = tmp[Math.min(h - 1, y + 1) * w + x];
      out[y * w + x] = (a + b + c) / 3;
    }
  }
  return out;
}

/** Binary dilate-then-erode (3×3) — merges text gaps without growing edges. */
function morphClose(mask: Uint8Array, w: number, h: number): Uint8Array {
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && mask[yy * w + xx]) {
            v = 1;
            break;
          }
        }
      }
      dil[y * w + x] = v;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -1; dy <= 1 && v; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (!(yy >= 0 && yy < h && xx >= 0 && xx < w) || !dil[yy * w + xx]) {
            v = 0;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Laplacian variance over a ROI — the sharpness measure used by the PoC and
 * vision-service (blurry when below the configured floor, typically 35). */
export function laplacianVariance(frame: GrayFrame, x0: number, y0: number, rw: number, rh: number): number {
  const { w, h, px } = frame;
  const responses: number[] = [];
  for (let y = Math.max(1, y0); y < Math.min(h - 1, y0 + rh); y++) {
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x0 + rw); x++) {
      const v =
        px[y * w + x - 1] + px[y * w + x + 1] + px[(y - 1) * w + x] + px[(y + 1) * w + x] - 4 * px[y * w + x];
      responses.push(v);
    }
  }
  if (responses.length === 0) return 0;
  const n = responses.length;
  let mean = 0;
  for (const r of responses) mean += r;
  mean /= n;
  let acc = 0;
  for (const r of responses) acc += (r - mean) * (r - mean);
  return acc / n;
}

/**
 * Detect candidate paper regions in one grayscale frame. Returns candidates
 * sorted by area, largest first. Empty array = nothing plausible — the engine
 * reports "no paper" rather than inventing a detection.
 */
export function detectPaper(frame: GrayFrame, cfg: DetectionConfig = defaultDetectionConfig): PaperRegion[] {
  const { w, h, px } = frame;
  const frameArea = w * h;

  const blurred = boxBlur3(px, w, h);

  const hist = new Uint32Array(256);
  for (let i = 0; i < blurred.length; i++) hist[blurred[i]]++;
  const thresh = otsuThreshold(hist, blurred.length);

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = blurred[i] > thresh ? 1 : 0;
  const closed = morphClose(mask, w, h);

  // Connected components (4-connectivity, iterative flood fill).
  const label = new Int32Array(w * h).fill(-1);
  const boxes: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < closed.length; start++) {
    if (!closed[start] || label[start] !== -1) continue;
    const id = boxes.length;
    label[start] = id;
    stack.length = 0;
    stack.push(start);
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let area = 0;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && closed[p - 1] && label[p - 1] === -1) {
        label[p - 1] = id;
        stack.push(p - 1);
      }
      if (x < w - 1 && closed[p + 1] && label[p + 1] === -1) {
        label[p + 1] = id;
        stack.push(p + 1);
      }
      if (y > 0 && closed[p - w] && label[p - w] === -1) {
        label[p - w] = id;
        stack.push(p - w);
      }
      if (y < h - 1 && closed[p + w] && label[p + w] === -1) {
        label[p + w] = id;
        stack.push(p + w);
      }
    }
    boxes.push({ x0, y0, x1, y1, area });
  }

  // Desk reference for the brightness-contrast rule: the frame's 25th
  // percentile (the darker quartile is desk even when paper fills >50% of a
  // close-up view, which would flip the median).
  const sorted = Uint8ClampedArray.from(px).sort();
  const deskRef = sorted[(w * h) >> 2];

  const regions: PaperRegion[] = [];
  for (const b of boxes) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    if (b.area / frameArea < cfg.minComponentFraction) continue;
    const areaFraction = (bw * bh) / frameArea;
    if (areaFraction < cfg.minAreaFraction) continue;
    const aspect = bw / bh;
    if (!(aspect >= cfg.minAspect && aspect <= cfg.maxAspect)) continue;
    const fillRatio = b.area / (bw * bh);
    if (fillRatio < cfg.minFillRatio) continue;
    // A component whose bbox IS the whole frame is the desk itself (or a
    // paper jammed against the lens) — not a scannable sheet.
    if ((bw * bh) / frameArea >= 0.995) continue;
    const margin = cfg.edgeMarginPx;
    const touchesEdge = b.x0 <= margin || b.y0 <= margin || b.x1 >= w - 1 - margin || b.y1 >= h - 1 - margin;
    const roiLuminance = meanOf(frame, b.x0, b.y0, bw, bh);
    // A page is a BRIGHT region on a darker desk; a candidate barely brighter
    // than the desk reference is the desk surface split by Otsu — reject.
    if (roiLuminance < deskRef * cfg.minContrastRatio) continue;
    regions.push({
      x: b.x0,
      y: b.y0,
      w: bw,
      h: bh,
      areaFraction,
      sharpness: laplacianVariance(frame, b.x0, b.y0, bw, bh),
      luminance: roiLuminance,
      touchesEdge,
      fillRatio,
    });
  }

  regions.sort((a, b) => b.w * b.h - a.w * a.h);
  return regions.slice(0, cfg.maxRegions);
}

function meanOf(frame: GrayFrame, x0: number, y0: number, rw: number, rh: number): number {
  const { w, h, px } = frame;
  let acc = 0;
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(h, y0 + rh); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x0 + rw); x++) {
      acc += px[y * w + x];
      n++;
    }
  }
  return n ? acc / n : 0;
}

/* ------------------------------------------------------------------ */
/* Content fingerprint — duplicate suppression helper                  */
/* ------------------------------------------------------------------ */

export const FP_COLS = 12;
export const FP_ROWS = 14;

/**
 * Downsampled grayscale signature of a region (12×14 mean cells). Camera
 * noise, lighting and compression shift a few cells slightly — the tracker
 * compares with an ambiguity band instead of an exact hash.
 */
export function regionFingerprint(frame: GrayFrame, r: PaperRegion): Uint8Array {
  const fp = new Uint8Array(FP_COLS * FP_ROWS);
  for (let cy = 0; cy < FP_ROWS; cy++) {
    for (let cx = 0; cx < FP_COLS; cx++) {
      const cw = r.w / FP_COLS;
      const ch = r.h / FP_ROWS;
      const x0 = Math.round(r.x + cx * cw);
      const y0 = Math.round(r.y + cy * ch);
      const x1 = Math.round(r.x + (cx + 1) * cw);
      const y1 = Math.round(r.y + (cy + 1) * ch);
      fp[cy * FP_COLS + cx] = Math.round(meanOf(frame, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)));
    }
  }
  return fp;
}

/** Mean absolute cell difference (0–255 scale) between two fingerprints. */
export function fingerprintDistance(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 255;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc += Math.abs(a[i] - b[i]);
  return acc / a.length;
}

/* ------------------------------------------------------------------ */
/* Adapter helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Convert an RGBA pixel buffer (web canvas ImageData, native camera plugin
 * output) to a downscaled GrayFrame. Box-averaged downscale — cheap and
 * less noisy than nearest-neighbor.
 */
export function grayFromRgba(rgba: Uint8ClampedArray, w: number, h: number, targetW: number): GrayFrame {
  const scale = Math.min(1, targetW / w);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const out = new Uint8ClampedArray(dw * dh);
  const stepX = w / dw;
  const stepY = h / dh;
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor(y * stepY);
    const sy1 = Math.min(h, Math.max(sy0 + 1, Math.floor((y + 1) * stepY)));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor(x * stepX);
      const sx1 = Math.min(w, Math.max(sx0 + 1, Math.floor((x + 1) * stepX)));
      let acc = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * w + sx) * 4;
          // Rec. 601 luma; alpha ignored (camera frames are opaque).
          acc += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          n++;
        }
      }
      out[y * dw + x] = n ? acc / n : 0;
    }
  }
  return { w: dw, h: dh, px: out };
}
