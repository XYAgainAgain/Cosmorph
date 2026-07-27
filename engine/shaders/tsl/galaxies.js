/* Background galaxies: a sparse field of faint smudges plus one optional
   showpiece spiral. Continuum RGB only — galaxy light is broadband starlight
   and must never reach the narrowband palette. */

import {
  Fn, float, vec2, vec3, clamp, cos, exp, floor, fract, length,
  max, mix, pow, sin, smoothstep, step,
} from 'three/tsl';
import { hash3, fbm3o2 } from './noise.js';
import { rot2, sdEllipse, sdfEnvelope, remapRange } from './sdf.js';

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

      const present = step(h1.z, U.uGxfDensity).toVar();
      /* h1.z is the occupancy roll, and among surviving cells it is still
         uniform on [0, density) — a free brightness variate, no extra hash. */
      const rel = h1.z.div(U.uGxfDensity.max(1e-4)).toVar();

      /* uGxfRadius is in CELL units (d lives in cell space), unlike every other
         radius in the engine; above ~0.45 the 3x3 search clips the ellipse. */
      const ra = U.uGxfRadius.mul(mix(0.55, 1.6, h2.x)).max(1e-4).toVar();
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

      const tint = mix(U.uGxfCore, U.uGxfDisk, smoothstep(float(0.0), U.uGxfCoreR.max(1e-3), u));
      const L = mix(0.3, 1.0, rel.mul(rel)).mul(U.uGxfLum);
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

/* One inclined spiral at a uniform-specified pose. uGxArmAmt at 0 drops the
   arms entirely and leaves a lenticular. */
export function showpieceGalaxy(sky, U) {
  /* Deproject: rotate into the major-axis frame, then stretch the minor axis
     back out. Orthographic is exact enough for an object this distant. */
  const q = rot2(sky.sub(U.uGxCenter), U.uGxPa.negate()).toVar();
  const pn = vec2(q.x, q.y.div(U.uGxCosI.max(0.06))).div(U.uGxSize.max(1e-4)).toVar();
  const u = length(pn).max(1e-4).toVar();
  const dir = pn.div(u).toVar();

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
  );
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

  /* Exponential wings never reach zero; without a cut the disk leaves a faint
     box across the frame. */
  const cut = float(1).sub(smoothstep(U.uGxCutIn, U.uGxCutOut.max(U.uGxCutIn.add(1e-3)), u));

  /* Tint by which component dominates, so the arms stay blue right up against
     a warm bulge instead of the whole inner disk going yellow. */
  const w = bulge.div(lum.max(1e-3));
  const tintHi = U.uGxTintHi.max(U.uGxTintLo.add(1e-3));
  const tint = mix(U.uGxDisk, U.uGxBulge, smoothstep(U.uGxTintLo, tintHi, w));
  return tint.mul(carved).mul(cut).mul(U.uGxGain);
}

/* Both tiers land on the continuum RT once a host wires this in; tiers must run
   inside an Fn body, and skipping showpiece means creating no uGx* uniforms. */
export function buildGalaxyNodes(skyU, U, { showpiece = false } = {}) {
  const continuum = Fn(() => {
    const field = fieldGalaxies(skyU, U);
    return showpiece ? field.add(showpieceGalaxy(skyU, U)) : field;
  })();

  return { continuum };
}

export const GALAXY_DEFAULTS = {
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

  center: [0.72, 0.34],
  size: 0.16,
  cosI: 0.42,
  pa: 0.55,
  wind: 3.0,
  phase: 0.0,
  spin: 0.001533981, /* 2*PI / 4096 */
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
};
