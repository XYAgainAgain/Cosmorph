/* Cone-gated ionization cloud, Hanny's Voorwerp class: a knotty near-pure OIII
   cloud with a hole punched through it, glowing only inside a cone thrown from
   a free-standing apex. Line channels only, never RGB. */

import {
  Fn, float, vec2, vec3, cos, dot, length, max, mix, sin, smoothstep,
} from 'three/tsl';
import { fbm3o2, ridged4, FBM2_NORM, CELL_BIAS } from './noise.js';
import { rot2, sdCircle, sdEllipse, sdfEnvelope } from './sdf.js';

/* Everything shaped is measured in cloud radii, so resizing the cloud never
   re-tunes the lace frequency, the raggedness, or the hole. */
export function buildIonCloudNodes(skyU, U, opts = {}) {
  const blobLook = opts.blob === true;

  const line = Fn(() => {
    const zEvo = U.uTev.mul(U.uIonMorph).toVar();

    const size = U.uIonSize.max(1e-3).toVar();
    const q = rot2(skyU.sub(U.uIonCenter), U.uIonRot.negate()).toVar();
    const rx = size.toVar();
    const ry = size.mul(U.uIonSquash.max(0.05)).toVar();
    const rNorm = length(vec2(q.x.div(rx), q.y.div(ry))).toVar();

    /* Normalized by the cloud, offset into this instance's integer slice; the
       bias keeps lattice coords positive (negative→uint is undefined on GLES). */
    const qn = q.div(size).toVar();
    const clump = fbm3o2(vec3(qn.mul(U.uIonClumpFreq), zEvo.mul(0.5))
      .add(U.uIonOff.mul(3.0)).add(CELL_BIAS)).mul(FBM2_NORM).toVar();

    const warp = fbm3o2(vec3(qn.mul(U.uIonRagFreq), zEvo).add(U.uIonOff).add(CELL_BIAS))
      .mul(FBM2_NORM).sub(0.5).mul(2.0).mul(U.uIonRagged.mul(size)).toVar();

    const dCloud = sdEllipse(q, vec2(0.0), vec2(rx, ry)).add(warp).toVar();
    const dHole = sdCircle(q, U.uIonHoleAt.mul(size), U.uIonHoleR.mul(size)).add(warp).toVar();

    /* sdEllipse degenerates to 0 exactly at the center; the interior is solid
       anyway, so floor the envelope there rather than trust it. */
    const envC = max(
      sdfEnvelope(dCloud, U.uIonFeather.mul(size)),
      float(1).sub(smoothstep(0.15, 0.35, rNorm)),
    ).toVar();
    /* The hole is a second authored boundary, not noise, so it multiplies: that
       is what keeps its rim hard while the cloud edge stays ragged. */
    const hs = U.uIonHoleSoft.max(1e-4).toVar();
    const envH = smoothstep(hs.negate(), hs, dHole);
    const env = envC.mul(envH).toVar();

    /* Ionization cone. The apex is a free position, not the illuminator's: an
       echo cone arrives from wherever the source was when the light left. */
    const v = skyU.sub(U.uIonApex).toVar();
    const rLit = length(v).max(1e-4).toVar();

    /* Cosine off the cone axis, never atan: no branch cut, and cos stays
       monotone below PI/2 so the smoothstep edges ascend. */
    const cosA = dot(v.div(rLit), vec2(cos(U.uIonCone), sin(U.uIonCone))).toVar();
    const cosIn = cos(U.uIonHalf.min(1.5)).toVar();
    const cosOut = cos(U.uIonHalf.add(U.uIonConeSoft).min(1.55)).min(cosIn.sub(1e-4));
    const ext = smoothstep(cosOut, cosIn, cosA).toVar();

    /* Ionizing flux dilutes with distance; base >= 1 keeps the pow defined */
    const fall = rLit.div(U.uIonLitR.max(1e-3)).add(1.0)
      .pow(U.uIonFall.max(0.0).negate()).toVar();

    const envL = env.mul(ext).toVar();

    let dens;
    if (blobLook) {
      /* Lyman-alpha blob: no lace at all, just the envelope. `shade` below is the
         only clump term, so the surface stays near-featureless. */
      dens = envL.mul(envL).toVar();
    } else {
      const lace = ridged4(vec3(qn.mul(U.uIonFreq), zEvo).add(U.uIonOff.mul(7.0)).add(CELL_BIAS),
        U.uIonSharp).toVar();
      /* Envelope lowers the threshold the lace must clear (remap doctrine,
         sdf.js); the clump field wanders it so the cloud breaks into knots. */
      const thBase = U.uIonTh.add(clump.sub(0.5).mul(U.uIonClump)).toVar();
      const th = mix(float(1.0), thBase, envL).toVar();
      dens = smoothstep(th, th.add(U.uIonSoft.max(1e-3)), lace).toVar();
    }

    /* Shade and glow both enter as amplitude, never as a threshold, so no carved
       boundary moves: a thinner patch of gas is simply fainter. */
    const shade = mix(float(1).sub(U.uIonShade.clamp(0.0, 1.0)), float(1.0), clump).toVar();
    const body = dens.add(envL.mul(envL).mul(U.uIonGlow))
      .mul(shade).mul(fall).mul(U.uIonGain).toVar();
    /* Hα rides dens² only: the warm beads in an ionized tidal tail are the
       star-forming knots, not the bulk, which is OIII to a rounding error. */
    const ha = dens.mul(dens).mul(shade).mul(fall).mul(U.uIonGain).mul(U.uIonHa);
    return vec3(ha, body.mul(U.uIonOiii), body.mul(U.uIonSii));
  })();

  return { line };
}

/* Param block in the host's units (vectors as arrays). Keys map to uniform
   suffixes except threshold → Th and morphRate → Morph, as in filaments.
   `blob` is a build-time flag, not a uniform. */
export const ION_CLOUD_DEFAULTS = {
  center: [0.5, 0.58],
  rot: -0.35,
  size: 0.18,
  squash: 0.8,
  ragged: 0.34,
  ragFreq: 1.9,
  feather: 0.16,
  holeAt: [-0.14, -0.3],
  holeR: 0.3,
  holeSoft: 0.006,
  freq: 13.0,
  sharp: 2.2,
  threshold: 0.55,
  /* Wide on purpose: a narrow ramp saturates every thread to the same value and
     the cloud reads as flat paint instead of gas of varying column density. */
  softness: 0.36,
  clump: 0.5,
  clumpFreq: 3.0,
  shade: 0.7,
  glow: 0.05,
  blob: false,
  /* Sky y grows downward, so an apex above the cloud lights it from above, which
     is the only arrangement the reference photography ever shows. */
  apex: [0.62, 0.18],
  cone: 2.04,
  half: 0.3,
  coneSoft: 0.045,
  litR: 0.34,
  fall: 1.3,
  gain: 1.35,
  ha: 0.16,
  oiii: 1.0,
  sii: 0.0,
  morphRate: 0.03,
};
