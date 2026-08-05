/* Static fallback sky for contexts without WebGL2/WebGPU. Ports the engine's
   field math to JS, approximating its seeded sky rather than matching exactly.
   Deliberately self-contained: it must run when engine files don't. */

const canvas = document.getElementById('sky');
const ctx = canvas?.getContext('2d', { alpha: false });
if (!canvas || !ctx) throw new Error('sky canvas unavailable');

const urlSeed = parseInt(new URLSearchParams(location.search).get('seed'), 10);
const SEED = Number.isFinite(urlSeed) ? urlSeed : 9281980;

/* Mulberry32, kept in exact sync with the engine's rng.js */
function createRng(seed) {
  let s = seed | 0;
  return function next() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function deriveSeed(rootSeed, salt) {
  const rng = createRng((rootSeed ^ Math.imul(salt, 0x9E3779B1)) | 0);
  return Math.floor(rng() * 0x7FFFFFFF);
}

function offsetFrom(seed, salt) {
  const rng = createRng(deriveSeed(seed, salt));
  return [Math.floor(rng() * 256), Math.floor(rng() * 256), Math.floor(rng() * 256)];
}

/* Integer hashes, bit-exact with the engine shaders */
function hash1(ix, iy, iz) {
  const n = (ix + 1024 + Math.imul(iy + 1024, 198491317) + Math.imul(iz + 1024, 6542989)) >>> 0;
  const s = (Math.imul(n, 747796405) + 2891336453) >>> 0;
  const w = Math.imul((s >>> (((s >>> 28) + 4) & 31)) ^ s, 277803737) >>> 0;
  return (((w >>> 22) ^ w) >>> 0) / 4294967296;
}

function pcg3d(ax, ay, az) {
  let x = ax >>> 0, y = ay >>> 0, z = az >>> 0;
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x ^= x >>> 16; y ^= y >>> 16; z ^= z >>> 16;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  const k = 2.3283064365386963e-10;
  return [x * k, y * k, z * k];
}

const hash3 = (ix, iy, iz) => pcg3d(ix + 1024, iy + 1024, iz + 1024);

const sstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

function valueNoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const n = (dx, dy, dz) => hash1(ix + dx, iy + dy, iz + dz);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(n(0, 0, 0), n(1, 0, 0), ux), lerp(n(0, 1, 0), n(1, 1, 0), ux), uy),
    lerp(lerp(n(0, 0, 1), n(1, 0, 1), ux), lerp(n(0, 1, 1), n(1, 1, 1), ux), uy),
    uz,
  );
}

function fbm3(x, y, z, oct) {
  let sum = 0, amp = 0.5;
  for (let o = 0; o < oct; o++) {
    sum += valueNoise3(x, y, z) * amp;
    x *= 2.02; y *= 2.02; z *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

/* Entity sub-seeds and domain offsets, matching site/hero-scene.js + the spine */
const offN = offsetFrom(deriveSeed(SEED, 2), 11);
const offI = offsetFrom(deriveSeed(SEED, 3), 23);
const starSeed = deriveSeed(SEED, 1);
const offClump = offsetFrom(starSeed, 31);
const offA = offsetFrom(starSeed, 37);
const offB = offsetFrom(starSeed, 41);
const offW = offsetFrom(deriveSeed(SEED, 4), 43);

const stretch = (x) => Math.asinh(10 * x) / Math.asinh(10);

/* The engine's emission + dust field at one pixel, natural-HOO graded */
function fieldRGB(u, v) {
  const px = u * 1.35 + offN[0], py = v * 1.35 + offN[1], pz = offN[2];
  const q1 = fbm3(px * 1.7, py * 1.7, pz * 1.7, 4);
  const q2 = fbm3(px * 1.7 + 5.2, py * 1.7 + 1.3, pz * 1.7 + 2.8, 4);
  const M = fbm3(px * 2.4 + q1 * 1.3, py * 2.4 + q2 * 1.3, pz * 2.4, 5);

  const src = fieldRGB.src;
  const dx = u - src[0], dy = v - src[1];
  const G = 1 / (1 + (dx * dx + dy * dy) / 0.5625);
  const cov = sstep(0.3, 0.48, fbm3(u * 1.215 + offN[0] * 2, v * 1.215 + offN[1] * 2, offN[2] * 2, 2));
  const S = fbm3(u * 9 + offN[0] * 0.5, v * 0.3 + offN[1] * 0.5, offN[2] * 0.5, 2);

  let E = G * (1 + 1.3 * (M - 0.5)) * cov * (1 - 0.35 * S);
  E = Math.pow(Math.max(E, 1e-5), 1.2) * 1.2;
  const hot = sstep(0.55, 0.9, G);
  const Ha = E, O3 = E * (hot * 0.55 + 0.015);

  const ifn = fbm3(u * 1.3 + offI[0], v * 1.3 + offI[1], offI[2], 2) * 0.16;

  const wx = u * 2.4 + offW[0], wy = v * 4.8 + offW[1], wz = offW[2];
  const carved = fbm3(wx, wy, wz, 4) + (fbm3(wx * 3.1, wy * 3.1, wz * 3.1, 2) - 0.5) * 0.45;
  const tau = sstep(0.55, 0.67, carved) * 2.8;

  let r = (Ha + ifn * 0.16) * Math.exp(-tau) * 0.85;
  let g = (0.15 * Ha + 0.85 * O3 + ifn * 0.14) * Math.exp(-tau * 1.35) * 0.85;
  let b = (O3 + ifn * 0.12) * Math.exp(-tau * 1.9) * 0.85;

  const lum = Math.max(r, g, b, 1e-5);
  const scale = stretch(lum) / lum;
  r = Math.max(r * scale - 0.015, 0);
  g = Math.max(g * scale - 0.015, 0);
  b = Math.max(b * scale - 0.015, 0);
  return [r, g, b];
}

function drawField(w, h, aspect) {
  const lw = Math.min(420, Math.max(160, Math.round(w / 6)));
  const lh = Math.max(90, Math.round(lw / aspect));
  /* Plain canvas, not OffscreenCanvas: this file is the floor of the
     fallback chain and must not depend on anything newer than 2D */
  const off = document.createElement('canvas');
  off.width = lw;
  off.height = lh;
  const octx = off.getContext('2d');
  const img = octx.createImageData(lw, lh);
  fieldRGB.src = [1.05 * aspect, 0.8];

  for (let y = 0; y < lh; y++) {
    const v = 1 - y / lh;
    for (let x = 0; x < lw; x++) {
      const [r, g, b] = fieldRGB((x / lw) * aspect, v);
      const i = (y * lw + x) * 4;
      img.data[i] = Math.min(r, 1) * 255;
      img.data[i + 1] = Math.min(g, 1) * 255;
      img.data[i + 2] = Math.min(b, 1) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, w, h);
}

function starTint(t) {
  const mixc = (a, b, k) => a.map((c, i) => c + (b[i] - c) * k);
  const warm = [1, 0.76, 0.5], white = [1, 1, 1], blue = [0.72, 0.79, 1];
  return t < 0.55 ? mixc(warm, white, sstep(0, 0.55, t)) : mixc(white, blue, sstep(0.55, 1, t));
}

function drawFaintTier(h, aspect, cells, densityMul, brightScale, off) {
  const pxPerUnit = h;
  const nx = Math.ceil(aspect * cells), ny = cells;
  for (let cy = -1; cy <= ny; cy++) {
    for (let cx = -1; cx <= nx; cx++) {
      const h1 = hash3(cx + off[0], cy + off[1], 7 + off[2]);
      const h2 = hash3(cx + off[0], cy + off[1], 91 + off[2]);
      const su = (cx + h1[0]) / cells, sv = (cy + h1[1]) / cells;

      const bandD = Math.abs(sv - su * -0.28 - 0.32);
      const grad = 1 + (0.45 - 1) * sstep(0, 0.55, bandD);
      const clump = fbm3(su * 2.6 + offClump[0], sv * 2.6 + offClump[1], offClump[2], 2) * 0.9 + 0.55;
      if (h1[2] >= Math.min(grad * clump * densityMul, 1)) continue;

      const rel = Math.pow(h2[0], 3);
      const L = Math.pow(h2[0], 6) * brightScale * 0.93;
      const aC = Math.max(0.45 + 0.8 * rel, 0.7);
      const energy = ((0.45 + 0.8 * rel) ** 2) / (aC * aC);
      const alpha = Math.min(stretch(L * energy), 1);
      if (alpha < 0.02) continue;

      const tint = starTint(Math.pow(h2[1], 0.45));
      const sat = sstep(0, 0.12, rel);
      const col = tint.map((c) => (1 + (c - 1) * sat) * 255 | 0);
      const x = su * pxPerUnit, y = h - sv * pxPerUnit;
      const rad = aC * 1.6;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.2);
      glow.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${alpha})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, rad * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* Bright tier tracks the engine's population, with simplified 2D rendering */
const SPECTRAL = [
  { w: 0.20, lo: 10000, hi: 16000 },
  { w: 0.28, lo: 7600, hi: 9900 },
  { w: 0.33, lo: 5600, hi: 7500 },
  { w: 0.14, lo: 4300, hi: 5500 },
  { w: 0.05, lo: 3300, hi: 4200 },
];

const ACCENT_FRACTION = 0.055;

function starJitter(seed, i, salt) {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function blackbodyRGB(kelvin) {
  const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const m = Math.max(r, g, b, 1);
  return [r, g, b].map((c) => Math.min(Math.max(c / m, 0), 1));
}

function drawBrightTier(h, aspect) {
  const rng = createRng(starSeed);
  const overscan = 0.06;
  /* 169 and unit density mirror hero.cosmos, the sky this canvas stands in for */
  for (let i = 0; i < 169; i++) {
    const u = rng();
    let L = 0.06 + 0.94 * Math.pow(u, 3.2);
    let roll = rng(), temp = 5800;
    const lerp = rng();
    for (const s of SPECTRAL) {
      if (roll < s.w) { temp = s.lo + lerp * (s.hi - s.lo); break; }
      roll -= s.w;
    }
    if (starJitter(starSeed, i, 3) < ACCENT_FRACTION) {
      temp = 3300 + starJitter(starSeed, i, 5) * 900;
      L = Math.max(L, 0.52 + 0.42 * starJitter(starSeed, i, 4));
    }
    const [cr, cg, cb] = blackbodyRGB(temp);
    const alphaPx = 1 + 1.8 * Math.pow(L, 0.7);
    const spikeLen = (26 + 105 * Math.pow(L, 0.9)) * (0.72 + 0.56 * starJitter(starSeed, i, 1));
    const sx = (-overscan + rng() * (aspect + overscan * 2)) * h;
    const sy = h - (-overscan + rng() * (1 + overscan * 2)) * h;
    rng(); rng(); rng();

    const I = Math.min(stretch(L), 1);
    const core = Math.min(sstep(0.35, 0.9, L) + 0.4, 1);
    const col = [cr, cg, cb].map((c) => ((1 + (c - 1) * (1 - core * 0.7)) * 255) | 0);

    const glowR = alphaPx * 9;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
    glow.addColorStop(0, `rgba(255,255,255,${I})`);
    glow.addColorStop(0.25, `rgba(${col[0]},${col[1]},${col[2]},${I * 0.5})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
    ctx.fill();

    const spikeAmp = Math.min(Math.max((L - 0.5) * 3, 0), 1) * I * 0.85;
    if (spikeAmp > 0.02) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(0.35);
      for (let axis = 0; axis < 2; axis++) {
        const bar = ctx.createLinearGradient(-spikeLen, 0, spikeLen, 0);
        bar.addColorStop(0, 'rgba(0,0,0,0)');
        bar.addColorStop(0.5, `rgba(228,238,255,${spikeAmp})`);
        bar.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bar;
        ctx.fillRect(-spikeLen, -1.1, spikeLen * 2, 2.2);
        ctx.rotate(Math.PI / 2);
      }
      ctx.restore();
    }
  }
}

function render() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  canvas.width = w;
  canvas.height = h;
  const aspect = w / h;

  drawField(w, h, aspect);
  ctx.globalCompositeOperation = 'lighter';
  drawFaintTier(h, aspect, 42, 1, 1.7, offA);
  drawFaintTier(h, aspect, 14, 0.55, 4.0, offB);
  drawBrightTier(h, aspect);
  ctx.globalCompositeOperation = 'source-over';
}

render();

/* Pages that ship their own veil (no sky.js host) get the same gentle
   first-load reveal as the homepage */
const veilEl = document.getElementById('veil');
if (veilEl?.classList.contains('is-dark')) {
  (async () => {
    if (document.readyState !== 'complete') {
      await new Promise((r) => window.addEventListener('load', r, { once: true }));
    }
    await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    veilEl.classList.remove('is-dark');
  })();
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 200);
}, { passive: true });
