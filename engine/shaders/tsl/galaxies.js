/* Background galaxies: a deep field of small smudges plus one optional
   showpiece, which lives in galaxy-showpiece.js. Starlight is continuum; only
   the HII knots strung along arms and rings reach the line RT. */

import {
  Fn, float, vec2, vec3, clamp, exp, floor, fract, length,
  max, mix, pow, smoothstep, step,
} from 'three/tsl';
import { hash1, hash3 } from './noise.js';
import { rot2, sdEllipse, sdfEnvelope, remapRange } from './sdf.js';
import { showpieceGalaxy, DEV_K } from './galaxy-showpiece.js';

const TAU = Math.PI * 2;

// Field tier

/* A scattered handful of small smudges on a coarse cell grid. Most cells are
   empty; the 3x3 search covers any galaxy whose extent stays under one cell. */
export function fieldGalaxies(sky, U) {
  const g = sky.mul(U.uGxfCells).toVar();
  const base = floor(g).toVar();
  const f = fract(g).toVar();
  const acc = vec3(0).toVar();

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const o = vec2(dx, dy);
      const c = base.add(o).toVar();
      const h1 = hash3(vec3(c, 5.0).add(U.uGxfOff)).toVar();
      const h2 = hash3(vec3(c, 71.0).add(U.uGxfOff)).toVar();

      /* Cluster mode: a Plummer-like radial profile multiplies the occupancy
         roll, turning a flat deep field into a centrally concentrated Abell. */
      const at = c.add(h1.xy).div(U.uGxfCells).toVar();
      const rc = length(at.sub(U.uGxfAt)).div(U.uGxfClusterR.max(1e-3)).toVar();
      const clump = float(1).div(rc.mul(rc).add(1.0)).toVar();
      const dens = U.uGxfDensity
        .mul(mix(float(1.0), clump.mul(U.uGxfClusterPeak), U.uGxfCluster)).toVar();

      const present = step(h1.z, dens).toVar();
      /* h1.z is the occupancy roll, and among surviving cells it is still
         uniform on [0, dens) — a free brightness variate, no extra hash. */
      const rel = h1.z.div(dens.max(1e-4)).toVar();

      /* One scalar hash carries the whole redshift story: apparent size,
         surface brightness, and where the galaxy lands on the z→color ramp. */
      const hz = hash1(vec3(c, 137.0).add(U.uGxfOff)).toVar();
      const opz = mix(U.uGxfZLo, U.uGxfZHi, hz).add(1.0).max(1e-3).toVar();
      const zSize = pow(opz, U.uGxfZSize.negate()).toVar();
      const zDim = pow(opz, U.uGxfZDim.negate()).toVar();

      /* uGxfRadius is in CELL units (d lives in cell space), unlike every other
         radius in the engine; above ~0.45 the 3x3 search clips the ellipse. */
      const ra = U.uGxfRadius.mul(mix(0.55, 1.6, h2.x)).mul(zSize).max(1e-4).toVar();
      /* Axis ratio is the inclination: 1 face-on, uGxfFlat edge-on */
      const axis = mix(U.uGxfFlat, 1.0, h2.y).toVar();
      const rb = ra.mul(axis).max(1e-4).toVar();

      const d = f.sub(o).sub(h1.xy).toVar();
      const q = rot2(d, h2.z.mul(TAU).negate()).toVar();
      const u = length(vec2(q.x.div(ra), q.y.div(rb))).toVar();

      /* sdEllipse degenerates to 0 exactly at the center; the interior is
         solid anyway, so floor the envelope inside rather than trust it there. */
      const env = max(
        sdfEnvelope(sdEllipse(q, vec2(0.0), vec2(ra, rb)), ra.mul(U.uGxfFeather)),
        float(1).sub(smoothstep(0.6, 1.0, u)),
      ).toVar();

      const coreP = exp(u.mul(U.uGxfCoreFall).negate());
      const diskP = exp(u.mul(U.uGxfDiskFall).negate());
      const prof = coreP.mul(U.uGxfCoreAmt).add(diskP)
        .div(U.uGxfCoreAmt.add(1.0).max(1.0)).mul(env).toVar();

      /* Only near-edge-on disks show a lane; keying the gate off the same axis
         ratio is the physics, not a style choice. */
      const edgeOn = float(1).sub(smoothstep(U.uGxfLaneAt, U.uGxfLaneAt.add(0.18), axis));
      const lane = float(1).sub(smoothstep(float(0.0), rb.mul(U.uGxfLaneW).max(1e-5), q.y.abs()))
        .mul(edgeOn).mul(U.uGxfLaneDepth).toVar();

      /* Lane raises the threshold the disk must clear (remap doctrine, sdf.js) */
      const carved = clamp(remapRange(prof, lane, float(1.0), float(0.0), float(1.0)), 0.0, 1.0);

      const baseTint = mix(U.uGxfCore, U.uGxfDisk, smoothstep(float(0.0), U.uGxfCoreR.max(1e-3), u));
      /* Three-stop z ramp, the one control that separates the Hubble look from
         the JWST one. hz is already uniform on [0,1], so it IS the ramp param. */
      const zCol = mix(
        mix(U.uGxfZNear, U.uGxfZMid, clamp(hz.mul(2.0), 0.0, 1.0)),
        U.uGxfZFar,
        clamp(hz.mul(2.0).sub(1.0), 0.0, 1.0),
      ).toVar();
      const tint = mix(baseTint, zCol, U.uGxfZTint);
      const L = mix(0.3, 1.0, rel.mul(rel)).mul(U.uGxfLum).mul(zDim);
      acc.addAssign(tint.mul(carved).mul(L).mul(present));
    }
  }
  return acc;
}

/* Both tiers land on the continuum RT; only the HII knots reach the line RT.
   The shell elliptical is an old stellar population, so it builds no line node. */
export function buildGalaxyNodes(skyU, U, opts = {}) {
  const { field = true, showpiece = false, look = {} } = opts;

  const continuum = Fn(() => {
    if (!showpiece) return field ? fieldGalaxies(skyU, U) : vec3(0.0);
    const sp = showpieceGalaxy(skyU, U, look, false).cont;
    return field ? fieldGalaxies(skyU, U).add(sp) : sp;
  })();

  const out = { continuum };
  if (showpiece && !look.shell) {
    out.line = Fn(() => showpieceGalaxy(skyU, U, look, true).line)();
  }
  return out;
}

/* The two shipped z→RGB ramps, flattened near/mid/far. Hubble runs blue through
   yellow to red; JWST's MIRI color classes run cyan through white to orange. */
export const Z_RAMPS = {
  hubble: [0.72, 0.84, 1.0, 1.0, 0.88, 0.6, 1.0, 0.55, 0.34],
  jwst: [0.55, 0.9, 1.0, 0.86, 1.0, 0.9, 1.0, 0.52, 0.3],
};

/* Curated palettes drawn off the reference set, so a procedural showpiece lands
   on a real galaxy's coloring rather than a hue wheel. */
/* bulge and disk are continuum RGB; flowerLines is (Hα, OIII, SII) line weights */
export const GX_FAMILIES = [
  { bulge: [1.0, 0.82, 0.58], disk: [0.62, 0.76, 1.0], flowerLines: [1.0, 0.24, 0.1] },
  { bulge: [1.0, 0.74, 0.42], disk: [0.72, 0.74, 0.92], flowerLines: [1.0, 0.2, 0.14] },
  { bulge: [0.94, 0.88, 0.78], disk: [0.52, 0.72, 1.0], flowerLines: [1.0, 0.32, 0.08] },
  { bulge: [1.0, 0.7, 0.38], disk: [0.88, 0.78, 0.66], flowerLines: [1.0, 0.16, 0.12] },
  { bulge: [0.88, 0.86, 0.82], disk: [0.58, 0.8, 1.0], flowerLines: [0.9, 0.34, 0.06] },
  { bulge: [1.0, 0.76, 0.6], disk: [0.8, 0.7, 0.86], flowerLines: [1.0, 0.18, 0.2] },
  { bulge: [0.96, 0.86, 0.66], disk: [0.56, 0.84, 0.98], flowerLines: [0.85, 0.45, 0.06] },
  { bulge: [1.0, 0.66, 0.34], disk: [0.78, 0.68, 0.72], flowerLines: [1.0, 0.14, 0.18] },
];

/* Arm counts weighted the way the sky is: grand-design two-armed spirals
   dominate, one- and five-armed disks are the oddities. */
export const ARM_COUNT_TABLE = [2, 2, 2, 2, 2, 3, 3, 4, 1, 5];

/* Peak of the r^1/4 law at its floor, so uGxGain means the same thing whatever
   the floor is set to. Host-side because the floor is a live dial. */
export function devNormFor(devFloor) {
  return 1 / Math.exp(DEV_K * (Math.max(devFloor, 1e-4) ** 0.25 - 1));
}

export const GALAXY_DEFAULTS = {
  field: true,
  showpiece: true,
  look: { shell: false, ring: false, spokes: false, polar: false },

  fieldCells: 5.0,
  fieldDensity: 0.1,
  fieldRadius: 0.13,
  fieldFlat: 0.16,
  fieldFeather: 0.55,
  fieldCoreFall: 5.5,
  fieldDiskFall: 2.2,
  fieldCoreAmt: 1.1,
  fieldCoreR: 0.55,
  fieldCore: [1.0, 0.8, 0.58],
  fieldDisk: [0.62, 0.74, 1.0],
  fieldLaneAt: 0.3,
  fieldLaneW: 0.42,
  fieldLaneDepth: 0.55,
  fieldLum: 0.03,

  cluster: 0.0,
  clusterPeak: 6.0,
  clusterR: 0.45,
  clusterAt: [0.5, 0.5],
  zLo: 0.2,
  zHi: 3.0,
  zSize: 0.0,
  zDim: 0.0,
  zTint: 0.0,
  ramp: [...Z_RAMPS.hubble],

  center: [0.72, 0.34],
  size: 0.16,
  cosI: 0.42,
  pa: 0.55,
  wind: 3.0,
  phase: 0.0,
  spin: 0.001534, /* 2*PI/4096, rounded onto the studio's slider grid */
  armCount: 2.0,
  armAsym: 0.0,
  armAmt: 0.85,
  armSharp: 1.6,
  barAmt: 0.0,
  barLen: 0.45,
  barSharp: 3.0,
  granFreq: 200.0,
  granBright: 0.55,
  granDark: 0.2,
  granTh: 0.7,
  motFreq: 3.2,
  motAmt: 0.45,
  morphRate: 0.03,
  bulgeR: 0.16,
  bulgeBeta: 1.5,
  bulgeAmt: 1.6,
  diskFall: 3.2,
  lanePhase: 0.55,
  laneSharp: 2.4,
  laneDepth: 0.45,
  nearSide: 1.0,
  nearSoft: 0.45,
  cutIn: 1.15,
  cutOut: 1.75,
  bulge: [1.0, 0.78, 0.5],
  disk: [0.6, 0.74, 1.0],
  tintLo: 0.18,
  tintHi: 0.62,
  /* Rides the bulge+disk+grit(+bar) divisor in spiralGalaxy: widening that sum
     dimmed the default spiral, and this is the compensating scale. */
  gain: 0.17,

  hii: 0.3,
  hiiFreq: 24.0,
  hiiTh: 0.62,
  hiiOiii: 0.25,
  hiiSii: 0.08,

  flowerGain: 0.9,
  flowerTh: 0.78,
  flowerSoft: 0.12,
  flowerLo: 0.25,
  flowerHi: 0.7,
  flowerTint: [1.0, 0.24, 0.1],

  devRe: 0.55,
  devFloor: 0.04,
  shellAmt: 0.5,
  shellFreq: 9.0,
  shellPhase: 0.0,
  shellSharp: 10.0,
  shellIn: 0.35,
  shellFall: 1.1,
  shellCut: 0.3,
  shellRot: 0.4,
  shellTint: [0.78, 0.86, 1.0],

  ringR: 0.78,
  ringW: 0.09,
  ringAmt: 1.0,
  ring: [0.55, 0.78, 1.0],
  knotFreq: 9.0,
  knotAmt: 0.65,

  spokeAmt: 0.35,
  spokeFreq: 7.0,
  spokeAniso: 0.35,
  spokeTh: 0.52,
  spokeIn: 0.22,

  polarAmt: 0.8,
  polarPa: 1.5708,
  polarCosI: 0.25,
  polarR: 0.8,
  polarW: 0.09,
};
