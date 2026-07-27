/* Reflection nebula: starlight scattered off dust. The glow is continuum RGB
   (scattered light carries no line signature); the shock filaments are Hα. */

import { Fn, float, vec3, dot, mix, pow, smoothstep } from 'three/tsl';
import { fbm3o2, makeRidged } from './noise.js';

/* Offset into an independent slice of the noise domain for the filaments */
const FIL_DOMAIN = vec3(7.3, 2.1, 4.7);

const ridged4 = /*@__PURE__*/ makeRidged(4);

/* The dust the glow lives in. Deliberately low frequency: a radially
   symmetric halo reads as a lens artifact, not as an illuminated cloud. */
function dustField(sky, U) {
  const p = vec3(sky.mul(U.uReflFreq), U.uTev.mul(U.uReflMorph)).add(U.uReflOff);
  return fbm3o2(p);
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

/* Dust coverage with its threshold biased by the illumination profile, so the
   lit boundary bulges toward the star instead of being painted over the cloud. */
function dustCover(sky, shapeG, U) {
  /* At carve 0 the profile drops out and the cloud is shape times noise */
  const carve = U.uReflCarve.max(0.05);
  const lit = smoothstep(U.uReflDustLo, dustHiOf(U), dustField(sky, U).add(shapeG.mul(carve)));
  return mix(U.uReflFloor, 1.0, lit);
}

export function buildReflectionNodes(skyU, U) {
  const continuum = Fn(() => {
    const d = skyU.sub(U.uReflStar).toVar('rd');
    const d2 = dot(d, d).toVar('rd2');
    const rr = d2.max(1e-12).sqrt().toVar('rr');

    const shape = scatterShape(d2, U).toVar('reflShape');
    const cover = dustCover(skyU, shape.g, U).toVar('reflCover');

    const warm = float(1).sub(smoothstep(0.0, U.uReflWarmR.max(1e-3), rr));
    const tint = mix(U.uReflTint, U.uReflWarm, warm.mul(U.uReflWarmAmt));
    return shape.mul(U.uReflLum).mul(tint).mul(cover);
  })();

  /* Filaments are shocked gas, not scattered light, so they belong on the line
     path even though they ride the reflection cloud's own illumination. */
  const line = Fn(() => {
    const d = skyU.sub(U.uReflStar).toVar('fd');
    const d2 = dot(d, d).toVar('fd2');
    const rr = d2.max(1e-12).sqrt().toVar('fr');

    const shape = scatterShape(d2, U).toVar('filShape');
    const cover = dustCover(skyU, shape.g, U).toVar('filCover');

    /* Radial combing: unit direction on two axes, radius on the third. Seam-free
       because the circle is continuous, and the anisotropy is the whole trick. */
    const dir = d.div(rr);
    const pf = vec3(dir.mul(U.uReflFilFreq), rr.mul(U.uReflFilFreq).mul(U.uReflFilAniso))
      .add(U.uReflOff).add(FIL_DOMAIN)
      .add(vec3(0.0, 0.0, U.uTev.mul(U.uReflMorph)));
    const ridge = ridged4(pf, U.uReflFilSharp).toVar('filRidge');

    /* Direction is meaningless at the star itself; the inner mask edge hides it */
    const filIn = U.uReflFilIn.max(1e-3);
    const filOut = U.uReflFilOut.max(filIn.add(1e-3));
    const filMask = smoothstep(0.0, filIn, rr).mul(float(1).sub(smoothstep(filIn, filOut, rr)));

    const fil = ridge.mul(filMask).mul(cover).mul(shape.g).mul(U.uReflFilAmp);
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
  return smoothstep(U.uReflDustLo, dustHiOf(U), dustField(skyW, U)).mul(env).mul(U.uReflTau);
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
  freq: 2.1,
  morph: 0.06,
  dustLo: 0.34,
  dustHi: 0.62,
  carve: 0.3,
  floor: 0.28,
  filFreq: 7.0,
  filAniso: 0.35,
  filIn: 0.09,
  filOut: 0.34,
  filSharp: 3.0,
  filAmp: 0.5,
  filHa: 0.5,
  tau: 0.35,
  tauSpread: 4.0,
};
