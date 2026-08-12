/* Bright-tier star generation (CPU). Returns typed arrays only;
   the render spine assembles geometry. Faint tier is pure fragment work. */

import { createRng } from '../core/rng.js';

/* Tanner Helland blackbody fit, normalized so the peak channel is 1 */
export function blackbodyRGB(kelvin) {
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
  return [
    Math.min(Math.max(r / m, 0), 1),
    Math.min(Math.max(g / m, 0), 1),
    Math.min(Math.max(b / m, 0), 1),
  ];
}

/* Weighted toward B/A/F. A magnitude-limited galactic sample is warmer than
   this, but the reference clusters are blue-white fields where the handful of
   orange members is the accent, and inverting that ratio is the loud tell. */
const SPECTRAL = [
  { w: 0.20, lo: 10000, hi: 16000 },
  { w: 0.28, lo: 7600, hi: 9900 },
  { w: 0.33, lo: 5600, hi: 7500 },
  { w: 0.14, lo: 4300, hi: 5500 },
  { w: 0.05, lo: 3300, hi: 4200 },
];

/* Exactly two draws per call whichever class wins, so re-weighting the table
   never shifts the stream and every star keeps the position it had. */
function pickTemperature(rng) {
  let roll = rng.next();
  const lerp = rng.next();
  for (const s of SPECTRAL) {
    if (roll < s.w) return s.lo + lerp * (s.hi - s.lo);
    roll -= s.w;
  }
  return 5800;
}

/* Fraction of the field promoted to a bright orange giant — the Jewel Box's
   single supergiant is what makes a blue-white cluster read as photographed. */
const ACCENT_FRACTION = 0.055;

/* Per-star jitter rides its own integer hash rather than the RNG stream:
   extra draws there would re-roll every star's position downstream. */
function starJitter(seed, i, salt) {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* Sky coords are height-normalized: y in [0,1], x in [0,aspect]. Overscan
   spawns stars past the frame so parallax never reveals an empty border. */
export function generateBrightStars(seed, { count = 56, aspect = 1.78, overscan = 0.06 } = {}) {
  const rng = createRng(seed);
  const iA = new Float32Array(count * 4); // sky x, sky y, brightness, depth
  const iB = new Float32Array(count * 4); // r, g, b, twinkle phase
  const iC = new Float32Array(count * 4); // psf alpha px, spike length px, quad half px, beta
  const iD = new Float32Array(count * 4); // spike angle jitter, arm ratio, halo amp, halo radius

  for (let i = 0; i < count; i++) {
    const u = rng.next();
    /* Steep power law: many modest stars, a couple of standouts */
    let L = 0.06 + 0.94 * Math.pow(u, 3.2);
    let temp = pickTemperature(rng);

    const accent = starJitter(seed, i, 3) < ACCENT_FRACTION;
    if (accent) {
      temp = 3300 + starJitter(seed, i, 5) * 900;
      L = Math.max(L, 0.52 + 0.42 * starJitter(seed, i, 4));
    }
    const [r, g, b] = blackbodyRGB(temp);

    const alphaPx = 1.0 + 1.8 * Math.pow(L, 0.7);
    const lenJit = 0.72 + 0.56 * starJitter(seed, i, 1);
    const spikeLenPx = (26 + 105 * Math.pow(L, 0.9)) * lenJit;
    const quadHalfPx = Math.max(spikeLenPx * 1.25, alphaPx * 22);

    iA[i * 4 + 0] = -overscan + rng.next() * (aspect + overscan * 2);
    iA[i * 4 + 1] = -overscan + rng.next() * (1 + overscan * 2);
    iA[i * 4 + 2] = L;
    iA[i * 4 + 3] = 0.8 + rng.next() * 0.55;

    iB[i * 4 + 0] = r;
    iB[i * 4 + 1] = g;
    iB[i * 4 + 2] = b;
    iB[i * 4 + 3] = rng.next();

    iC[i * 4 + 0] = alphaPx;
    iC[i * 4 + 1] = spikeLenPx;
    iC[i * 4 + 2] = quadHalfPx;
    iC[i * 4 + 3] = 1.9 + rng.next() * 1.1;

    iD[i * 4 + 0] = starJitter(seed, i, 2) * 2 - 1;
    iD[i * 4 + 1] = 0.62 + 0.76 * starJitter(seed, i, 6);
    iD[i * 4 + 2] = 0.7 + 0.7 * starJitter(seed, i, 7);
    iD[i * 4 + 3] = 0.75 + 0.75 * starJitter(seed, i, 8);
  }

  return { count, iA, iB, iC, iD };
}
