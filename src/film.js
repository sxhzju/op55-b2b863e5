/* 《10月8日 (1)-副本(1)》 — a living sketchbook.
 * Every frame is a pure function of its frame number: window.renderFrame(f).
 * World = one sheet of paper (3240 x 4320). The camera travels across it.
 */
'use strict';

const W = 1080, H = 1440, FPS = 30;
const DURATION = 22.9;                     // audio 22.21s + ~0.7s designed hold
const TOTAL_FRAMES = Math.ceil(DURATION * FPS);
const PAGE_W = 3240, PAGE_H = 4320;

const COL = {
  paper: '#F4EEE2', ink: '#24232B', red: '#E0533A', blue: '#3F68B0',
  ochre: '#EFB94A', washBlue: '#5B8EE0', graphite: '#6A6670', paperLight: '#FBF6EC',
};

/* ------------------------------------------------------------------ math */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const k = (t, a, b) => clamp((t - a) / (b - a));
const TAU = Math.PI * 2;

function ih(x) {
  x |= 0;
  x = (x ^ 61) ^ (x >>> 16); x = x + (x << 3); x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d); x = x ^ (x >>> 15);
  return (x >>> 0) / 4294967296;
}
const rnd = (a, b = 0) => ih(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ 0x5bd1e995);
function vnoise(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(rnd(i, seed), rnd(i + 1, seed), u);
}
const snoise = (x, seed) => vnoise(x, seed) * 2 - 1;

function bezierEase(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t) => ((ax * t + bx) * t + cx) * t;
  const fy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = fx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break; t -= e / d; }
    t = clamp(t);
    return fy(t);
  };
}
const E = {
  lin: (t) => t,
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  outBack: (t, s = 1.7) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  inBack: (t, s = 1.7) => (s + 1) * t * t * t - s * t * t,
  // custom curves: anticipation-heavy camera moves and snappy arrivals
  camA: bezierEase(0.62, 0.0, 0.12, 1.0),
  camB: bezierEase(0.45, 0.0, 0.08, 1.0),
  camC: bezierEase(0.7, -0.08, 0.16, 1.0),
  camD: bezierEase(0.58, 0.0, 0.04, 1.0),
  pen: bezierEase(0.3, 0.0, 0.15, 1.0),
  penFast: bezierEase(0.15, 0.4, 0.1, 1.0),
};
// damped spring step response, x in seconds
function spring(x, f = 2.4, z = 0.32) {
  if (x <= 0) return 0;
  const w = TAU * f, wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + ((z * w) / wd) * Math.sin(wd * x));
}
// decaying wiggle impulse (0 at x=0, returns to 0)
function kick(x, f = 3, decay = 6) {
  if (x <= 0) return 0;
  return Math.exp(-decay * x) * Math.sin(TAU * f * x);
}

/* ------------------------------------------------------------- polylines */
class Poly {
  constructor(pts, closed = false) {
    this.pts = pts; this.closed = closed;
    const cum = new Float64Array(pts.length); let L = 0;
    for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum[i] = L; }
    this.cum = cum; this.len = L;
  }
  at(u) {
    const s = clamp(u) * this.len, c = this.cum, p = this.pts;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] < s) lo = m; else hi = m; }
    const seg = c[hi] - c[lo] || 1, f = (s - c[lo]) / seg;
    return [lerp(p[lo][0], p[hi][0], f), lerp(p[lo][1], p[hi][1], f)];
  }
  tangent(u) {
    const a = this.at(Math.max(0, u - 0.004)), b = this.at(Math.min(1, u + 0.004));
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
  // sub-polyline between arc fractions; returns {pts, s0} where s0 = absolute arc start
  sub(a, b) {
    a = clamp(a); b = clamp(b); if (b <= a) return { pts: [], s0: 0 };
    const sa = a * this.len, sb = b * this.len, out = [this.at(a)], c = this.cum;
    for (let i = 0; i < this.pts.length; i++) if (c[i] > sa && c[i] < sb) out.push(this.pts[i]);
    out.push(this.at(b));
    return { pts: out, s0: sa };
  }
  resample(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.at(i / (n - 1)));
    return out;
  }
}

class PathB {
  constructor() { this.p = []; this.c = null; this.step = 5; }
  M(x, y) { this.p.push([x, y]); this.c = [x, y]; return this; }
  L(x, y) {
    const [x0, y0] = this.c, n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / this.step));
    for (let i = 1; i <= n; i++) this.p.push([lerp(x0, x, i / n), lerp(y0, y, i / n)]);
    this.c = [x, y]; return this;
  }
  C(x1, y1, x2, y2, x, y) {
    const [x0, y0] = this.c;
    const est = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2);
    const n = Math.max(2, Math.ceil(est / this.step));
    for (let i = 1; i <= n; i++) {
      const t = i / n, mt = 1 - t;
      this.p.push([mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x,
                   mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y]);
    }
    this.c = [x, y]; return this;
  }
  Q(x1, y1, x, y) { const [x0, y0] = this.c; return this.C(x0 + (2 / 3) * (x1 - x0), y0 + (2 / 3) * (y1 - y0), x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), x, y); }
  // elliptical arc around (cx,cy) from a0 to a1 (radians); first point is joined
  A(cx, cy, rx, ry, a0, a1) {
    const n = Math.max(3, Math.ceil((Math.abs(a1 - a0) * Math.max(rx, ry)) / this.step));
    for (let i = 0; i <= n; i++) {
      const a = lerp(a0, a1, i / n), pt = [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
      if (i === 0 && this.c) { this.L(pt[0], pt[1]); continue; }
      if (i === 0) { this.M(pt[0], pt[1]); continue; }
      this.p.push(pt);
    }
    this.c = this.p[this.p.length - 1].slice(); return this;
  }
  poly(closed = false) { return new Poly(this.p, closed); }
}

function roundRectPath(x, y, w, h, r, startOvershoot = 0.06) {
  // hand-drawn: start a little in from the top-left corner and overshoot the end
  const b = new PathB();
  b.M(x + r + w * 0.04, y + 2);
  b.L(x + w - r, y);
  b.A(x + w - r, y + r, r, r, -Math.PI / 2, 0);
  b.L(x + w, y + h - r);
  b.A(x + w - r, y + h - r, r, r, 0, Math.PI / 2);
  b.L(x + r, y + h);
  b.A(x + r, y + h - r, r, r, Math.PI / 2, Math.PI);
  b.L(x, y + r);
  b.A(x + r, y + r, r, r, Math.PI, Math.PI * 1.5);
  b.L(x + r + w * (0.04 + startOvershoot), y - 3);
  return b.poly(true);
}
function circlePath(cx, cy, r, a0 = -2.2, over = 0.35, squash = 1) {
  return new PathB().A(cx, cy, r, r * squash, a0, a0 + TAU + over).poly(true);
}
function resamplePts(pts, n) { return new Poly(pts).resample(n); }
function morph(A, B, u, n = 260, wob = 0, seed = 1) {
  const a = resamplePts(A, n), b = resamplePts(B, n), out = [];
  const bump = Math.sin(Math.PI * clamp(u));
  for (let i = 0; i < n; i++) {
    const w = wob * bump;
    out.push([lerp(a[i][0], b[i][0], u) + snoise(i / 18, seed) * w, lerp(a[i][1], b[i][1], u) + snoise(i / 18, seed + 7) * w]);
  }
  return out;
}
function xform(pts, tx, ty, s = 1, rot = 0, sx = 1, sy = 1, ox = 0, oy = 0) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return pts.map(([x, y]) => {
    let px = (x - ox) * s * sx, py = (y - oy) * s * sy;
    return [tx + px * c - py * sn, ty + px * sn + py * c];
  });
}

/* ----------------------------------------------------------- render state */
const cv = document.getElementById('c');
const out = cv.getContext('2d');
function mk(w = W, h = H) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const subC = mk(), sub = subC.getContext('2d');
const inkC = mk(), ink = inkC.getContext('2d');
const washC = mk(), wash = washC.getContext('2d');
const accC = mk(), acc = accC.getContext('2d');

let BOIL = 0;            // changes every 2 frames: line boil index
let FRAME = 0;
let CAM = { x: 0, y: 0, z: 1, r: 0 };
let WSCALE = 1;

/* ---------------------------------------------------------------- paper */
function makePaperTile() {
  const S = 512, c = mk(S, S), g = c.getContext('2d');
  g.fillStyle = COL.paper; g.fillRect(0, 0, S, S);
  const wrapDraw = (fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); fn(); g.restore(); } };
  // soft mottling
  for (let i = 0; i < 70; i++) {
    const x = rnd(i, 1) * S, y = rnd(i, 2) * S, r = 40 + rnd(i, 3) * 140, dark = rnd(i, 4) < 0.5;
    wrapDraw(() => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, dark ? 'rgba(120,96,60,0.018)' : 'rgba(255,252,240,0.04)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // fibers
  for (let i = 0; i < 520; i++) {
    const x = rnd(i, 11) * S, y = rnd(i, 12) * S, a = rnd(i, 13) * TAU, l = 6 + rnd(i, 14) * 26;
    const al = 0.025 + rnd(i, 15) * 0.05, light = rnd(i, 16) < 0.35;
    wrapDraw(() => {
      g.strokeStyle = light ? `rgba(255,255,248,${al * 2})` : `rgba(110,90,60,${al})`;
      g.lineWidth = 0.6 + rnd(i, 17) * 0.8;
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    });
  }
  // fine tooth
  const im = g.getImageData(0, 0, S, S), d = im.data;
  for (let i = 0; i < S * S; i++) {
    const n = (rnd(i, 21) - 0.5) * 14 + (rnd(i >> 2, 22) - 0.5) * 6;
    d[i * 4] += n; d[i * 4 + 1] += n; d[i * 4 + 2] += n * 0.9;
  }
  g.putImageData(im, 0, 0);
  return c;
}
function makeGrainTile(seed, S = 256, density = 0.5) {
  const c = mk(S, S), g = c.getContext('2d'), im = g.createImageData(S, S), d = im.data;
  for (let i = 0; i < S * S; i++) {
    const v = rnd(i, seed);
    const a = v < density ? Math.pow(rnd(i, seed + 1), 1.6) * 255 : 0;
    d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; d[i * 4 + 3] = a;
  }
  g.putImageData(im, 0, 0); return c;
}
function makeFilmGrain(seed) {
  const S = 256, c = mk(S, S), g = c.getContext('2d'), im = g.createImageData(S, S), d = im.data;
  for (let i = 0; i < S * S; i++) { const v = 128 + (rnd(i, seed) + rnd(i, seed + 3) - 1) * 110; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0); return c;
}
const PAPER = makePaperTile();
const TOOTH = makeGrainTile(31, 256, 0.55);      // pencil tooth knocked out of ink
const WASHGRAIN = makeGrainTile(57, 256, 0.35);  // watercolor granulation
const FILM = [makeFilmGrain(71), makeFilmGrain(73), makeFilmGrain(79), makeFilmGrain(83)];
let paperPat = null, toothPat = null, washPat = null;

/* --------------------------------------------------------------- camera */
const CAM_KEYS = [
  { t: 0.0, x: 625, y: 690, z: 1.1, r: -0.016 },
  { t: 1.8, x: 600, y: 705, z: 1.04, r: 0.0, e: 'outCubic' },
  { t: 3.15, x: 660, y: 760, z: 1.1, r: 0.01, e: 'inOutSine' },
  { t: 3.38, x: 662, y: 752, z: 1.12, r: 0.012, e: 'outCubic' },
  { t: 4.45, x: 1235, y: 1520, z: 1.15, r: -0.012, e: 'camA' },
  { t: 6.2, x: 1215, y: 1880, z: 1.24, r: 0.0, e: 'inOutSine' },
  { t: 7.1, x: 1200, y: 1960, z: 1.27, r: 0.004, e: 'inOutSine' },
  { t: 7.66, x: 890, y: 3150, z: 1.25, r: 0.012, e: 'camB' },
  { t: 9.9, x: 892, y: 3140, z: 1.27, r: 0.0, e: 'inOutSine' },
  { t: 10.12, x: 888, y: 3165, z: 1.29, r: -0.004, e: 'outCubic' },
  { t: 11.03, x: 885, y: 3125, z: 1.23, r: 0.0, e: 'inOutSine' },
  { t: 11.56, x: 2150, y: 2120, z: 1.12, r: -0.012, e: 'camC' },
  { t: 14.36, x: 2160, y: 2200, z: 1.15, r: 0.0, e: 'inOutSine' },
  { t: 14.95, x: 1930, y: 1060, z: 1.0, r: 0.01, e: 'camA' },
  { t: 16.38, x: 1945, y: 1050, z: 1.045, r: 0.0, e: 'inOutSine' },
  { t: 16.88, x: 2550, y: 3220, z: 1.2, r: -0.008, e: 'camC' },
  { t: 18.3, x: 2550, y: 3240, z: 1.24, r: 0.0, e: 'inOutSine' },
  { t: 19.15, x: 2480, y: 3640, z: 0.92, r: 0.008, e: 'camA' },
  { t: 20.0, x: 2470, y: 3610, z: 0.95, r: 0.0, e: 'inOutSine' },
  { t: 21.75, x: 1635, y: 2060, z: 0.338, r: -0.006, e: 'camD' },
  { t: 23.0, x: 1635, y: 2050, z: 0.343, r: 0.0, e: 'inOutSine' },
];
const IMPACTS = [ // camera zoom kicks on accents
  { t: 3.02, a: 0.035 }, { t: 6.2, a: 0.02 }, { t: 10.18, a: 0.025 }, { t: 11.95, a: 0.018 }, { t: 12.17, a: 0.018 },
  { t: 15.22, a: 0.02 }, { t: 17.0, a: 0.015 }, { t: 20.6, a: 0.03 },
];
function camera(t) {
  let i = 0; while (i < CAM_KEYS.length - 2 && t > CAM_KEYS[i + 1].t) i++;
  const a = CAM_KEYS[i], b = CAM_KEYS[i + 1], u = E[b.e || 'inOutSine'](k(t, a.t, b.t));
  let x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u), z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), u)), r = lerp(a.r, b.r, u);
  // breathing drift (fades at the very end into a near-still hold)
  const drift = 1 - 0.7 * k(t, 21.6, 22.6);
  x += (7 * Math.sin(t * 0.61) + 4 * Math.sin(t * 1.37 + 2)) * drift / z;
  y += (6 * Math.sin(t * 0.47 + 1) + 3 * Math.sin(t * 1.71)) * drift / z;
  r += 0.0035 * Math.sin(t * 0.39 + 0.5) * drift;
  for (const im of IMPACTS) z *= 1 + im.a * kick(t - im.t, 2.6, 7);
  return { x, y, z, r };
}
function setCam(g, par = 1) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(W / 2, H / 2); g.rotate(CAM.r); g.scale(CAM.z, CAM.z); g.translate(-CAM.x * par, -CAM.y * par);
}
function toScreen(x, y) {
  const dx = x - CAM.x, dy = y - CAM.y, c = Math.cos(CAM.r), s = Math.sin(CAM.r);
  return [W / 2 + (dx * c - dy * s) * CAM.z, H / 2 + (dx * s + dy * c) * CAM.z];
}

/* -------------------------------------------------------------- strokes */
// Ink stroke along a polyline: boiling, pressure-varying width, tapered ends.
function strokePts(g, pts, o = {}) {
  if (!pts || pts.length < 2) return;
  const w = (o.w ?? 6) * WSCALE, amp = o.boil ?? 1.7, seed = o.seed ?? 1, s0 = o.s0 ?? 0;
  const taper = o.taper ?? 26, headTaper = o.headTaper ?? taper;
  const n = pts.length, P = new Array(n), S = new Float64Array(n);
  let L = 0;
  for (let i = 0; i < n; i++) { if (i) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); S[i] = L; }
  if (L < 0.5) return;
  const bseed = seed * 7 + BOIL * 131;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const sa = s0 + S[i];
    const d = snoise(sa / 38, bseed) * amp + snoise(sa / 140, seed * 3 + BOIL * 17) * amp * 0.8;
    const press = 0.78 + 0.44 * vnoise(sa / 85, seed * 5 + BOIL * 3);
    const te = Math.min(1, (S[i] + 2) / taper), he = Math.min(1, (L - S[i] + 2) / headTaper);
    const ww = w * press * Math.sqrt(te) * Math.sqrt(he) * 0.5 * (o.wFn ? o.wFn(S[i] / L) : 1);
    P[i] = [pts[i][0] - ty * d, pts[i][1] + tx * d, -ty, tx, ww];
  }
  g.beginPath();
  g.moveTo(P[0][0] + P[0][2] * P[0][4], P[0][1] + P[0][3] * P[0][4]);
  for (let i = 1; i < n; i++) g.lineTo(P[i][0] + P[i][2] * P[i][4], P[i][1] + P[i][3] * P[i][4]);
  for (let i = n - 1; i >= 0; i--) g.lineTo(P[i][0] - P[i][2] * P[i][4], P[i][1] - P[i][3] * P[i][4]);
  g.closePath();
  g.globalAlpha = o.alpha ?? 1;
  g.fillStyle = o.color || COL.ink; g.fill();
  if (o.sketch) { // a lighter re-trace, like a second pass of the pencil
    g.globalAlpha = (o.alpha ?? 1) * 0.35;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const sa = s0 + S[i], off = 2.2 + snoise(sa / 60, seed + 99 + BOIL) * 2.4;
      const x = P[i][0] + P[i][2] * off, y = P[i][1] + P[i][3] * off;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.lineWidth = Math.max(1, w * 0.22); g.strokeStyle = o.color || COL.ink; g.lineCap = 'round'; g.stroke();
  }
  g.globalAlpha = 1;
}
function stroke(g, poly, o = {}) {
  const from = o.from ?? 0, to = o.to ?? 1;
  if (to <= from) return;
  const { pts, s0 } = poly.sub(from, to);
  strokePts(g, pts, Object.assign({}, o, { s0 }));
}
// filled blob (dots, triangles) with boiling edge
function fillPts(g, pts, color, amp = 1.2, seed = 3, alpha = 1) {
  if (pts.length < 3) return;
  g.beginPath();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const d = snoise(i / 6, seed * 11 + BOIL * 29) * amp;
    const x = pts[i][0] + d, y = pts[i][1] + snoise(i / 6, seed * 13 + BOIL * 31) * amp;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath(); g.globalAlpha = alpha; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
}
function ellipsePts(cx, cy, rx, ry, rot = 0, n = 40) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const x = Math.cos(a) * rx, y = Math.sin(a) * ry; pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); }
  return pts;
}

/* ----------------------------------------------------------- watercolor */
// A wash that blooms from (ox,oy), clipped to `shape` (array of pts) or a noisy blob.
function washBlob(g, cx, cy, r, color, grow, seed = 1, o = {}) {
  if (grow <= 0) return;
  const sx = o.sx ?? 1, sy = o.sy ?? 1, rot = o.rot ?? 0, tm = o.time ?? 0;
  g.save();
  g.fillStyle = color;
  for (let layer = 0; layer < 3; layer++) {
    g.beginPath();
    const N = 72;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const nr = 1 + 0.16 * snoise(Math.cos(a) * 1.6 + Math.sin(a) * 2.1 + layer * 3.3 + tm * 0.25, seed + layer)
                  + 0.06 * snoise(a * 9 + layer, seed + 40 + layer);
      const rr = r * grow * nr * (1 - layer * 0.06);
      const x = Math.cos(a) * rr * sx, y = Math.sin(a) * rr * sy;
      const X = cx + x * Math.cos(rot) - y * Math.sin(rot), Y = cy + x * Math.sin(rot) + y * Math.cos(rot);
      i ? g.lineTo(X, Y) : g.moveTo(X, Y);
    }
    g.closePath();
    g.globalAlpha = (o.alpha ?? 1) * 0.3;
    g.fill();
    g.globalAlpha = (o.alpha ?? 1) * 0.22; g.lineWidth = 3 * WSCALE; g.strokeStyle = color; g.stroke(); // pigment rim
  }
  g.restore();
}
function washShape(g, pts, color, grow, ox, oy, seed = 1, o = {}) {
  if (grow <= 0 || pts.length < 3) return;
  g.save();
  // bloom mask: noisy circle growing from origin
  if (grow < 1) {
    const R = (o.maxR ?? 900) * E.outCubic(grow);
    g.beginPath();
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU, rr = R * (1 + 0.18 * snoise(a * 3, seed + 5));
      i ? g.lineTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr) : g.moveTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr);
    }
    g.clip();
  }
  for (let layer = 0; layer < 2; layer++) {
    g.beginPath();
    pts.forEach((p, i) => {
      const d = snoise(i / 5 + layer * 9, seed + layer) * (o.bleed ?? 6);
      i ? g.lineTo(p[0] + d, p[1] - d * 0.6) : g.moveTo(p[0] + d, p[1] - d * 0.6);
    });
    g.closePath();
    g.fillStyle = color; g.globalAlpha = (o.alpha ?? 1) * 0.42; g.fill();
    g.globalAlpha = (o.alpha ?? 1) * 0.25; g.lineWidth = 3 * WSCALE; g.strokeStyle = color; g.stroke();
  }
  g.restore();
}

/* ------------------------------------------------------------------ text */
// Markup: [..] = emphasis A, {..} = emphasis B, per-line styles.
const TEXT_BLOCKS = [];
function textBlock(spec) { TEXT_BLOCKS.push(spec); return spec; }
function layoutBlock(g, b) {
  if (b.items) return;
  b.items = [];
  let ci = 0;
  for (const line of b.lines) {
    const chars = [];
    let mode = 0;
    for (const ch of line.str) {
      if (ch === '[') { mode = 1; continue; } if (ch === ']') { mode = 0; continue; }
      if (ch === '{') { mode = 2; continue; } if (ch === '}') { mode = 0; continue; }
      chars.push({ ch, mode });
    }
    const n = chars.length;
    let x = line.x, y = line.y;
    line.extent = [line.x, line.y, line.x, line.y];
    chars.forEach((c, i) => {
      const st = Object.assign({ size: line.size, font: line.font || 'WenKai', color: line.color || COL.ink },
        c.mode === 1 ? line.em : c.mode === 2 ? line.em2 : null);
      g.font = `${st.size}px ${st.font}`;
      const adv = g.measureText(c.ch).width;
      const tc = line.times ? line.times[i] : lerp(line.t0, line.t1, n > 1 ? i / (n - 1) : 0);
      const item = { ch: c.ch, x, y, size: st.size, font: st.font, color: st.color, adv, t: tc, idx: ci++, line, sy: st.sy || 1, mode: c.mode };
      if (line.vertical) { item.x = x - adv / 2; y += st.size * (st.sy || 1) * (line.lead || 1.05); item.y = y - st.size * 0.12; }
      else { x += adv + (line.track || 0); }
      b.items.push(item);
      line.extent[2] = Math.max(line.extent[2], line.vertical ? x + st.size / 2 : x);
      line.extent[3] = Math.max(line.extent[3], y);
    });
  }
}
function drawTextBlock(g, b, t) {
  layoutBlock(g, b);
  const items = b.items;
  for (const it of items) {
    if (t < it.t) continue;
    const p = k(t, it.t, it.t + 0.2);
    let alpha = 1, dy = (1 - E.outCubic(p)) * it.size * 0.12, dx = 0, sc = lerp(0.55, 1, E.outBack(p, 2.2)), rot = 0;
    const te = b.tOut != null ? b.tOut + (b.eraseStagger ?? 0.016) * it.idx : Infinity;
    if (t > te) {
      const q = E.inCubic(k(t, te, te + 0.24));
      alpha = 1 - q; dy -= q * it.size * 0.25; sc *= 1 - 0.25 * q; rot = (rnd(it.idx, 9) - 0.5) * 0.6 * q;
      if (b.push) { dx += Math.sign(it.x - b.push[0]) * q * 70; dy += (it.y - b.push[1] < 0 ? -1 : 1) * q * 30; }
      if (q >= 1) continue;
    }
    const ex = b.charFx ? b.charFx(it, t) : null;
    if (ex) { dx += ex.dx || 0; dy += ex.dy || 0; sc *= ex.s || 1; rot += ex.rot || 0; if (ex.alpha != null) alpha *= ex.alpha; }
    // boil on twos
    const bj = b.boil ?? 1;
    rot += (rnd(it.idx, BOIL * 3 + 1) - 0.5) * 0.045 * bj;
    dx += (rnd(it.idx, BOIL * 3 + 2) - 0.5) * 1.6 * bj;
    dy += (rnd(it.idx, BOIL * 3 + 3) - 0.5) * 1.6 * bj;
    const cx = it.x + it.adv / 2, cy = it.y - it.size * 0.35;
    g.save();
    g.translate(cx + dx, cy + dy); g.rotate(rot); g.scale(sc, sc * (ex && ex.sy ? ex.sy : it.sy));
    // writing wipe: reveal left->right like a pen pass
    const wp = E.outCubic(k(t, it.t, it.t + 0.15));
    if (wp < 1) { g.beginPath(); g.rect(-it.adv / 2 - 4, -it.size, (it.adv + 8) * wp, it.size * 2); g.clip(); }
    g.font = `${it.size}px ${it.font}`;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.globalAlpha = alpha; g.fillStyle = it.color;
    g.fillText(it.ch, 0, it.size * 0.35);
    g.restore();
  }
  // erased lines leave a soft graphite scribble behind (the page keeps a memory of the words)
  if (b.tOut != null && b.scribble !== false) {
    b.lines.forEach((line, li) => {
      const t0 = b.tOut + 0.08 + li * 0.06;
      if (t < t0) return;
      const ext = line.extent;
      if (!line.scrib) {
        const pb = new PathB(); const x0 = ext[0] + 6, x1 = ext[2] - 6;
        if (line.vertical) {
          const yA = line.y + 10, yB = ext[3] - 10, xm = line.x;
          pb.M(xm, yA);
          for (let yy = yA; yy < yB; yy += 22) pb.L(xm + (Math.sin(yy * 0.19 + li) * 0.6 + snoise(yy / 30, li + 3) * 0.6) * line.size * 0.22, yy + 11);
        } else {
          const ym = line.y - line.size * 0.32;
          pb.M(x0, ym);
          for (let xx = x0; xx < x1; xx += 18) pb.L(xx + 9, ym + (Math.sin(xx * 0.23 + li) * 0.6 + snoise(xx / 30, li + 3) * 0.5) * line.size * 0.16);
        }
        line.scrib = pb.poly();
      }
      stroke(g, line.scrib, { w: 3.2, to: E.pen(k(t, t0, t0 + 0.5)), color: COL.graphite, alpha: 0.55, seed: 300 + li, boil: 1.2, taper: 30 });
    });
  }
}

/* ============================================================== SCENES */
// ---------- Scene A: 90%, the crowd, the question
const HEADS = []; for (let i = 0; i < 10; i++) HEADS.push({ x: 178 + i * 94 + (rnd(i, 4) - 0.5) * 10, y: 884 + (rnd(i, 5) - 0.5) * 16, r: 33 + rnd(i, 6) * 5, t: 1.1 + i * 0.048 + rnd(i, 7) * 0.02 });
const YOU = 7;
const SWOOSH = new PathB().M(-120, 640).C(80, 560, 260, 540, 400, 528).C(520, 518, 660, 520, 770, 512).poly();
const Q_HOOK = new PathB().M(800, 440).C(790, 250, 1040, 215, 1035, 390).C(1032, 510, 900, 530, 896, 630).L(894, 712).poly();
const Q_DOT = [895, 790];
const PATH = new PathB().M(800, 440)
  .C(820, 240, 1090, 250, 1160, 480)
  .C(1230, 690, 1240, 1000, 1240, 1300)
  .C(1240, 1560, 1570, 1650, 1595, 1920)
  .C(1620, 2170, 1510, 2400, 1310, 2560)
  .C(1110, 2720, 720, 2760, 640, 2960).poly();
const PATH_START = 0.16; // fraction of PATH that the uncurled ? becomes
const BOXES = [ // checkbox stations along the path
  { u: 0.43, t: 4.75 }, { u: 0.52, t: 5.1 }, { u: 0.61, t: 5.45 }, { u: 0.7, t: 5.8 },
];
const textA1 = textBlock({
  lines: [
    { x: 190, y: 640, size: 60, str: '百分之九十人都听过', t0: 0.42, t1: 1.45 },
    { x: 186, y: 768, size: 60, str: '[知识库]，', t0: 1.5, t1: 1.82, em: { size: 96, color: COL.red, font: 'KuaiLe' } },
  ],
  tOut: 3.42,
});
const textA2 = textBlock({
  lines: [{ x: 190, y: 1100, size: 60, str: '但[你]却根本不知道到底是{什么}。', t0: 1.88, t1: 3.28, em: { size: 66, color: COL.blue }, em2: { size: 92, color: COL.red, font: 'KuaiLe' } }],
  tOut: 3.5,
});
function qSmall(x, y, s, seed) {
  return [new PathB().M(x - 0.32 * s, y - 0.55 * s).C(x - 0.3 * s, y - 1.05 * s, x + 0.42 * s, y - 1.05 * s, x + 0.36 * s, y - 0.62 * s).C(x + 0.3 * s, y - 0.3 * s, x, y - 0.32 * s, x, y - 0.05 * s).poly(), [x, y + 0.22 * s]];
}
function drawHead(g, h, i, t) {
  const t2 = Math.floor(t * 15) / 15; // characters animate on twos
  const pop = spring(t2 - h.t, 2.6, 0.3);
  if (pop <= 0.001) return;
  const sq = 1 + kick(t2 - h.t, 2.2, 5) * 0.25;
  const x = h.x, y = h.y + (1 - pop) * 40, r = h.r * pop;
  const isYou = i === YOU;
  if (!h.circ) { h.circ = circlePath(0, 0, 100, -2.3 + rnd(i, 1), 0.3); h.sh = new PathB().M(-125, 215).C(-110, 120, 110, 120, 125, 215).poly(); }
  const circ = xform(h.circ.pts, x, y, r / 100, 0, 1 / sq, sq);
  strokePts(g, circ, { w: 5, seed: 40 + i, boil: 1.3, taper: 12 });
  strokePts(g, xform(h.sh.pts, x, y, r / 100, 0, 1 / sq, sq), { w: 4.6, seed: 60 + i, boil: 1.3 });
  // eyes: look forward, then up at 知识库, then (the "you" one) at the camera
  let lx = 0, ly = 0;
  const look = E.outBack(k(t2, 1.55 + i * 0.02, 1.8 + i * 0.02));
  const tx = 310 - x, ty = 720 - y, tl = Math.hypot(tx, ty);
  lx = (tx / tl) * 0.28 * look; ly = (ty / tl) * 0.28 * look;
  if (isYou) { const back = E.outBack(k(t2, 1.95, 2.15)); lx = lerp(lx, 0, back); ly = lerp(ly, 0.05, back); }
  const blink = (Math.floor(t * 15) + i * 7) % 47 === 0 ? 0.25 : 1;
  for (const s of [-1, 1]) fillPts(g, ellipsePts(x + (s * 0.36 + lx) * r, y + (-0.05 + ly) * r, r * 0.1, r * 0.13 * blink, 0, 14), COL.ink, 0.6, 70 + i);
  return { x, y, r };
}

function sceneA(t) {
  if (t > 22.95) return;
  // red bloom behind 90% — already moving on frame one
  washBlob(wash, 400, 360, 250, COL.red, lerp(0.4, 1, E.outQuart(k(t, 0, 1.2))), 5, { sx: 1.25, sy: 0.82, rot: -0.15, time: t, alpha: lerp(0.95, 0.8, k(t, 2, 6)) });
  // the swoosh that becomes the underline
  stroke(ink, SWOOSH, { w: 9, from: lerp(0, 0.45, E.inOutSine(k(t, 0.3, 1.0))), to: lerp(0.18, 1, E.pen(k(t, 0, 0.55))), seed: 11, boil: 2, sketch: true });
  // 90%
  textBlock;
  if (!sceneA.big) sceneA.big = textBlock({ lines: [{ x: 170, y: 480, size: 330, font: 'KuaiLe', str: '90%', times: [0.7, 0.84, 0.98], color: COL.ink }], boil: 2.2, charFx: (it, tt) => ({ sy: 1 + kick(tt - it.t, 2.4, 6) * 0.22 }) });
  drawTextBlock(ink, sceneA.big, t);
  // heads + sound arcs + little question marks
  HEADS.forEach((h, i) => {
    drawHead(ink, h, i, t);
    const ta = 1.32 + i * 0.03;
    if (t > ta) {
      for (let j = 0; j < 2; j++) {
        if (!h['arc' + j]) h['arc' + j] = new PathB().A(h.x + h.r * 0.7, h.y - h.r * 0.1, 12 + j * 11, 16 + j * 13, -0.9, 0.9).poly();
        const out = E.inCubic(k(t, 2.2 + i * 0.02, 2.45 + i * 0.02));
        stroke(ink, h['arc' + j], { w: 3.4, from: out, to: E.pen(k(t, ta + j * 0.06, ta + j * 0.06 + 0.2)), seed: 80 + i * 3 + j, boil: 1.2, color: COL.graphite });
      }
    }
    if (i !== YOU) {
      const tq = 2.32 + Math.abs(i - YOU) * 0.04;
      const gone = 3.0 + Math.abs(i - YOU) * 0.02;
      if (t > tq && t < gone + 0.3) {
        const s = 34 * spring(t - tq, 3, 0.35) * (1 - E.inBack(k(t, gone, gone + 0.25)));
        const [qp, dot] = qSmall(h.x + 4, h.y - h.r - 26, Math.max(0.01, s), 90 + i);
        strokePts(ink, qp.pts, { w: 4, seed: 90 + i, color: COL.blue, boil: 1 });
        fillPts(ink, ellipsePts(dot[0], dot[1], 3.6 * s / 34, 3.6 * s / 34, 0, 10), COL.blue, 0.5, 91 + i);
      }
    }
  });
  // the "you" head gets a blue wash
  const yh = HEADS[YOU];
  washBlob(wash, yh.x, yh.y, 48, COL.washBlue, E.outCubic(k(t, 1.95, 2.5)), 22, { time: t, alpha: 0.85 });
  drawTextBlock(ink, textA1, t);
  drawTextBlock(ink, textA2, t);
}

// the big question mark -> path, and its dot -> the traveller
function pathTo(t) {
  if (t < 3.82) return PATH_START;
  if (t < 4.35) return lerp(PATH_START, 0.42, E.outCubic(k(t, 3.82, 4.35)));
  if (t < 6.2) return lerp(0.42, 0.76, E.outSine(k(t, 4.35, 6.0)));
  return lerp(0.76, 1, E.outCubic(k(t, 6.2, 6.95)));
}
function dotU(t) { // position along PATH
  if (t < 3.75) return null;
  if (t < 6.2) {
    let u = lerp(0.17, 0.37, E.inOutCubic(k(t, 3.75, 4.45)));
    u += 0.012 * E.outBack(k(t, 4.75, 4.95)) + 0.012 * E.outBack(k(t, 5.45, 5.65));
    return u;
  }
  const r = k(t, 6.22, 7.02);
  return lerp(0.394, 1, bezierEase(0.55, 0, 0.35, 1)(r));
}
function dotPos(t) {
  if (t < 3.33) return { x: Q_DOT[0], y: Q_DOT[1], ang: 0 };
  if (t < 3.75) { // hop from under the hook onto the path
    const u = k(t, 3.36, 3.75), e = E.inOutSine(u), target = PATH.at(0.17);
    const x = lerp(Q_DOT[0], target[0], e), y = lerp(Q_DOT[1], target[1], e) - Math.sin(Math.PI * u) * 260;
    return { x, y, ang: 0 };
  }
  if (t < 7.02) { const u = dotU(t), p = PATH.at(u); return { x: p[0], y: p[1], ang: PATH.tangent(u) }; }
  // into the video frame
  const u = k(t, 7.05, 7.5), e = E.inOutSine(u), a = PATH.at(1);
  return { x: lerp(a[0], RECT_C.cx, e), y: lerp(a[1], RECT_C.cy, e) - Math.sin(Math.PI * u) * 170, ang: 0 };
}
function sceneThreadA(t) {
  // question mark draw-on and uncurl
  if (t > 2.86) {
    const draw = E.outExpo(k(t, 2.88, 3.12));
    const sq = 1 + kick(t - 3.0, 2.4, 6) * 0.28; // squash & stretch around the base
    if (t < 3.34) {
      const pts = xform(Q_HOOK.pts, Q_DOT[0], 800, 1, 0, 1 / sq, sq, Q_DOT[0], 800);
      const pl = new Poly(pts);
      stroke(ink, pl, { w: 24, to: draw, seed: 7, boil: 2.2, taper: 40, headTaper: 18, sketch: true });
    } else if (t < 3.82) {
      const u = E.inOutCubic(k(t, 3.34, 3.82));
      const target = PATH.sub(0, PATH_START).pts;
      const m = morph(Q_HOOK.pts, target, u, 260, 14, 3);
      strokePts(ink, m, { w: lerp(24, 12, u), seed: 7, boil: 2.2, taper: 40, sketch: true });
    }
  }
  if (t >= 3.82) {
    stroke(ink, PATH, { w: 12, to: pathTo(t), seed: 7, boil: 2.2, taper: 40, headTaper: 30, sketch: true });
  }
  // checkboxes along the path
  BOXES.forEach((b, i) => {
    if (t < b.t) return;
    const p = PATH.at(b.u), ang = PATH.tangent(b.u);
    const side = i % 2 ? -1 : 1, nx = -Math.sin(ang) * side, ny = Math.cos(ang) * side;
    const bx = p[0] + nx * 70, by = p[1] + ny * 70;
    if (!b.box) {
      b.box = roundRectPath(-30, -30, 60, 60, 8, 0.1);
      b.line = new PathB(); const dir = Math.sign(nx) || 1; b.line.M(dir * 46, -6);
      for (let j = 0; j < 7; j++) b.line.L(dir * (60 + j * 26), -6 + (j % 2 ? -7 : 6));
      b.line = b.line.poly();
      b.line2 = new PathB().M(dir * 46, 18).L(dir * 120, 14).L(dir * 170, 20).poly();
    }
    const tt = Math.floor(t * 15) / 15, pop = spring(tt - b.t, 3, 0.35);
    const rot = -0.08 + i * 0.05;
    strokePts(ink, xform(b.box.pts, bx, by, pop, rot), { w: 5, seed: 120 + i, boil: 1.4, taper: 10 });
    stroke(ink, new Poly(xform(b.line.pts, bx, by, 1, rot)), { w: 3.2, to: E.pen(k(t, b.t + 0.08, b.t + 0.4)), seed: 130 + i, color: COL.graphite, boil: 1.2 });
    stroke(ink, new Poly(xform(b.line2.pts, bx, by, 1, rot)), { w: 3.2, to: E.pen(k(t, b.t + 0.2, b.t + 0.45)), seed: 135 + i, color: COL.graphite, boil: 1.2 });
    // tick when the dot rushes past
    if (!b.tick) b.tick = new PathB().M(-16, 0).L(-4, 14).C(4, -6, 14, -22, 34, -38).poly();
    let tTick = null; for (let s = 6.2; s < 7.1; s += 1 / 60) { if (dotU(s) >= b.u) { tTick = s; break; } }
    if (tTick && t > tTick) {
      stroke(ink, new Poly(xform(b.tick.pts, bx, by, 1.15, rot)), { w: 8, to: E.outExpo(k(t, tTick, tTick + 0.14)), seed: 140 + i, color: COL.red, boil: 1.4, taper: 8 });
      washBlob(wash, bx, by, 34, COL.ochre, E.outCubic(k(t, tTick, tTick + 0.3)), 150 + i, { time: t, alpha: 0.7 });
    }
  });
}
const HILITE = new PathB().M(790, 2088).C(1000, 2080, 1300, 2096, 1560, 2084).poly();
const textB = textBlock({
  lines: [
    { x: 800, y: 1880, size: 62, str: '今天我就带大家把', t0: 3.72, t1: 4.7 },
    { x: 800, y: 1975, size: 62, str: '搭建[知识库]所需的条件', t0: 4.74, t1: 5.98, em: { size: 70, color: COL.red } },
    { x: 800, y: 2118, size: 104, font: 'KuaiLe', str: '全流程走一遍。', t0: 6.22, t1: 7.02 },
  ],
  tOut: 7.35,
});

// ---------- Scene C: the video frame, the play button, the paper plane
const RECT_C = { x: 620, y: 2960, w: 560, h: 340 }; RECT_C.cx = RECT_C.x + RECT_C.w / 2; RECT_C.cy = RECT_C.y + RECT_C.h / 2;
const RECT_C_POLY = roundRectPath(RECT_C.x + 10, RECT_C.y, RECT_C.w, RECT_C.h, 30, 0.08);
const textC = textBlock({
  lines: [
    { x: 480, y: 3420, size: 60, str: '我本来想这一期[直接开始讲]的，', t0: 7.54, t1: 9.15, em: { size: 64, color: COL.red } },
    { x: 480, y: 3520, size: 60, str: '但上一条视频[发出]之后，视频', t0: 9.5, t1: 10.9, em: { size: 76, color: COL.blue, font: 'KuaiLe' } },
  ],
  tOut: 11.08,
});
function triPts(cx, cy, s, rot = 0) {
  const b = new PathB(); b.step = 3;
  const P = [[-0.42, -0.55], [0.62, 0], [-0.42, 0.55]];
  b.M(P[0][0], P[0][1]); b.L(P[1][0], P[1][1]); b.L(P[2][0], P[2][1]); b.L(P[0][0], P[0][1]);
  return xform(b.p, cx, cy, s, rot);
}
const PLANE_LOCAL = (() => { // side-view paper plane, nose at +x
  const b = new PathB(); b.step = 3;
  b.M(-0.62, -0.5).L(0.75, 0.0).L(-0.62, 0.42).L(-0.36, 0.06).L(-0.62, -0.5);
  return b.p;
})();
const PLANE_FOLD = new PathB().M(-0.36, 0.06).L(0.75, 0.0).poly();
// flight: C -> loop -> back into the bubble
const FLIGHT = new PathB().M(RECT_C.cx, RECT_C.cy)
  .C(1050, 2950, 1300, 2650, 1650, 2450)
  .C(2000, 2250, 2350, 1900, 2520, 1720)
  .C(2660, 1570, 2620, 1400, 2470, 1410)
  .C(2310, 1420, 2300, 1630, 2420, 1690)
  .C(2530, 1740, 2370, 1960, 2160, 2060).poly();
function planeU(t) { return bezierEase(0.55, 0.0, 0.35, 1.0)(k(t, 10.12, 11.55)); }

// ---------- Scene D: the speech bubble + confused commenter
const BUB = { x: 1730, y: 1800, w: 840, h: 520, r: 70 };
const BUB_POLY = (() => {
  const { x, y, w, h, r } = BUB, b = new PathB();
  b.M(x + r + 20, y + 2).L(x + w - r, y).A(x + w - r, y + r, r, r, -Math.PI / 2, 0)
   .L(x + w, y + h - r).A(x + w - r, y + h - r, r, r, 0, Math.PI / 2)
   .L(x + 260, y + h).L(x + 130, y + h + 150).L(x + 160, y + h)
   .L(x + r, y + h).A(x + r, y + h - r, r, r, Math.PI / 2, Math.PI)
   .L(x, y + r).A(x + r, y + r, r, r, Math.PI, Math.PI * 1.5).L(x + r + 60, y - 3);
  return b.poly(true);
})();
const FACE = { x: 1835, y: 2590, r: 78 };
const textD = textBlock({
  lines: [
    { x: 1800, y: 1890, size: 50, str: '后台有人[反馈]说，', t0: 11.06, t1: 11.9, color: COL.graphite, em: { size: 54, color: COL.blue } },
    { x: 1800, y: 2030, size: 112, font: 'KuaiLe', str: '主播主播，', times: [11.95, 12.05, 12.17, 12.27, 12.36] },
    { x: 1800, y: 2140, size: 64, str: '我根本[看不懂]，', t0: 12.4, t1: 13.05, em: { size: 72, color: COL.blue } },
    { x: 1800, y: 2238, size: 64, str: '我既没有听说过', t0: 13.45, t1: 14.32 },
  ],
  tOut: 14.4, eraseStagger: 0.01,
  charFx: (it, t) => {
    if (it.line.font !== 'KuaiLe') return null;
    const beat = it.idx < 6 + 2 ? 11.95 : 12.17; // 主播 / 主播
    return { dy: -kick(t - beat, 3, 7) * 26, sy: 1 + kick(t - beat, 3, 7) * 0.14 };
  },
});

// ---------- Scene E: the thought cloud
const CLOUD = { cx: 1930, cy: 1010, rx: 470, ry: 380 };
const CLOUD_POLY = (() => {
  const b = new PathB(), N = 9;
  for (let i = 0; i <= N; i++) {
    const a0 = -Math.PI * 0.62 + (i / N) * TAU, a1 = a0 + TAU / N;
    const p0 = [CLOUD.cx + Math.cos(a0) * CLOUD.rx, CLOUD.cy + Math.sin(a0) * CLOUD.ry];
    const p1 = [CLOUD.cx + Math.cos(a1) * CLOUD.rx, CLOUD.cy + Math.sin(a1) * CLOUD.ry];
    const am = (a0 + a1) / 2, bulge = 1.28 + rnd(i, 3) * 0.1;
    const m = [CLOUD.cx + Math.cos(am) * CLOUD.rx * bulge, CLOUD.cy + Math.sin(am) * CLOUD.ry * bulge];
    if (i === 0) b.M(p0[0], p0[1]);
    if (i < N) b.Q(m[0] * 1.0, m[1], p1[0], p1[1]);
  }
  b.L(b.p[0][0] + 30, b.p[0][1] + 6);
  return b.poly(true);
})();
const THOUGHTS = [{ x: 1720, y: 2440, r: 18, t: 13.55 }, { x: 1650, y: 2290, r: 26, t: 13.75 }, { x: 1600, y: 1560, r: 36, t: 14.25 }];
const FS_FLY = new PathB().M(0, 0).C(160, -120, 380, 80, 450, 420).C(520, 760, 640, 1300, 820, 1600).C(870, 1690, 900, 1720, 920, 1745).poly();
function fsOffset(t) { // the winged word leaves the cloud and perches on the new frame
  const u = bezierEase(0.55, 0.0, 0.25, 1.0)(k(t, 16.3, 16.88));
  if (u <= 0) return [0, 0, 0];
  const p = FS_FLY.at(u);
  return [p[0], p[1], Math.sin(u * Math.PI) * 0.35];
}
const textE = textBlock({
  lines: [
    { x: 1600, y: 905, size: 118, font: 'KuaiLe', str: 'workbody，', t0: 14.36, t1: 14.82, color: COL.ink },
    { x: 1610, y: 1015, size: 62, str: '也不知道', t0: 14.85, t1: 15.18 },
    { x: 1600, y: 1205, size: 150, font: 'KuaiLe', str: '[飞书]', t0: 15.2, t1: 15.4, em: { size: 150, color: COL.red, font: 'KuaiLe' } },
    { x: 1950, y: 1215, size: 62, str: '是什么东西，', t0: 15.45, t1: 15.85 },
  ],
  tOut: 16.42, scribble: true,
  charFx: (it) => (it.mode === 1 ? { alpha: 0 } : null), // 飞书 is drawn by the winged-word actor
});
const FS_WORD = textBlock({ lines: [{ x: 1600, y: 1205, size: 150, font: 'KuaiLe', str: '飞书', times: [15.2, 15.36], color: COL.red }], boil: 1.4,
  charFx: (it, t) => { const o = fsOffset(t); return { dx: o[0], dy: o[1] + Math.sin(t * 9) * 4 * k(t, 15.5, 15.7), rot: o[2] * 0.4 }; } });
const WING = new PathB().M(0, 0).C(-30, -70, -120, -130, -200, -120).C(-170, -95, -175, -80, -150, -70).C(-170, -55, -165, -40, -130, -36).C(-140, -20, -120, -5, -80, -6).C(-50, -6, -20, 0, 0, 0).poly();

// ---------- Scene F/G: today's video, stretched long, becomes the ribbon
const RECT_F = { x: 2290, y: 2960, w: 580, h: 340 };
const RECT_F_POLY = roundRectPath(RECT_F.x, RECT_F.y, RECT_F.w, RECT_F.h, 30, 0.08);
const RIBBON = (() => { // long ribbon bookmark lying across the whole page
  const x = 2900, w = 250, y0 = -120, y1 = 3640, notch = 120, b = new PathB();
  b.M(x + 30, y0).L(x + w, y0 + 4).L(x + w + 6, y1).L(x + w / 2, y1 - notch).L(x - 4, y1 + 6).L(x, y0).L(x + 60, y0 - 2);
  return b.poly(true);
})();
function rectF(t) { // stretched video frame (G)
  const st = E.outBack(k(t, 18.34, 18.95), 1.4) * 1 + kick(t - 18.9, 2.2, 5) * 0.05;
  const h = RECT_F.h + st * 760;
  const sx = 1 - 0.08 * Math.sin(Math.PI * k(t, 18.34, 18.95)); // squash in x while stretching
  const pts = roundRectPath(RECT_F.x + RECT_F.w * (1 - sx) / 2, RECT_F.y, RECT_F.w * sx, h, 30, 0.08).pts;
  return pts;
}
const textF = textBlock({
  lines: [
    { x: 2190, y: 3430, size: 64, str: '所以我就[特意]', t0: 16.42, t1: 16.62, em: { size: 76, color: COL.red, font: 'KuaiLe' } },
    { x: 2190, y: 3520, size: 64, str: '做了今天这条视频', t0: 16.65, t1: 16.93 },
  ],
  tOut: 18.22,
});
const textG = textBlock({
  lines: [{ x: 2170, y: 2990, size: 74, vertical: true, lead: 1.08, str: '这期视频会有点[长]，', t0: 18.32, t1: 19.3, em: { size: 120, color: COL.red, font: 'KuaiLe', sy: 1.9 } }],
  tOut: 19.4, scribble: false,
});
// final line lives in screen space during the pull-back (so it stays legible while the page shrinks)
const textH = textBlock({
  lines: [
    { x: 84, y: 1214, size: 72, str: '我建议你提前[收藏]，', t0: 19.4, t1: 20.42, em: { size: 132, color: COL.red, font: 'KuaiLe' } },
    { x: 84, y: 1326, size: 72, str: '避免下一次就彻底找不到了', t0: 20.48, t1: 21.5 },
  ],
  boil: 1,
});

function sceneLater(t) {
  // ---- C: rect drawn as the line keeps going; dot -> play button
  if (t > 7.0) {
    stroke(ink, RECT_C_POLY, { w: 7, to: E.pen(k(t, 7.02, 7.75)), seed: 200, boil: 1.8, taper: 20, sketch: true });
  }
  // dot actor
  let dotVisible = t >= 3.33 && t < 7.95;
  if (t >= 3.05 && t < 3.33) {
    const p = spring(t - 3.05, 3, 0.3), sq = 1 + kick(t - 3.05, 2.4, 6) * 0.3;
    fillPts(ink, ellipsePts(Q_DOT[0], Q_DOT[1], 22 * p / sq, 22 * p * sq, 0, 24), COL.ink, 1, 5);
  }
  if (dotVisible) {
    const t2 = Math.floor(t * 15) / 15;
    const P = dotPos(t), P2 = dotPos(t - 1 / 30);
    const vx = (P.x - P2.x) * 30, vy = (P.y - P2.y) * 30, sp = Math.hypot(vx, vy);
    const st = Math.min(2.6, 1 + sp / 900), ang = Math.atan2(vy, vx);
    let sq = 1;
    for (const b of [3.75, 4.75, 5.45, 7.5]) sq += kick(t2 - b, 2.6, 6) * 0.35;
    // smear frame: a tapered ink comet along the path while rushing
    if (t > 6.2 && t < 7.03 && sp > 300) {
      const u = dotU(t), tail = Math.min(0.09, sp / 60000);
      stroke(ink, PATH, { from: Math.max(0, u - tail), to: u, w: 46, seed: 5, boil: 1, taper: 400, headTaper: 4, wFn: (x) => Math.pow(x, 0.7) });
    }
    // smear ghosts
    if (sp > 400 && !(t > 6.2 && t < 7.03)) for (let g = 3; g >= 1; g--) {
      const G = dotPos(t - g * 0.018);
      fillPts(ink, ellipsePts(G.x, G.y, 22 * Math.min(st, 1.8), 22 / Math.min(st, 1.8), ang, 20), COL.ink, 1, 9 + g, 0.18 * (4 - g) / 3);
    }
    const st2 = t > 6.2 && t < 7.03 ? 1 : st;
    fillPts(ink, ellipsePts(P.x, P.y, 24 * st2 * sq, 24 / (sq * st2), sp > 60 ? ang : 0, 26), COL.ink, 1, 5);
  }
  // dot -> play triangle -> paper plane
  if (t >= 7.95 && t < 11.75) {
    const t2 = Math.floor(t * 15) / 15;
    const cx = RECT_C.cx, cy = RECT_C.cy;
    if (t < 9.78) {
      const u = E.outBack(k(t2, 7.95, 8.25), 2);
      const breathe = 1 + 0.06 * Math.sin((t - 8.3) * 7) * k(t, 8.4, 8.6) * (1 - k(t, 9.15, 9.3)) + 0.12 * E.outBack(k(t2, 8.55, 8.8)) * (1 - E.inOutSine(k(t2, 9.35, 9.6)));
      const circle = ellipsePts(cx, cy, 22, 22, 0, 60);
      const tri = triPts(cx + 6, cy, 130 * breathe);
      const pts = morph(circle, tri, clamp(u), 120, 0);
      washShape(wash, pts, COL.red, E.outCubic(k(t, 8.05, 8.5)), cx, cy, 33, { maxR: 160, bleed: 4 });
      strokePts(ink, pts.concat([pts[0], pts[1]]), { w: 6, seed: 210, boil: 1.4, taper: 6 });
      // "about to speak" ticks
      for (let j = 0; j < 3; j++) {
        const tj = 8.6 + j * 0.06, a = -0.5 + j * 0.5;
        const vis = k(t, tj, tj + 0.12) * (1 - k(t, 9.4, 9.55));
        if (vis > 0) {
          const r0 = 110, r1 = 110 + 40 * E.outBack(vis);
          strokePts(ink, [[cx + 40 + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + 40 + Math.cos(a) * r1, cy + Math.sin(a) * r1]], { w: 5, seed: 220 + j, color: COL.red, boil: 1 });
        }
      }
    } else {
      // fold into a plane then fly
      const fold = E.inOutCubic(k(t2, 9.78, 10.05));
      const tri = triPts(cx + 6, cy, 130);
      const pu = planeU(t), fp = FLIGHT.at(pu);
      const fa = pu > 0.001 ? FLIGHT.tangent(Math.min(0.999, pu)) : -0.6;
      const antic = E.outCubic(k(t, 9.95, 10.12)) * (1 - k(t, 10.12, 10.2)); // pull back before launch
      const px = lerp(cx, fp[0], k(t, 10.12, 10.13) > 0 ? 1 : 0) - antic * 30 * Math.cos(fa), py = (pu > 0 ? fp[1] : cy) - antic * 30 * Math.sin(fa);
      const speed = pu > 0 && pu < 1 ? Math.hypot(...FLIGHT.at(planeU(t + 1 / 60)).map((v, i) => v - fp[i])) * 60 : 0;
      const stretch = 1 + Math.min(0.9, speed / 2500);
      let scale = 150 * (1 + 0.15 * Math.sin(pu * Math.PI));
      const rot = lerp(0, fa, fold);
      let plane = xform(PLANE_LOCAL, px, py, scale, rot, stretch, 1 / stretch);
      // unfold into the speech bubble at the end of the flight
      const ub = E.inOutCubic(k(t, 11.28, 11.72));
      let pts = morph(tri, plane, fold, 200, 6, 11);
      if (ub > 0) pts = morph(pts, BUB_POLY.pts, ub, 260, 60, 12);
      // flight trail (dashes) stays on the page
      // plane body fill (paper) and the red fading out of it
      if (fold < 1) washShape(wash, pts, COL.red, 1 - fold, cx, cy, 33, { bleed: 4 });
      fillPts(ink, pts, COL.paperLight, 0.8, 230, 0.92 * (1 - ub));
      strokePts(ink, pts, { w: lerp(6, 7, ub), seed: 231, boil: 1.6, taper: 8 });
      if (ub < 0.3 && fold > 0.5) {
        const fl = xform(PLANE_FOLD.pts, px, py, scale, rot, stretch, 1 / stretch);
        strokePts(ink, fl, { w: 4, seed: 232, boil: 1.2, alpha: 1 - ub * 3 });
      }
      // speed lines while launching
      if (speed > 800) for (let j = 0; j < 4; j++) {
        const off = (j - 1.5) * 26, back = 160 + j * 30;
        const ax = px - Math.cos(fa) * 90 - Math.sin(fa) * off, ay = py - Math.sin(fa) * 90 + Math.cos(fa) * off;
        strokePts(ink, [[ax, ay], [ax - Math.cos(fa) * back, ay - Math.sin(fa) * back]], { w: 4, seed: 240 + j, color: COL.graphite, alpha: 0.7, boil: 1 });
      }
    }
  }
  // flight trail
  if (t > 10.15) {
    const to = planeU(t) - 0.035;
    if (to > 0) {
      const { pts, s0 } = FLIGHT.sub(0.06, to);
      // dashed: cut into segments
      const pl = new Poly(pts);
      const n = Math.floor(pl.len / 46);
      for (let i = 0; i < n; i++) {
        const a = i / n, b = a + 0.55 / n;
        stroke(ink, pl, { from: a, to: b, w: 4.2, seed: 260 + i, color: COL.graphite, boil: 1.2, taper: 6 });
      }
    }
  }
  // ---- D: bubble (stays), its wash, the commenter
  if (t >= 11.72) {
    const t2 = Math.floor(t * 15) / 15;
    let sc = 1;
    for (const b of [11.95, 12.17]) sc += kick(t2 - b, 2.6, 7) * 0.035;
    const pts = xform(BUB_POLY.pts, BUB.x + 130, BUB.y + BUB.h + 150, sc, 0, 1, 1, BUB.x + 130, BUB.y + BUB.h + 150);
    fillPts(ink, pts, COL.paperLight, 0.6, 229, 1);
    strokePts(ink, pts, { w: 7, seed: 231, boil: 1.6, taper: 8, sketch: true });
  }
  washShape(wash, BUB_POLY.pts, COL.washBlue, k(t, 11.6, 12.4), BUB.x + 200, BUB.y + 200, 280, { maxR: 1100, alpha: 0.42, bleed: 12 });
  // commenter face
  if (t > 12.36) {
    const t2 = Math.floor(t * 15) / 15;
    const pop = spring(t2 - 12.38, 2.6, 0.32);
    const { x, y, r } = FACE;
    if (!sceneLater.face) sceneLater.face = circlePath(0, 0, 100, -2, 0.3);
    strokePts(ink, xform(sceneLater.face.pts, x, y, r * pop / 100, Math.sin(t * 2) * 0.05), { w: 6, seed: 300, boil: 1.6, taper: 12 });
    // spiral eyes, spinning on twos
    for (const s of [-1, 1]) {
      const ex = x + s * r * 0.38 * pop, ey = y - r * 0.08 * pop, b = new PathB(), rot = t2 * 9 * s;
      for (let a = 0; a < TAU * 2.2; a += 0.25) { const rr = (a / (TAU * 2.2)) * r * 0.26 * pop; const P = [ex + Math.cos(a + rot) * rr, ey + Math.sin(a + rot) * rr]; a ? b.L(P[0], P[1]) : b.M(P[0], P[1]); }
      strokePts(ink, b.p, { w: 3.2, seed: 310 + s, boil: 0.8, taper: 6, to: 1 });
    }
    // wobbly mouth
    const m = new PathB(); m.M(x - r * 0.3, y + r * 0.42);
    for (let i = 1; i <= 6; i++) m.L(x - r * 0.3 + i * r * 0.1, y + r * 0.42 + (i % 2 ? -1 : 1) * r * 0.07);
    strokePts(ink, m.p, { w: 3.6, seed: 320, boil: 1 });
    // sweat drop + scribble cloud of confusion
    const sw = E.outBack(k(t2, 12.75, 12.95));
    if (sw > 0) {
      const dx = x + r * 0.95, dy = y - r * 0.55 + Math.sin(t * 5) * 3;
      const drop = new PathB().M(dx, dy - 22 * sw).C(dx + 14 * sw, dy, dx + 12 * sw, dy + 14 * sw, dx, dy + 14 * sw).C(dx - 12 * sw, dy + 14 * sw, dx - 14 * sw, dy, dx, dy - 22 * sw);
      washShape(wash, drop.p, COL.blue, 1, dx, dy, 330, { alpha: 0.8 });
      strokePts(ink, drop.p, { w: 3.4, seed: 331, boil: 1, color: COL.blue });
    }
    const sc = k(t, 12.55, 13.0);
    if (sc > 0) {
      if (!sceneLater.scrib) { const b = new PathB(); for (let i = 0; i < 70; i++) { const a = i * 0.55, rr = 22 + snoise(i / 4, 5) * 14; const P = [x + 30 + Math.cos(a) * rr * 1.6 + i * 0.9 - 30, y - r - 50 + Math.sin(a) * rr * 0.7]; i ? b.L(P[0], P[1]) : b.M(P[0], P[1]); } sceneLater.scrib = b.poly(); }
      stroke(ink, sceneLater.scrib, { w: 3, to: E.pen(sc), seed: 340, color: COL.graphite, boil: 1.3, alpha: 0.85 });
    }
  }
  // ---- thought circles rising to the cloud
  THOUGHTS.forEach((c, i) => {
    if (t < c.t) return;
    const p = spring(Math.floor(t * 15) / 15 - c.t, 2.6, 0.35);
    strokePts(ink, circlePath(c.x, c.y + Math.sin(t * 2 + i) * 4, c.r * p, -1.8 + i, 0.25).pts, { w: 5, seed: 350 + i, boil: 1.3, taper: 10 });
  });
  // ---- E: cloud
  if (t > 14.22) {
    stroke(ink, CLOUD_POLY, { w: 7, to: E.penFast(k(t, 14.22, 14.7)), seed: 360, boil: 1.8, taper: 14, sketch: true });
    washShape(wash, CLOUD_POLY.pts, COL.washBlue, k(t, 14.4, 15.1), 1700, 1300, 361, { maxR: 1100, alpha: 0.3 });
  }
  // little ?s around workbody
  if (t > 14.8) {
    [[2270, 760, 44, 14.82], [2340, 880, 30, 14.9]].forEach(([x, y, s, t0], i) => {
      const p = spring(Math.floor(t * 15) / 15 - t0, 3, 0.35) * (1 - E.inBack(k(t, 16.25, 16.45)));
      if (p <= 0.01) return;
      const [qp, dot] = qSmall(x, y, s * p, 370 + i);
      strokePts(ink, xform(qp.pts, x, y, 1, 0.25, 1, 1, x, y), { w: 4.4, seed: 370 + i, color: COL.blue, boil: 1.2 });
      fillPts(ink, ellipsePts(dot[0] + 3, dot[1], 4 * p, 4 * p, 0, 10), COL.blue, 0.5, 375 + i);
    });
  }
  // ---- 飞书 with wings
  if (t > 15.3) {
    const o = fsOffset(t);
    const bx = 1600 + o[0], by = 1205 + o[1] + Math.sin(t * 9) * 4 * k(t, 15.5, 15.7);
    const grow = E.outBack(k(Math.floor(t * 15) / 15, 15.32, 15.55));
    const settle = k(t, 16.95, 17.3);
    const flapRate = lerp(11, 3, settle), flapAmp = lerp(0.34, 0.1, settle);
    const flap = Math.sin(Math.floor(t * 15) / 15 * flapRate) * flapAmp;
    const ws = grow * lerp(0.85, 0.62, settle);
    const wingL = xform(WING.pts, bx + 22, by - 100, ws, 0.1 + flap + o[2]);
    const wingR = xform(WING.pts, bx + 278, by - 100, ws, -0.1 - flap + o[2], -1, 1);
    for (const [wpts, sd] of [[wingL, 380], [wingR, 381]]) {
      fillPts(ink, wpts, COL.paperLight, 0.8, sd, 0.95);
      strokePts(ink, wpts, { w: 5, seed: sd, boil: 1.4, taper: 10 });
    }
  }
  drawTextBlock(ink, FS_WORD, t);
  // ---- F: today's video; G: stretched; H: becomes the ribbon
  if (t > 16.5) {
    const sparkle = (x, y, s, t0, sd) => {
      const p = spring(Math.floor(t * 15) / 15 - t0, 3, 0.3) * (1 - E.inBack(k(t, 18.1, 18.3)));
      if (p <= 0.01) return;
      strokePts(ink, [[x - s * p, y], [x + s * p, y]], { w: 4.5, seed: sd, color: COL.red, taper: 6 });
      strokePts(ink, [[x, y - s * p], [x, y + s * p]], { w: 4.5, seed: sd + 1, color: COL.red, taper: 6 });
    };
    sparkle(2240, 2920, 26, 16.72, 400); sparkle(2200, 3000, 15, 16.8, 402); sparkle(2910, 3330, 20, 16.86, 404);
    let pts;
    const toRib = E.inOutCubic(k(t, 20.1, 20.62));
    if (t < 18.34) pts = RECT_F_POLY.pts;
    else pts = rectF(t);
    if (toRib > 0) {
      const sw = 0.05 * kick(t - 20.55, 0.7, 1.6) + 0.025 * (1 - toRib);
      const rib = xform(RIBBON.pts, 3025, -120, 1, sw, 1, 1, 3025, -120);
      pts = morph(pts, rib, toRib, 300, 30, 20);
    }
    // film-strip sprockets: the long video grows frame by frame
    if (t > 18.36 && t < 20.1) {
      const r = rectF(t), bottom = Math.max(...r.map((p) => p[1]));
      const gone = E.inBack(k(t, 19.8, 20.05));
      for (let row = 0; row < 16; row++) {
        const y = RECT_F.y + 50 + row * 66;
        if (y > bottom - 40) break;
        const appear = spring(t - (18.36 + row * 0.035), 3.2, 0.4) * (1 - gone);
        if (appear <= 0.02) continue;
        for (const [side, x] of [[0, RECT_F.x + 38], [1, RECT_F.x + RECT_F.w - 38]]) {
          const hole = roundRectPath(-13, -16, 26, 32, 6, 0.1).pts;
          strokePts(ink, xform(hole, x, y, appear, (rnd(row, side) - 0.5) * 0.2), { w: 3.6, seed: 500 + row * 2 + side, boil: 1, taper: 6 });
        }
      }
      // frame dividers between the sprockets
      for (let row = 1; row < 6; row++) {
        const y = RECT_F.y + row * 190 + 20;
        if (y > bottom - 30) break;
        const a = k(t, 18.45 + row * 0.08, 18.6 + row * 0.08) * (1 - gone);
        if (a > 0) strokePts(ink, [[RECT_F.x + 70, y], [RECT_F.x + 70 + (RECT_F.w - 140) * E.outCubic(a), y + 3]], { w: 3.4, seed: 540 + row, color: COL.graphite, boil: 1.2 });
      }
    }
    const drawn = E.penFast(k(t, 16.5, 16.95));
    const rp = new Poly(pts);
    if (toRib > 0) {
      washShape(wash, pts, COL.red, k(t, 20.3, 21.0), 3025, 3400, 410, { maxR: 3800, alpha: 0.95, bleed: 5 });
    }
    stroke(ink, rp, { w: 7, to: drawn, seed: 411, boil: 1.8, taper: 18, sketch: true });
    // play triangle (fades as the frame becomes the ribbon)
    const tp = E.outBack(k(Math.floor(t * 15) / 15, 16.92, 17.15), 2) * (1 - E.inBack(k(t, 19.85, 20.05)));
    if (tp > 0.01) {
      const yOff = t > 18.34 ? (rectF(t)[0] ? 0 : 0) : 0;
      const tri = triPts(RECT_F.x + RECT_F.w / 2 + 6, RECT_F.y + RECT_F.h / 2 + yOff, 120 * tp);
      washShape(wash, tri, COL.red, k(t, 16.95, 17.35), RECT_F.x + RECT_F.w / 2, RECT_F.y + RECT_F.h / 2, 412, { maxR: 150 });
      strokePts(ink, tri.concat([tri[0], tri[1]]), { w: 6, seed: 413, boil: 1.4, taper: 6 });
    }
    // drag lines while stretching
    const dl = Math.sin(Math.PI * k(t, 18.4, 19.0));
    if (dl > 0.02) for (let j = 0; j < 3; j++) {
      const x = RECT_F.x + 120 + j * 170, y = RECT_F.y + RECT_F.h + 200 + j * 60;
      strokePts(ink, [[x, y], [x, y + 260 * dl]], { w: 4, seed: 420 + j, color: COL.graphite, alpha: 0.8 * dl });
    }
    // star on the ribbon
    const sp = spring(Math.floor(t * 15) / 15 - 20.55, 2.4, 0.32);
    if (sp > 0.01) {
      const S = [];
      for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, rr = (i % 2 ? 0.45 : 1) * 80 * sp; S.push([3025 + Math.cos(a) * rr, 3330 + Math.sin(a) * rr]); }
      fillPts(ink, S, COL.paperLight, 1, 430);
      strokePts(ink, S, { w: 6, seed: 431, boil: 1.4, taper: 6 });
    }
  }
}

/* -------------------------------------------------- background & foreground */
const DOODLES = []; // faint show-through marks of the previous page (parallax layer)
for (let i = 0; i < 90; i++) {
  const x = rnd(i, 501) * (PAGE_W + 800) - 400, y = rnd(i, 502) * (PAGE_H + 800) - 400, kind = Math.floor(rnd(i, 503) * 4), s = 18 + rnd(i, 504) * 40;
  const b = new PathB();
  if (kind === 0) { b.M(x - s, y).L(x + s, y); } // dash
  else if (kind === 1) { b.A(x, y, s * 0.6, s * 0.6, 0, TAU * 0.85); }
  else if (kind === 2) { b.M(x - s * 0.5, y - s * 0.5).L(x + s * 0.5, y + s * 0.5); }
  else { b.M(x, y); for (let j = 1; j < 6; j++) b.L(x + j * s * 0.3, y + (j % 2 ? -1 : 1) * s * 0.12); }
  DOODLES.push({ poly: b.poly(), seed: 600 + i });
}
const SPECKS = []; for (let i = 0; i < 18; i++) SPECKS.push({ x: rnd(i, 701) * W, y: rnd(i, 702) * H, r: 2 + rnd(i, 703) * 6, big: i < 3, depth: 1.25 + rnd(i, 704) * 0.4 });

function drawBackground(g, t) {
  // paper, world-locked
  setCam(g, 1);
  g.fillStyle = paperPat; g.fillRect(-6000, -6000, 16000, 16000);
  // show-through marks from the next page: drift at 0.9x
  setCam(g, 0.9);
  for (const d of DOODLES) strokePts(g, d.poly.pts, { w: 3, color: COL.graphite, alpha: 0.07, seed: d.seed, boil: 0.8 });
}
function drawForeground(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (const s of SPECKS) {
    const x = ((s.x - CAM.x * CAM.z * (s.depth - 1) * 0.6) % W + W) % W, y = ((s.y - CAM.y * CAM.z * (s.depth - 1) * 0.6 + Math.sin(t * 0.4 + s.r) * 10) % H + H) % H;
    const r = s.big ? 30 + s.r * 4 : s.r;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(60,55,60,${s.big ? 0.05 : 0.16})`); gr.addColorStop(1, 'rgba(60,55,60,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function grade(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  // light colour follows the mood: warm -> cool (confusion) -> warm red (收藏)
  const keys = [[0, [255, 244, 228]], [6, [255, 249, 240]], [11, [248, 250, 255]], [15.5, [246, 249, 255]], [18, [255, 248, 238]], [21, [255, 238, 226]]];
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i][0] && t <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
  const u = E.inOutSine(k(t, a[0], b[0]));
  const c = a[1].map((v, i) => Math.round(lerp(v, b[1][i], u)));
  g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgb(${c})`; g.fillRect(0, 0, W, H);
  // drifting window light
  g.globalCompositeOperation = 'soft-light';
  const lx = W * (0.3 + 0.25 * Math.sin(t * 0.21)), ly = H * (0.25 + 0.15 * Math.cos(t * 0.17));
  const lg = g.createRadialGradient(lx, ly, 0, lx, ly, 900);
  lg.addColorStop(0, 'rgba(255,250,235,0.55)'); lg.addColorStop(1, 'rgba(255,250,235,0)');
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  // vignette
  g.globalCompositeOperation = 'multiply';
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.78);
  vg.addColorStop(0, 'rgba(255,255,255,1)'); vg.addColorStop(1, 'rgba(222,210,190,1)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
}

/* ------------------------------------------------------------ the frame */
function drawScene(g, t) {
  CAM = camera(t);
  WSCALE = Math.max(1, 0.62 / CAM.z);
  drawBackground(g, t);
  // layers (world space)
  wash.setTransform(1, 0, 0, 1, 0, 0); wash.clearRect(0, 0, W, H);
  ink.setTransform(1, 0, 0, 1, 0, 0); ink.clearRect(0, 0, W, H);
  setCam(wash); setCam(ink);
  sceneA(t);
  sceneThreadA(t);
  if (t > 6.3) stroke(wash, HILITE, { w: 74, to: E.outCubic(k(t, 6.3, 7.0)), color: COL.ochre, alpha: 0.75 * (1 - k(t, 7.3, 7.6)), seed: 160, boil: 3, taper: 20 });
  drawTextBlock(ink, textB, t);
  sceneLater(t);
  drawTextBlock(ink, textC, t);
  drawTextBlock(ink, textD, t);
  drawTextBlock(ink, textE, t);
  drawTextBlock(ink, textF, t);
  drawTextBlock(ink, textG, t);
  // granulation + pencil tooth (world-locked)
  setCam(wash); wash.globalCompositeOperation = 'destination-out'; wash.globalAlpha = 0.35; wash.fillStyle = washPat; wash.fillRect(-6000, -6000, 16000, 16000);
  wash.globalCompositeOperation = 'source-over'; wash.globalAlpha = 1;
  setCam(ink); ink.globalCompositeOperation = 'destination-out'; ink.globalAlpha = 0.38; ink.fillStyle = toothPat; ink.fillRect(-6000, -6000, 16000, 16000);
  ink.globalCompositeOperation = 'source-over'; ink.globalAlpha = 1;
  // screen-space closing line (drawn after tooth so it's crisp, gets its own light tooth)
  ink.setTransform(1, 0, 0, 1, 0, 0);
  drawEndText(ink, t);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(washC, 0, 0);
  g.drawImage(inkC, 0, 0);
  g.globalCompositeOperation = 'source-over';
  drawForeground(g, t);
  grade(g, t);
}
function drawEndText(g, t) {
  if (t < 19.3) return;
  // a soft "cleared" patch of paper under the words keeps them legible over the page
  const a = E.outCubic(k(t, 19.3, 19.8));
  g.save();
  g.globalAlpha = 0.0; // (placeholder: the bottom band of the page is kept empty by design)
  g.restore();
  drawTextBlock(g, textH, t);
  // hand-drawn circle around 收藏
  layoutBlock(g, textH);
  const its = textH.items.filter((it) => it.mode === 1);
  if (its.length && t > 20.42) {
    const x0 = its[0].x, x1 = its[its.length - 1].x + its[its.length - 1].adv, y = its[0].y - its[0].size * 0.36;
    if (!textH.circ) textH.circ = new PathB().A((x0 + x1) / 2, y, (x1 - x0) / 2 + 26, its[0].size * 0.62, -2.6, -2.6 + TAU * 1.08).poly();
    const save = WSCALE; WSCALE = 1;
    stroke(g, textH.circ, { w: 6, to: E.pen(k(t, 20.42, 20.85)), seed: 450, color: COL.red, boil: 1.6, taper: 20 });
    WSCALE = save;
  }
}

// motion blur: sub-frame accumulation over a 180° shutter; more samples when the camera moves fast
function subSamples(f) {
  const a = camera(f / FPS), b = camera((f + 0.5) / FPS);
  const disp = Math.hypot(a.x - b.x, a.y - b.y) * a.z + Math.abs(Math.log(a.z / b.z)) * 900 + Math.abs(a.r - b.r) * 900;
  return Math.max(3, Math.min(16, Math.round(disp / 4) + 3));
}
window.renderFrame = function (f) {
  FRAME = f; BOIL = Math.floor(f / 2);
  if (!paperPat) { paperPat = out.createPattern(PAPER, 'repeat'); toothPat = out.createPattern(TOOTH, 'repeat'); washPat = out.createPattern(WASHGRAIN, 'repeat'); }
  acc.setTransform(1, 0, 0, 1, 0, 0);
  const SUB = subSamples(f);
  for (let s = 0; s < SUB; s++) {
    const t = (f + (s / SUB) * 0.5) / FPS;
    sub.setTransform(1, 0, 0, 1, 0, 0); sub.globalCompositeOperation = 'source-over'; sub.globalAlpha = 1;
    drawScene(sub, t);
    acc.globalAlpha = 1 / (s + 1);
    acc.drawImage(subC, 0, 0);
  }
  acc.globalAlpha = 1;
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.globalCompositeOperation = 'source-over';
  out.drawImage(accC, 0, 0);
  // film grain on twos
  out.globalCompositeOperation = 'overlay'; out.globalAlpha = 0.07;
  const fg = FILM[BOIL % 4], ox = Math.floor(rnd(BOIL, 801) * 256), oy = Math.floor(rnd(BOIL, 802) * 256);
  for (let x = -ox; x < W; x += 256) for (let y = -oy; y < H; y += 256) out.drawImage(fg, x, y);
  out.globalAlpha = 1; out.globalCompositeOperation = 'source-over';
  return true;
};
window.FILM_INFO = { W, H, FPS, TOTAL_FRAMES, DURATION };
window.ready = document.fonts.ready.then(() => Promise.all([document.fonts.load('60px WenKai'), document.fonts.load('60px KuaiLe')]));
