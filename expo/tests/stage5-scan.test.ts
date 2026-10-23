/**
 * Stage 5 tests — live paper detection, stability/auto-capture, duplicate
 * suppression, and scan persistence. All frames are SYNTHETIC pixel buffers
 * (dark desk, bright paper shapes); real-camera performance is reported
 * separately and never claimed from these tests.
 */
import { describe, expect, test } from "bun:test";
import {
  detectPaper,
  defaultDetectionConfig,
  fingerprintDistance,
  grayFromRgba,
  regionFingerprint,
  type GrayFrame,
  type PaperRegion,
} from "../src/scanning/paper-detect";
import {
  CaptureTracker,
  FP_DIFFERENT,
  FP_SAME,
  defaultCapturePolicy,
  type TrackerDecision,
} from "../src/scanning/auto-capture";
import {
  CAPTURES_KEY,
  MemoryImageStore,
  MemoryStorageAdapter,
  ScanArchive,
  SESSIONS_KEY,
  captureFileName,
  type StorageAdapter,
} from "../src/scanning/persist";

/* ---------------- synthetic scene helpers ---------------- */

const W = 320;
const H = 240;

function mkFrame(desk = 60): GrayFrame {
  return { w: W, h: H, px: new Uint8ClampedArray(W * H).fill(desk) };
}

function fillRect(f: GrayFrame, x0: number, y0: number, w: number, h: number, v = 200): void {
  for (let y = Math.max(0, y0); y < Math.min(f.h, y0 + h); y++)
    for (let x = Math.max(0, x0); x < Math.min(f.w, x0 + w); x++) f.px[y * f.w + x] = v;
}

type Pt = [number, number];

function fillQuad(f: GrayFrame, pts: [Pt, Pt, Pt, Pt], v = 200): void {
  // even-odd ray cast — fine for 320×240 test scenes
  const edges: [Pt, Pt][] = [
    [pts[0], pts[1]],
    [pts[1], pts[2]],
    [pts[2], pts[3]],
    [pts[3], pts[0]],
  ];
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      let inside = false;
      for (const [a, b] of edges) {
        if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      if (inside) f.px[y * f.w + x] = v;
    }
  }
}

function rotatedQuad(cx: number, cy: number, w: number, h: number, deg: number): [Pt, Pt, Pt, Pt] {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const corner = (dx: number, dy: number): Pt => [cx + dx * c - dy * s, cy + dx * s + dy * c];
  return [corner(-w / 2, -h / 2), corner(w / 2, -h / 2), corner(w / 2, h / 2), corner(-w / 2, h / 2)];
}

/** Deterministic sensor noise. */
function addNoise(f: GrayFrame, amt: number, seed = 42): void {
  let s = seed;
  for (let i = 0; i < f.px.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    f.px[i] = Math.max(0, Math.min(255, f.px[i] + ((s % (2 * amt + 1)) - amt)));
  }
}

function mkRegion(over: Partial<PaperRegion> = {}): PaperRegion {
  return {
    x: 70,
    y: 40,
    w: 180,
    h: 160,
    areaFraction: 0.3,
    sharpness: 120,
    luminance: 160,
    touchesEdge: false,
    fillRatio: 0.9,
    ...over,
  };
}

/* ---------------- A. paper detection ---------------- */

describe("stage5: paper detection (synthetic frames)", () => {
  test("detects a centered A4-like sheet", () => {
    const f = mkFrame();
    fillRect(f, 70, 35, 170, 170); // A4-ratio-ish sheet, clear of the edges
    addNoise(f, 3);
    const regions = detectPaper(f);
    expect(regions.length).toBe(1);
    const r = regions[0];
    expect(r.areaFraction).toBeGreaterThan(0.35);
    expect(r.touchesEdge).toBe(false);
    expect(r.luminance).toBeGreaterThan(150);
    expect(r.sharpness).toBeGreaterThan(0);
  });

  test("detects a rotated sheet (moderate orientation change)", () => {
    const f = mkFrame();
    fillQuad(f, rotatedQuad(160, 120, 170, 210, 7));
    addNoise(f, 3);
    const regions = detectPaper(f);
    expect(regions.length).toBe(1);
    expect(regions[0].areaFraction).toBeGreaterThan(0.35);
  });

  test("detects a perspective-distorted sheet", () => {
    const f = mkFrame();
    fillQuad(f, [
      [40, 40],
      [280, 55],
      [265, 215],
      [55, 200],
    ]);
    addNoise(f, 3);
    const regions = detectPaper(f);
    expect(regions.length).toBe(1);
    expect(regions[0].areaFraction).toBeGreaterThan(0.4);
  });

  test("rejects a sheet too small in the frame", () => {
    const f = mkFrame();
    fillRect(f, 140, 100, 60, 50); // ~4% of frame
    const regions = detectPaper(f);
    expect(regions.length).toBe(0);
  });

  test("flags a sheet partially outside the frame (touching edge)", () => {
    const f = mkFrame();
    fillRect(f, -40, 30, 170, 230); // left part out of frame
    const regions = detectPaper(f);
    expect(regions.length).toBe(1);
    expect(regions[0].touchesEdge).toBe(true);
  });

  test("reports no paper on an empty desk", () => {
    const f = mkFrame();
    addNoise(f, 4);
    expect(detectPaper(f).length).toBe(0);
  });

  test("ignores desk-edge rectangles (hollow bright frame rejected by fill ratio)", () => {
    const f = mkFrame();
    // A bright desk border region: large bbox but sparse (hollow) content.
    fillRect(f, 10, 10, 300, 8);
    fillRect(f, 10, 222, 300, 8);
    fillRect(f, 10, 10, 8, 220);
    fillRect(f, 302, 10, 8, 220);
    const regions = detectPaper(f);
    expect(regions.length).toBe(0);
  });

  test("rejects a shadowed paper (not brighter than the desk)", () => {
    const f = mkFrame(70);
    fillRect(f, 70, 30, 170, 230, 40); // dark shadowed sheet on lighter desk
    addNoise(f, 2);
    expect(detectPaper(f).length).toBe(0);
  });

  test("rejects a low-contrast sheet (luminance near the desk median)", () => {
    const f = mkFrame(75);
    fillRect(f, 70, 30, 170, 230, 90); // only 1.2× the desk
    addNoise(f, 2);
    expect(detectPaper(f).length).toBe(0);
  });

  test("reports multiple papers as separate candidates", () => {
    const f = mkFrame();
    fillRect(f, 15, 30, 120, 170);
    fillRect(f, 180, 30, 120, 170);
    const regions = detectPaper(f);
    expect(regions.length).toBe(2);
  });

  test("fingerprints: same sheet close, different sheet far", () => {
    const f = mkFrame();
    fillRect(f, 70, 30, 170, 230, 200);
    fillRect(f, 90, 60, 130, 60, 120); // "handwriting" block
    const r = detectPaper(f)[0];
    const fp = regionFingerprint(f, r);
    expect(fp.length).toBe(12 * 14);
    expect(fingerprintDistance(fp, fp)).toBe(0);
    const f2 = mkFrame();
    fillRect(f2, 70, 30, 170, 230, 200);
    fillRect(f2, 90, 60, 130, 60, 250); // very different content
    const r2 = detectPaper(f2)[0];
    const fp2 = regionFingerprint(f2, r2);
    const d = fingerprintDistance(fp, fp2);
    expect(d).toBeGreaterThan(FP_DIFFERENT);
  });

  test("grayFromRgba converts RGBA buffers with downscaling", () => {
    const rgba = new Uint8ClampedArray(640 * 480 * 4);
    for (let i = 0; i < 640 * 480; i++) rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
    const g = grayFromRgba(rgba, 640, 480, 320);
    expect(g.w).toBe(320);
    expect(g.h).toBe(240);
    expect(g.px[0]).toBe(255);
  });
});

/* ---------------- B. stability + automatic capture ---------------- */

function feed(
  tracker: CaptureTracker,
  regions: PaperRegion[] | null,
  n: number,
  t0: number,
  step = 200,
  fingerprintOf?: (r: PaperRegion) => Uint8Array | null,
): TrackerDecision[] {
  const out: TrackerDecision[] = [];
  for (let i = 0; i < n; i++) {
    out.push(tracker.observe({ regions, tMs: t0 + i * step, fingerprintOf }));
  }
  return out;
}

describe("stage5: stability & auto-capture", () => {
  test("a moving sheet never reaches capture-ready", () => {
    const tr = new CaptureTracker();
    for (let i = 0; i < 12; i++) {
      // 15 px/frame keeps consecutive IoU below the 0.88 stability bar
      const d = tr.observe({ regions: [mkRegion({ x: 40 + i * 15, y: 30 })], tMs: i * 200 });
      expect(d.capture).toBe(false);
    }
  });

  test("a stable sheet becomes capture-ready after policy frames", () => {
    const tr = new CaptureTracker();
    const ds = feed(tr, [mkRegion()], 4, 0);
    expect(ds[0].phase).toBe("candidateDetected");
    expect(ds[1].phase).toBe("waitingStability");
    expect(ds[3].capture).toBe(true);
    expect(ds[3].phase).toBe("captureReady");
  });

  test("single-flight: beginCapture twice resolves once", () => {
    const tr = new CaptureTracker();
    feed(tr, [mkRegion()], 4, 0);
    expect(tr.beginCapture()).toBe(true);
    expect(tr.beginCapture()).toBe(false);
  });

  test("no capture while paused; resume restarts stability from scratch", () => {
    const tr = new CaptureTracker();
    feed(tr, [mkRegion()], 2, 0);
    tr.pause();
    const d = tr.observe({ regions: [mkRegion()], tMs: 1000 });
    expect(d.phase).toBe("paused");
    expect(d.capture).toBe(false);
    tr.resume();
    const ds = feed(tr, [mkRegion()], 2, 2000);
    expect(ds[1].capture).toBe(false); // stability restarts after resume
    const after = feed(tr, [mkRegion()], 1, 3000);
    expect(after[0].phase).toBe("captureReady");
  });

  test("camera loss pauses the machine and reports cameraLost, not 'no paper'", () => {
    const tr = new CaptureTracker();
    feed(tr, [mkRegion()], 2, 0);
    const d = tr.observe({ regions: null, tMs: 1000 });
    expect(d.phase).toBe("cameraLost");
  });

  test("quality issues gate capture with a measurable reason", () => {
    const tr = new CaptureTracker();
    const blurry = feed(tr, [mkRegion({ sharpness: 10 })], 4, 0);
    expect(blurry[3].phase).toBe("qualityInsufficient");
    expect(blurry[3].reason).toBe("blurry");
    const tr2 = new CaptureTracker();
    const dark = feed(tr2, [mkRegion({ luminance: 30 })], 4, 0);
    expect(dark[3].reason).toBe("tooDark");
  });

  test("capture failure recovers: next stable placement can capture again", () => {
    const tr = new CaptureTracker();
    feed(tr, [mkRegion()], 3, 0);
    tr.beginCapture();
    tr.finishCapture(700, false); // save failed
    const ds = feed(tr, [mkRegion()], 4, 2000); // past cooldown
    expect(ds[3].capture).toBe(true);
  });
});

/* ---------------- C. duplicate suppression ---------------- */

describe("stage5: duplicate suppression", () => {
  test("a stationary sheet is captured once, never repeatedly", () => {
    const tr = new CaptureTracker();
    const ds = feed(tr, [mkRegion()], 3, 0);
    expect(ds[2].capture).toBe(true);
    tr.beginCapture();
    // UI: save finished, sheet stays in frame
    tr.rememberCaptured({ x: 70, y: 40, w: 180, h: 160 }, new Uint8Array(168).fill(150));
    tr.finishCapture(700, true);
    const more = feed(tr, [mkRegion()], 10, 3000);
    expect(more.every((d) => !d.capture)).toBe(true);
  });

  test("a brief detection interruption does not immediately re-arm the sheet", () => {
    const tr = new CaptureTracker();
    feed(tr, [mkRegion()], 3, 0);
    tr.beginCapture();
    tr.rememberCaptured({ x: 70, y: 40, w: 180, h: 160 }, new Uint8Array(168).fill(150));
    tr.finishCapture(700, true);
    // one empty sample (hand passed over the sheet), then the sheet again
    feed(tr, [], 1, 2000);
    const after = feed(tr, [mkRegion()], 6, 4000);
    expect(after.every((d) => !d.capture)).toBe(true);
  });

  test("sheet removal re-arms: the next placement captures", () => {
    const tr = new CaptureTracker();
    feed(tr, [mkRegion()], 3, 0);
    tr.beginCapture();
    tr.rememberCaptured({ x: 70, y: 40, w: 180, h: 160 }, new Uint8Array(168).fill(150));
    tr.finishCapture(700, true);
    feed(tr, [], 2, 2000); // desk clear per policy (leaveFrames)
    const next = feed(tr, [mkRegion({ x: 60, y: 50 })], 4, 6000);
    expect(next[3].capture).toBe(true);
  });

  test("a visually similar but DIFFERENT sheet (post-removal) is not discarded", () => {
    // After a genuine removal the fingerprint memory is cleared by policy:
    // a new sheet that looks similar must still be captured.
    const tr = new CaptureTracker();
    feed(tr, [mkRegion()], 3, 0);
    tr.beginCapture();
    tr.rememberCaptured({ x: 70, y: 40, w: 180, h: 160 }, new Uint8Array(168).fill(150));
    tr.finishCapture(700, true);
    feed(tr, [], 2, 2000);
    const next = feed(tr, [mkRegion({ x: 60, y: 50 })], 4, 6000);
    expect(next[3].capture).toBe(true);
    expect(next[3].possibleDuplicate).toBeUndefined();
  });

  test("ambiguous fingerprint → capture retained but flagged for review", () => {
    const tr = new CaptureTracker();
    const oldFp = new Uint8Array(168).fill(120);
    // sheet captured, then shifts slightly beyond duplicate IoU without leaving
    feed(tr, [mkRegion()], 3, 0);
    tr.beginCapture();
    tr.rememberCaptured({ x: 70, y: 40, w: 180, h: 160 }, oldFp);
    tr.finishCapture(700, true);
    // same-ish geometry (IoU ≈ 0.76 < duplicateIou vs captured bounds) with an
    // ambiguous fingerprint: every cell shifted +12 → distance 12, inside the
    // (FP_SAME, FP_DIFFERENT) band → retain + flag, never silently discard
    const shifted = mkRegion({ x: 45, y: 40 });
    const fp2 = new Uint8Array(168).fill(132);
    expect(fingerprintDistance(oldFp, fp2)).toBeGreaterThan(FP_SAME);
    expect(fingerprintDistance(oldFp, fp2)).toBeLessThan(FP_DIFFERENT);
    const ds = feed(tr, [shifted], 4, 4000, 200, () => fp2);
    expect(ds[2].capture).toBe(true); // ambiguous resolution fires on the 3rd sample
    expect(ds[2].possibleDuplicate).toBe(true);
  });

  test("the never-removed same sheet is suppressed by fingerprint too", () => {
    const tr = new CaptureTracker();
    const fp = new Uint8Array(168).fill(150);
    feed(tr, [mkRegion()], 3, 0, 200, () => fp);
    tr.beginCapture();
    tr.rememberCaptured({ x: 70, y: 40, w: 180, h: 160 }, fp);
    tr.finishCapture(700, true);
    // sheet moved slightly (IoU < 0.9, so geometry misses) but the content is
    // identical → the fingerprint check still suppresses the recapture
    const ds = feed(tr, [mkRegion({ x: 50, y: 40 })], 4, 4000, 200, () => fp);
    expect(ds[3].capture).toBe(false);
    expect(ds[3].phase).toBe("captured");
  });
});

/* ---------------- D. persistence & recovery ---------------- */

/** Storage adapter whose setItem can be made to fail (db-failure tests). */
class FlakyStorageAdapter implements StorageAdapter {
  backend = new MemoryStorageAdapter();
  failCaptures = false;
  getItem = (k: string) => this.backend.getItem(k);
  setItem = async (k: string, v: string) => {
    if (this.failCaptures && k === CAPTURES_KEY) throw new Error("quota-exceeded");
    await this.backend.setItem(k, v);
  };
  removeItem = (k: string) => this.backend.removeItem(k);
}

/** Image store whose put can be made to fail (disk-full simulation). */
class FlakyImageStore implements ImageStore {
  backend = new MemoryImageStore();
  failPut = false;
  put = async (n: string, b: Uint8Array) => {
    if (this.failPut) throw new Error("insufficient-storage");
    return this.backend.put(n, b);
  };
  getData = (r: string) => this.backend.getData(r);
  exists = (r: string) => this.backend.exists(r);
  remove = (r: string) => this.backend.remove(r);
  list = () => this.backend.list();
}

describe("stage5: persistence & recovery", () => {
  test("session + capture records persist with unique ids, filenames and seq", async () => {
    const st = new MemoryStorageAdapter();
    const arch = new ScanArchive(st, new MemoryImageStore());
    await arch.load();
    await arch.startSession("c1", "Quiz 1", "ordinary", "s-1", new Date(2026, 0, 1).toISOString());
    const r1 = await arch.saveCapture({
      sessionId: "s-1",
      seq: 1,
      captureId: "cap-a",
      bytes: new Uint8Array([1, 2, 3]),
      capturedAt: new Date(2026, 0, 1).toISOString(),
      detection: { areaFraction: 0.4, aspect: 0.75, sharpness: 90, luminance: 180, bounds: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } },
    });
    expect(r1.ok).toBe(true);
    const r2 = await arch.saveCapture({
      sessionId: "s-1",
      seq: 2,
      captureId: "cap-b",
      bytes: new Uint8Array([4, 5]),
      capturedAt: new Date(2026, 0, 1).toISOString(),
    });
    expect(r2.ok).toBe(true);
    expect(arch.capturesOf("s-1").length).toBe(2);
    expect(arch.captures[0].fileName).not.toBe(arch.captures[1].fileName);
    expect(captureFileName("s-1", 1, "cap-a")).not.toContain("/");
    // restart: fresh archive over the same adapters sees everything
    const rawSessions = await st.getItem(SESSIONS_KEY);
    const rawCaptures = await st.getItem(CAPTURES_KEY);
    const arch2 = new ScanArchive(
      {
        getItem: async (k) => (k === SESSIONS_KEY ? rawSessions : k === CAPTURES_KEY ? rawCaptures : null),
        setItem: async () => {},
        removeItem: async () => {},
      },
      {
        put: async (n, b) => {
          void n;
          void b;
          return n;
        },
        getData: async (ref) => (ref.endsWith("cap-s-1-1-cap-a.jpg") ? new Uint8Array([1, 2, 3]) : null),
        exists: async (ref) => ref.endsWith("cap-s-1-1-cap-a.jpg"),
        remove: async () => {},
        list: async () => ["cap-s-1-1-cap-a.jpg"],
      },
    );
    await arch2.load();
    expect(arch2.sessions[0].id).toBe("s-1");
    expect(arch2.captures.length).toBe(2);
  });

  test("image write failure → honest saveFailed, NO metadata record", async () => {
    const imgs = new FlakyImageStore();
    imgs.failPut = true;
    const arch = new ScanArchive(new MemoryStorageAdapter(), imgs);
    await arch.load();
    await arch.startSession("c1", "Q", "ordinary", "s-1", new Date().toISOString());
    const r = await arch.saveCapture({
      sessionId: "s-1",
      seq: 1,
      captureId: "x",
      bytes: new Uint8Array([1]),
      capturedAt: new Date().toISOString(),
    });
    expect(r.ok).toBe(false);
    expect(arch.captures.length).toBe(0);
  });

  test("metadata write failure after image save → no saved record; reconcile cleans the orphan", async () => {
    const st = new FlakyStorageAdapter();
    st.failCaptures = true;
    const arch = new ScanArchive(st, new MemoryImageStore());
    await arch.load();
    await arch.startSession("c1", "Q", "ordinary", "s-1", new Date().toISOString());
    const r = await arch.saveCapture({
      sessionId: "s-1",
      seq: 1,
      captureId: "x",
      bytes: new Uint8Array([7, 7, 7]),
      capturedAt: new Date().toISOString(),
    });
    expect(r.ok).toBe(false);
    expect(arch.captures.length).toBe(0);
    // the file landed but nothing references it → crash-rollback removes it
    const report = await arch.reconcile(0, new Date().toISOString());
    expect(report.orphansRemoved.length).toBe(1);
    expect(report.orphansRemoved[0]).toContain("cap-");
  });

  test("missing file detection: metadata without image → missingFile, never shown as saved", async () => {
    const st = new MemoryStorageAdapter();
    const imgs = new MemoryImageStore();
    const arch = new ScanArchive(st, imgs);
    await arch.load();
    await arch.startSession("c1", "Q", "ordinary", "s-1", new Date().toISOString());
    await arch.saveCapture({ sessionId: "s-1", seq: 1, captureId: "x", bytes: new Uint8Array([1]), capturedAt: new Date().toISOString() });
    await imgs.remove(arch.captures[0].imageRef);
    const report = await arch.reconcile(Date.now(), new Date().toISOString());
    expect(report.missingFiles).toEqual([arch.captures[0].id]);
    expect(arch.captures[0].status).toBe("missingFile");
  });

  test("interrupted sessions: an active session from a previous run is marked interrupted", async () => {
    const st = new MemoryStorageAdapter();
    const arch = new ScanArchive(st, new MemoryImageStore());
    await arch.load();
    await arch.startSession("c1", "Q", "ordinary", "s-old", new Date(2020, 0, 1).toISOString());
    await arch.startSession("c1", "Q", "ordinary", "s-new", new Date(Date.now() + 60_000).toISOString());
    const report = await arch.reconcile(Date.now(), new Date().toISOString());
    expect(report.interrupted).toEqual(["s-old"]);
    expect(arch.sessions.find((s) => s.id === "s-old")?.status).toBe("interrupted");
    expect(arch.sessions.find((s) => s.id === "s-new")?.status).toBe("active");
  });

  test("temporary files are cleaned; valid captures remain intact", async () => {
    const st = new MemoryStorageAdapter();
    const imgs = new MemoryImageStore();
    const arch = new ScanArchive(st, imgs);
    await arch.load();
    await arch.startSession("c1", "Q", "ordinary", "s-1", new Date().toISOString());
    await arch.saveCapture({ sessionId: "s-1", seq: 1, captureId: "keep", bytes: new Uint8Array([1]), capturedAt: new Date().toISOString() });
    await imgs.put("cap-xyz.tmp", new Uint8Array([9]), "image/jpeg");
    await arch.reconcile(Date.now(), new Date().toISOString());
    expect(await imgs.exists("cap-xyz.tmp")).toBe(false);
    expect(await imgs.exists(arch.captures[0].imageRef.split("/").pop() ?? "")).toBe(true);
    expect(arch.captures[0].status).toBe("saved");
  });

  test("teacher removes a capture: metadata and file both go, others stay", async () => {
    const st = new MemoryStorageAdapter();
    const imgs = new MemoryImageStore();
    const arch = new ScanArchive(st, imgs);
    await arch.load();
    await arch.startSession("c1", "Q", "ordinary", "s-1", new Date().toISOString());
    await arch.saveCapture({ sessionId: "s-1", seq: 1, captureId: "a", bytes: new Uint8Array([1]), capturedAt: new Date().toISOString() });
    await arch.saveCapture({ sessionId: "s-1", seq: 2, captureId: "b", bytes: new Uint8Array([2]), capturedAt: new Date().toISOString() });
    const gone = arch.captures[0];
    expect(await arch.removeCapture(gone.id)).toBe(true);
    expect(arch.captures.length).toBe(1);
    expect(await imgs.exists(gone.imageRef.split("/").pop() ?? "")).toBe(false);
    expect(await imgs.exists(arch.captures[0].imageRef.split("/").pop() ?? "")).toBe(true);
  });

  test("corrupt persisted JSON quarantines to the empty state instead of crashing", async () => {
    const st = new MemoryStorageAdapter();
    await st.setItem(SESSIONS_KEY, "{{{not json");
    const arch = new ScanArchive(st, new MemoryImageStore());
    await arch.load();
    expect(arch.sessions).toEqual([]);
    expect(arch.captures).toEqual([]);
  });

  test("session lifecycle: pause → resume → end (images survive end)", async () => {
    const st = new MemoryStorageAdapter();
    const imgs = new MemoryImageStore();
    const arch = new ScanArchive(st, imgs);
    await arch.load();
    await arch.startSession("c1", "Q", "ordinary", "s-1", new Date().toISOString());
    await arch.saveCapture({ sessionId: "s-1", seq: 1, captureId: "a", bytes: new Uint8Array([1]), capturedAt: new Date().toISOString() });
    await arch.setSessionStatus("s-1", "paused");
    await arch.setSessionStatus("s-1", "active");
    await arch.setSessionStatus("s-1", "completed", new Date().toISOString());
    expect(arch.sessions[0].status).toBe("completed");
    expect(arch.captures.length).toBe(1);
    expect(await imgs.exists("cap-s-1-1-a.jpg")).toBe(true);
  });

  test("default policy sanity (documented thresholds)", () => {
    expect(defaultCapturePolicy.stabilityFrames).toBeGreaterThanOrEqual(2);
    expect(defaultCapturePolicy.duplicateIou).toBeGreaterThan(defaultCapturePolicy.stabilityIou - 0.001);
    expect(defaultDetectionConfig.minAreaFraction).toBeGreaterThan(0);
  });
});
