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

/* Magnitude-limited spectral mix — what a photograph samples, not the true
   population. Sampling the true one gives a field of dim orange dots. */
const SPECTRAL = [
  { w: 0.08, lo: 9500, hi: 15000 },
  { w: 0.18, lo: 7500, hi: 9800 },
  { w: 0.38, lo: 5300, hi: 7300 },
  { w: 0.24, lo: 4000, hi: 5200 },
  { w: 0.12, lo: 3100, hi: 3900 },
];

function pickTemperature(rng) {
  let roll = rng.next();
  for (const s of SPECTRAL) {
    if (roll < s.w) return s.lo + rng.next() * (s.hi - s.lo);
    roll -= s.w;
  }
  return 5800;
}

/* Sky coords are height-normalized: y in [0,1], x in [0,aspect]. Overscan
   spawns stars past the frame so parallax never reveals an empty border. */
export function generateBrightStars(seed, { count = 56, aspect = 1.78, overscan = 0.06 } = {}) {
  const rng = createRng(seed);
  const iA = new Float32Array(count * 4); // sky x, sky y, brightness, depth
  const iB = new Float32Array(count * 4); // r, g, b, twinkle phase
  const iC = new Float32Array(count * 4); // psf alpha px, spike length px, quad half px, beta

  for (let i = 0; i < count; i++) {
    const u = rng.next();
    /* Steep power law: many modest stars, a couple of standouts */
    const L = 0.06 + 0.94 * Math.pow(u, 3.2);
    const temp = pickTemperature(rng);
    const [r, g, b] = blackbodyRGB(temp);

    const alphaPx = 1.0 + 1.8 * Math.pow(L, 0.7);
    const spikeLenPx = 26 + 105 * Math.pow(L, 0.9);
    const quadHalfPx = Math.max(spikeLenPx * 1.25, alphaPx * 14);

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
    iC[i * 4 + 3] = 2.2 + rng.next() * 0.7;
  }

  return { count, iA, iB, iC };
}
