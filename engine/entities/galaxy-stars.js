/* Resolved-star tier for the showpiece galaxy (CPU sampling). Returns typed
   arrays only; the render spine assembles the geometry and the shader owns the
   orbit, the projection, and the dust extinction. */

import { createRng } from '../core/rng.js';
import { blackbodyRGB } from './stars.js';

const TAU = Math.PI * 2;

/* Radii are sampled dimensionless and scaled in the shader by the glow's own
   bulge radius and disk falloff, so the sprites fill the silhouette it draws. */
const DISK_RMAX = 5.0;
const BULGE_RMAX = 4.0;
const CDF_STEPS = 512;

/* Annulus-weighted surface brightness: stars per radius goes as I(r) * r */
const diskPdf = (r) => r * Math.exp(-r);
const bulgePdf = (r) => r / (1 + r * r) ** 2;

/* Trapezoid cumulative over a bounded range, renormalized to 1 at rMax.
   Bounding is what keeps the Plummer wings from scattering stars off frame. */
function cdfTable(pdf, rMax) {
  const step = rMax / CDF_STEPS;
  const c = new Float64Array(CDF_STEPS + 1);
  let acc = 0;
  for (let i = 1; i <= CDF_STEPS; i++) {
    acc += (pdf((i - 1) * step) + pdf(i * step)) * 0.5 * step;
    c[i] = acc;
  }
  for (let i = 1; i <= CDF_STEPS; i++) c[i] /= acc;
  return { c, step };
}

const DISK_CDF = cdfTable(diskPdf, DISK_RMAX);
const BULGE_CDF = cdfTable(bulgePdf, BULGE_RMAX);

/* Binary search for the bracketing pair, then lerp inside that one step */
function invCdf(tab, u) {
  const { c, step } = tab;
  let lo = 0;
  let hi = c.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid] <= u) lo = mid;
    else hi = mid;
  }
  const span = c[hi] - c[lo];
  return (lo + (span > 1e-12 ? (u - c[lo]) / span : 0)) * step;
}

/* The resolved disk population is young OB and A stars strung along the arms,
   which is why the references read blue-white against a gold bulge. */
const DISK_SPECTRAL = [
  { w: 0.30, lo: 11000, hi: 20000 },
  { w: 0.26, lo: 8000, hi: 10500 },
  { w: 0.22, lo: 6000, hi: 7800 },
  { w: 0.14, lo: 4600, hi: 5900 },
  { w: 0.08, lo: 3400, hi: 4500 },
];
const BULGE_LO = 3800;
const BULGE_HI = 5300;

/* Exactly two draws whichever branch wins, so re-weighting the table never
   shifts the stream and every star keeps the position it had. */
function pickTemperature(rng, bulge) {
  let roll = rng.next();
  const lerp = rng.next();
  if (bulge) return BULGE_LO + lerp * (BULGE_HI - BULGE_LO);
  for (const s of DISK_SPECTRAL) {
    if (roll < s.w) return s.lo + lerp * (s.hi - s.lo);
    roll -= s.w;
  }
  return 6500;
}

/* One uniform to a signed deviate: the magnitude picks the height, the sign
   picks the face. Capped short of 1 or the exponential inverse diverges. */
function twoSided(u) {
  const v = u * 2 - 1;
  return { sign: v < 0 ? -1 : 1, mag: Math.min(Math.abs(v), 0.9995) };
}

/* Lin-Shu density wave: every star owns an ellipse whose tilt grows with its
   semi-major axis; the arms are emergent crowding, never an assignment. */
export function generateGalaxyStars(seed, { count = 0, bulgeFrac = 0.22 } = {}) {
  const n = Math.max(0, Math.floor(count));
  const rng = createRng(seed);
  /* iA = semi-major axis (component units), orbit phase, height (component
     units), bulge flag. iB = continuum rgb, luminosity. */
  const iA = new Float32Array(n * 4);
  const iB = new Float32Array(n * 4);
  const frac = Math.min(Math.max(bulgeFrac, 0), 1);

  for (let i = 0; i < n; i++) {
    /* Seven draws per star in a fixed order: the count is what has to stay
       constant, so re-tuning a weight never reshuffles the field. */
    const bulge = rng.next() < frac;
    const rU = rng.next();
    const phase = rng.next() * TAU;
    const zU = twoSided(rng.next());
    const lU = rng.next();
    const temp = pickTemperature(rng, bulge);

    /* Bulge height mirrors its own radial profile, mildly flattened; the disk
       gets a two-sided exponential the shader scales by the height dial. */
    const z = bulge
      ? zU.sign * invCdf(BULGE_CDF, zU.mag) * 0.75
      : zU.sign * -Math.log(1 - zU.mag);
    const [r, g, b] = blackbodyRGB(temp);

    const d = i * 4;
    iA[d] = invCdf(bulge ? BULGE_CDF : DISK_CDF, rU);
    iA[d + 1] = phase;
    iA[d + 2] = z;
    iA[d + 3] = bulge ? 1 : 0;

    iB[d] = r;
    iB[d + 1] = g;
    iB[d + 2] = b;
    /* Steep power law, bulge dimmed 0.55×: a flat luminosity roll and a bright
       sprinkle over a nucleus that should read smooth are the two loud tells. */
    iB[d + 3] = (0.04 + 0.96 * lU ** 3.4) * (bulge ? 0.55 : 1);
  }

  return { count: n, iA, iB };
}
