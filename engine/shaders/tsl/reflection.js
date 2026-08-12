/* Reflection nebula: starlight scattered off dust. The glow is continuum RGB
   (scattered light carries no line signature); the shock filaments are Hα. */

import { Fn, float, vec2, vec3, cos, sin, dot, mix, pow, smoothstep } from 'three/tsl';
import { fbm3o4, ridged2, FBM4_NORM } from './noise.js';
import { rot2 } from './sdf.js';

/* Independent slices of the noise domain, so the fields never correlate */
const FIL_DOMAIN = /*@__PURE__*/ vec3(7.3, 2.1, 4.7);
const LANE_DOMAIN = /*@__PURE__*/ vec3(11.9, 27.3, 3.7);

/* The dust the glow lives in. Four octaves rather than two: at two the coverage
   threshold cuts the base lattice into visible polygons across a 2560px frame. */
function dustField(sky, U) {
  const p = vec3(sky.mul(U.uReflFreq), U.uTev.mul(U.uReflMorph)).add(U.uReflOff);
  return fbm3o4(p).mul(FBM4_NORM);
}

/* Ascending edge: hi must clear lo or the coverage smoothstep collapses */
function dustHiOf(U) {
  return U.uReflDustHi.max(U.uReflDustLo.add(1e-3));
}

/* Per-channel scatter profile in (0,1]. Blue gets the widest, shallowest
   falloff because sub-micron dust scatters short wavelengths best. */
function scatterShape(d2, U) {
  const rad2 = U.uReflRadius.mul(U.uReflRadius).max(1e-4);
  const base = vec3(d2).div(rad2).add(1.0); // >= 1, so the pow is always defined
  return pow(base, U.uReflFalloff.max(0.05).negate());
}

/* Lopsidedness in [0,1]: a ramp away from the star, since nothing in the Iris or
   the Witch Head is radially symmetric. uReflAsym at 0 restores the round ball. */
function asymMask(sky, U) {
  const dir = vec2(cos(U.uReflAsymAngle), sin(U.uReflAsymAngle));
  const ramp = dot(sky.sub(U.uReflStar), dir).mul(U.uReflAsymFreq).mul(0.5).add(0.5).clamp(0.0, 1.0);
  /* Expanded past 1 before clamping so the bright flank saturates rather than
     leaving the whole cloud at half coverage */
  const skew = ramp.mul(1.8).min(1.0);
  return mix(float(1.0), skew, U.uReflAsym.clamp(0.0, 1.0)).toVar();
}

/* Dark dust intrusions: ridged crests in a stretched domain read as sinuous lanes,
   and the same field thickens tau, so a lane also reddens what lies behind it. */
function laneCut(sky, U) {
  /* Its own angle, not the striae comb's: the Iris and the Witch Head both cut
     their lanes across the striae rather than along them. */
  const q = rot2(sky, U.uReflLaneAngle.negate()).toVar();
  const p = vec3(
    q.x.mul(U.uReflLaneFreq),
    q.y.mul(U.uReflLaneFreq).mul(0.35),
    U.uTev.mul(U.uReflMorph),
  ).add(U.uReflOff).add(LANE_DOMAIN);
  return smoothstep(U.uReflLaneTh, 1.0, ridged2(p, U.uReflLaneSharp)).mul(U.uReflLane).toVar();
}

/* Striae: a linear comb sweeping obliquely past the star. Radial spokes read as
   a starburst; Merope's striae are near-parallel streaks. */
function striae(sky, U) {
  const q = rot2(sky.sub(U.uReflStar), U.uReflFilAngle.negate()).toVar();
  const p = vec3(
    q.x.mul(U.uReflFilFreq),
    q.y.mul(U.uReflFilFreq).mul(U.uReflFilAniso.max(1e-3)),
    U.uTev.mul(U.uReflMorph),
  ).add(U.uReflOff).add(FIL_DOMAIN);
  return ridged2(p, U.uReflFilSharp).toVar();
}

/* Dust coverage. Every structural term enters as a threshold shift (remap
   doctrine, sdf.js); only the floor is a plain scale. */
function dustCover(sky, shapeG, comb, U) {
  const asym = asymMask(sky, U);
  const lane = laneCut(sky, U);
  const span = dustHiOf(U).sub(U.uReflDustLo).toVar();
  const lo = U.uReflDustLo.add(float(1).sub(asym).mul(U.uReflAsymBite)).toVar();

  const field = dustField(sky, U)
    .add(shapeG.mul(U.uReflCarve.max(0.05)))
    .add(comb.mul(U.uReflStriae))
    .sub(lane);
  const lit = smoothstep(lo, lo.add(span), field);
  return mix(U.uReflFloor.mul(asym), 1.0, lit);
}

export function buildReflectionNodes(skyU, U) {
  const continuum = Fn(() => {
    const d = skyU.sub(U.uReflStar).toVar();
    const d2 = dot(d, d).toVar();
    const rr = d2.max(1e-12).sqrt().toVar();

    const shape = scatterShape(d2, U).toVar();
    const cover = dustCover(skyU, shape.g, striae(skyU, U), U).toVar();

    const warm = float(1).sub(smoothstep(0.0, U.uReflWarmR.max(1e-3), rr));
    /* Past 1 the mix extrapolates blue negative into the shared continuum RT */
    const tint = mix(U.uReflTint, U.uReflWarm, warm.mul(U.uReflWarmAmt.clamp(0.0, 1.0)));

    /* Ambient floor: without it an illuminator parked off-frame (the Witch Head)
       leaves the cloud unlit. Same wide radius as tau, so it lights a cloud. */
    const spread = U.uReflRadius.z.mul(U.uReflRadius.z).mul(U.uReflTauSpread).max(1e-4);
    const wide = float(1).div(d2.div(spread).add(1.0)).toVar();
    const glow = shape.add(wide.mul(U.uReflAmbient)).toVar();
    return glow.mul(U.uReflLum).mul(tint).mul(cover);
  })();

  /* Filaments are shocked gas, not scattered light, so they belong on the line
     path even though they ride the reflection cloud's own illumination. */
  const line = Fn(() => {
    const d = skyU.sub(U.uReflStar).toVar();
    const d2 = dot(d, d).toVar();
    const rr = d2.max(1e-12).sqrt().toVar();

    const shape = scatterShape(d2, U).toVar();
    const comb = striae(skyU, U);
    const cover = dustCover(skyU, shape.g, comb, U).toVar();

    const filIn = U.uReflFilIn.max(1e-3);
    const filOut = U.uReflFilOut.max(filIn.add(1e-3));
    const filMask = smoothstep(0.0, filIn, rr).mul(float(1).sub(smoothstep(filIn, filOut, rr)));

    const fil = comb.mul(filMask).mul(cover).mul(shape.g).mul(U.uReflFilAmp);
    return vec3(fil.mul(U.uReflFilHa), 0.0, 0.0);
  })();

  return { continuum, line };
}

/* Faint extinction from the same dust; same tau convention as dust.js */
export function reflectionTau(skyW, U) {
  const d = skyW.sub(U.uReflStar);
  const d2 = dot(d, d);
  const blue2 = U.uReflRadius.z.mul(U.uReflRadius.z);
  const spread = blue2.mul(U.uReflTauSpread).max(1e-4);
  const env = float(1).div(d2.div(spread).add(1.0));
  const base = smoothstep(U.uReflDustLo, dustHiOf(U), dustField(skyW, U));
  return base.add(laneCut(skyW, U)).min(1.0).mul(env).mul(U.uReflTau);
}

/* Param block in the host's units (vectors as arrays), not uniform nodes.
   Keys match the uniform suffixes one-for-one. */
export const REFLECTION_DEFAULTS = {
  star: [0.42, 0.58],
  lum: 0.9,
  radius: [0.26, 0.32, 0.42],
  falloff: [1.5, 1.32, 1.08],
  tint: [0.55, 0.78, 1.0],
  warm: [1.0, 0.64, 0.58],
  warmR: 0.14,
  warmAmt: 0.55,
  ambient: 0.08,
  freq: 4.2,
  morph: 0.06,
  dustLo: 0.45,
  dustHi: 0.83,
  carve: 0.3,
  floor: 0.15,
  asym: 0.8,
  asymFreq: 1.1,
  asymAngle: 0.9,
  asymBite: 0.42,
  lane: 0.45,
  laneFreq: 7.0,
  laneAngle: 1.65,
  laneTh: 0.5,
  laneSharp: 3.0,
  striae: 0.3,
  filFreq: 11.0,
  filAniso: 0.09,
  filAngle: 0.55,
  filIn: 0.05,
  filOut: 0.7,
  filSharp: 2.5,
  filAmp: 0.5,
  filHa: 0.35,
  tau: 0.7,
  tauSpread: 4.0,
};
