/* Background galaxies: a deep field of small smudges plus one optional
   showpiece in spiral, shell-elliptical, or ring morphology. Starlight is
   continuum; only the HII knots strung along arms and rings reach the line RT. */

import {
  Fn, float, vec2, vec3, clamp, cos, exp, floor, fract, length,
  max, mix, pow, sin, smoothstep, step,
} from 'three/tsl';
import { hash1, hash3, fbm3o2, FBM2_NORM } from './noise.js';
import { rot2, sdEllipse, sdfEnvelope, remapRange } from './sdf.js';

const TAU = Math.PI * 2;
const INV_TAU = 1 / TAU;
/* de Vaucouleurs r^1/4 law: I ∝ exp(-7.669 * ((r/re)^0.25 - 1)) */
const DEV_K = -7.669;

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

// Showpiece tier

/* cos/sin of m*theta from a unit direction by angle addition, blending m=2 into
   m=3. No atan, so the spiral phase has no branch cut to tear along. */
const angleM = /*@__PURE__*/ Fn(([dir, blend]) => {
  const c2 = dir.x.mul(dir.x).sub(dir.y.mul(dir.y)).toVar();
  const s2 = dir.x.mul(dir.y).mul(2.0).toVar();
  const c3 = c2.mul(dir.x).sub(s2.mul(dir.y));
  const s3 = s2.mul(dir.x).add(c2.mul(dir.y));
  /* Intermediate blends shorten the vector where 2θ and 3θ disagree, giving
     two strong arms and one weak one: a real morphology, not an artifact. */
  return vec2(mix(c2, c3, blend), mix(s2, s3, blend));
});

/* Exponential wings never reach zero; without a cut a disk leaves a faint box
   across the frame. Taken per radius so a polar ring is not clipped by the host. */
function extentCut(U, r) {
  return float(1).sub(smoothstep(U.uGxCutIn, U.uGxCutOut.max(U.uGxCutIn.add(1e-3)), r));
}

/* Pink beads strung along whatever structure carries the young stars. One
   noise field, thresholded, so the knots cluster instead of dusting evenly. */
function hiiLine(U, host, knotN) {
  const beads = smoothstep(U.uGxHiiTh, U.uGxHiiTh.add(0.18), knotN).toVar();
  const ha = host.mul(beads).mul(U.uGxHii).toVar();
  return vec3(ha, ha.mul(U.uGxHiiOiii), ha.mul(U.uGxHiiSii));
}

/* Grand-design spiral: logarithmic arms over a Moffat bulge, dust lane on the
   near half. uGxArmAmt at 0 drops the arms and leaves a lenticular. */
function spiralGalaxy(U, pn, u, dir, wantLine) {
  /* Logarithmic spiral: constant pitch puts the phase on ln(r), tan(pitch) =
     m / uGxWind. Default spin is 2*PI/4096, one turn per uTev wrap. */
  const A = u.max(1e-3).log().mul(U.uGxWind)
    .sub(U.uGxPhase).sub(U.uTev.mul(U.uGxSpin)).toVar();
  const ca = cos(A).toVar();
  const sa = sin(A).toVar();

  const m = angleM(dir, U.uGxArmBlend).toVar();
  const armCos = m.x.mul(ca).add(m.y.mul(sa)).toVar();
  const armSin = m.y.mul(ca).sub(m.x.mul(sa)).toVar();
  const arm = pow(armCos.mul(0.5).add(0.5).max(1e-4), U.uGxArmSharp.max(0.0)).toVar();

  /* Disk-frame noise: the arm pattern rotates through material that stays put,
     which is what a density wave actually does. */
  const mot = fbm3o2(vec3(pn.mul(U.uGxMotFreq), U.uTev.mul(U.uGxMorph)).add(U.uGxOff)).toVar();
  const armK = clamp(
    remapRange(arm, mot.mul(U.uGxMotAmt), float(1.0), float(0.0), float(1.0)), 0.0, 1.0,
  ).toVar();
  const armF = mix(float(1.0), armK, U.uGxArmAmt).toVar();

  const rb = U.uGxBulgeR.max(1e-3).toVar();
  /* Moffat bulge rather than de Vaucouleurs: bounded at the center, so nothing
     needs clamping ahead of the compose stretch. */
  const bulge = pow(u.mul(u).div(rb.mul(rb)).add(1.0), U.uGxBulgeBeta.max(0.5).negate())
    .mul(U.uGxBulgeAmt).toVar();
  const disk = exp(u.mul(U.uGxDiskFall).negate()).mul(armF).toVar();

  /* The lane trails the arms by a fixed phase and only shows on the near half
     of the disk, where the dust sits in front of the light. */
  const laneCos = armCos.mul(cos(U.uGxLanePhase)).add(armSin.mul(sin(U.uGxLanePhase)));
  const near = smoothstep(U.uGxNearSoft.max(1e-3).negate(), U.uGxNearSoft.max(1e-3),
    dir.y.mul(U.uGxNearSide));
  const lane = pow(laneCos.mul(0.5).add(0.5).max(1e-4), U.uGxLaneSharp.max(0.0))
    .mul(near).mul(U.uGxLaneDepth).toVar();

  const lum = bulge.add(disk).toVar();
  const n = lum.div(U.uGxBulgeAmt.add(1.0).max(1.0)).toVar();
  const carved = clamp(remapRange(n, lane, float(1.0), float(0.0), float(1.0)), 0.0, 1.0);

  const cut = extentCut(U, u).toVar();

  /* Tint by which component dominates, so the arms stay blue right up against
     a warm bulge instead of the whole inner disk going yellow. */
  const w = bulge.div(lum.max(1e-3));
  const tintHi = U.uGxTintHi.max(U.uGxTintLo.add(1e-3));
  const tint = mix(U.uGxDisk, U.uGxBulge, smoothstep(U.uGxTintLo, tintHi, w));

  const out = { cont: tint.mul(carved).mul(cut).mul(U.uGxGain) };
  /* The knot noise is only built for the line pass; leaving it in the continuum
     body would emit a whole dead fbm there. */
  if (wantLine) {
    const knotN = fbm3o2(vec3(pn.mul(U.uGxHiiFreq), U.uTev.mul(U.uGxMorph)).add(U.uGxOff.mul(7.0)))
      .mul(FBM2_NORM).toVar();
    /* Scaled by uGxArmAmt too: a lenticular has no arms, so it must not keep
       stringing HII regions along the spiral pattern nothing else can see. */
    out.line = hiiLine(U, armK.mul(disk).mul(cut).mul(U.uGxArmAmt), knotN);
  }
  return out;
}

/* NGC 3923 class: a de Vaucouleurs elliptical wearing nested merger shells.
   Consecutive shells fall on opposite sides, which is the detail that sells it. */
function shellGalaxy(U, u, dir) {
  /* The r^1/4 law is singular at the center; the floor bounds it and uGxDevNorm
     (its matching reciprocal peak, computed host-side) renormalizes to 1. */
  const x = u.div(U.uGxDevRe.max(1e-3)).max(U.uGxDevFloor.max(1e-4)).toVar();
  const dev = exp(pow(x, 0.25).sub(1.0).mul(DEV_K))
    .mul(U.uGxDevNorm).mul(U.uGxBulgeAmt).toVar();

  const sPhase = u.mul(U.uGxShellFreq).add(U.uGxShellPhase).toVar();
  const crest = pow(cos(sPhase).mul(0.5).add(0.5).max(1e-4), U.uGxShellSharp.max(0.0)).toVar();
  /* Shell index parity as ±1, from fract rather than a modulo: fract(x) is
     x - floor(x) on every backend, so negative indices alternate correctly too. */
  const side = fract(floor(sPhase.mul(INV_TAU).add(0.5)).mul(0.5)).mul(4.0).sub(1.0).toVar();
  const axisDir = rot2(dir, U.uGxShellRot.negate()).toVar();
  /* Each shell takes the half-plane its parity points at, tapered over uGxShellCut.
     The half-turn offset above flips parity at troughs, so no arc splits its crest. */
  const sideMask = smoothstep(float(0.0), U.uGxShellCut.max(1e-3), axisDir.x.mul(side)).toVar();

  const amp = smoothstep(float(0.0), U.uGxShellIn.max(1e-3), u)
    .mul(exp(u.mul(U.uGxShellFall).negate())).toVar();
  const shells = crest.mul(sideMask).mul(amp).mul(U.uGxShellAmt).toVar();

  const cont = U.uGxBulge.mul(dev).add(U.uGxShellTint.mul(shells))
    .mul(extentCut(U, u)).mul(U.uGxGain);
  return { cont };
}

/* Hoag's Object, the Cartwheel, and NGC 660: a detached ring of hot blue stars
   around a Sersic nucleus, with an empty gap the disk never fills. */
function ringGalaxy(sky, U, u, dir, look, wantLine) {
  const rb = U.uGxBulgeR.max(1e-3).toVar();
  const nucleus = pow(u.mul(u).div(rb.mul(rb)).add(1.0), U.uGxBulgeBeta.max(0.5).negate())
    .mul(U.uGxBulgeAmt).toVar();

  const ringW = U.uGxRingW.max(1e-4).toVar();
  const dr = u.sub(U.uGxRingR).div(ringW).toVar();
  const band = exp(dr.mul(dr).negate()).toVar();

  /* Noise sampled on the unit direction circle is seamless all the way round,
     with no atan and therefore no branch cut to tear the beading along. Radius
     rides the third axis or the beads have no radial extent and comb the ring. */
  const knotN = fbm3o2(vec3(
    dir.mul(U.uGxKnotFreq),
    u.mul(U.uGxKnotFreq).add(U.uTev.mul(U.uGxMorph)),
  ).add(U.uGxOff)).mul(FBM2_NORM).toVar();
  const beads = mix(float(1).sub(U.uGxKnotAmt), float(1.0), smoothstep(0.32, 0.72, knotN)).toVar();
  const ring = band.mul(beads).mul(U.uGxRingAmt).toVar();

  const cont = U.uGxBulge.mul(nucleus).add(U.uGxRing.mul(ring)).toVar();

  if (look.spokes) {
    /* Radius enters the noise domain slowly, so the field varies fast around
       the ring and barely along it: streaks that read as radial spokes. */
    const spN = fbm3o2(vec3(dir.mul(U.uGxSpokeFreq), u.mul(U.uGxSpokeAniso)).add(U.uGxOff.mul(3.0)))
      .mul(FBM2_NORM).toVar();
    const inner = smoothstep(U.uGxSpokeIn, U.uGxSpokeIn.add(0.06), u)
      .mul(float(1).sub(smoothstep(U.uGxRingR.sub(ringW), U.uGxRingR, u))).toVar();
    const spokes = smoothstep(U.uGxSpokeTh, U.uGxSpokeTh.add(0.22), spN)
      .mul(inner).mul(U.uGxSpokeAmt).toVar();
    cont.addAssign(U.uGxRing.mul(spokes));
  }

  const edge = extentCut(U, u).toVar();
  cont.mulAssign(edge);

  if (look.polar) {
    /* The same ring primitive on a second disk plane: two galaxies crossed at
       right angles is the entire polar-ring read. */
    const qp = rot2(sky.sub(U.uGxCenter), U.uGxPa.add(U.uGxPolarPa).negate()).toVar();
    const pp = vec2(qp.x, qp.y.div(U.uGxPolarCosI.max(0.06))).div(U.uGxSize.max(1e-4)).toVar();
    const up = length(pp).max(1e-4).toVar();
    const pd = up.sub(U.uGxPolarR).div(U.uGxPolarW.max(1e-4)).toVar();
    const pring = exp(pd.mul(pd).negate()).mul(U.uGxPolarAmt).mul(extentCut(U, up)).toVar();
    cont.addAssign(U.uGxRing.mul(pring));
  }

  const out = { cont: cont.mul(U.uGxGain) };
  if (wantLine) out.line = hiiLine(U, band.mul(edge).mul(U.uGxRingAmt), knotN);
  return out;
}

/* One showpiece at a uniform-specified pose. Morphology is a build-time branch,
   so a scene only ever compiles the silhouette it asked for. */
export function showpieceGalaxy(sky, U, look = {}, wantLine = false) {
  /* Deproject: rotate into the major-axis frame, then stretch the minor axis
     back out. Orthographic is exact enough for an object this distant. */
  const q = rot2(sky.sub(U.uGxCenter), U.uGxPa.negate()).toVar();
  const pn = vec2(q.x, q.y.div(U.uGxCosI.max(0.06))).div(U.uGxSize.max(1e-4)).toVar();
  const u = length(pn).max(1e-4).toVar();
  const dir = pn.div(u).toVar();

  if (look.ring) return ringGalaxy(sky, U, u, dir, look, wantLine);
  if (look.shell) return shellGalaxy(U, u, dir);
  return spiralGalaxy(U, pn, u, dir, wantLine);
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
  armBlend: 0.0,
  armAmt: 0.85,
  armSharp: 1.6,
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
  gain: 0.14,

  hii: 0.3,
  hiiFreq: 24.0,
  hiiTh: 0.62,
  hiiOiii: 0.25,
  hiiSii: 0.08,

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
