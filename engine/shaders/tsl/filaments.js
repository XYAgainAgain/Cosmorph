/* Supernova-remnant shock filaments and the giant faint OIII arc. One shell
   envelope, ridged threads remapped through it, sitting in a diffuse haze.
   Line channels only, never RGB. */

import {
  Fn, float, vec2, vec3, dot, length, cos, sin, max, mix, smoothstep,
} from 'three/tsl';
import { fbm3o2, ridged2, batched, FBM2_NORM, FBM2_MID } from './noise.js';
import { rot2 } from './sdf.js';

/* Three ridged samples at non-harmonic ratios, blended by max rather than sum:
   crossing crests stay separate threads instead of pooling into a filled ribbon. */
const ribbonPoints = (p) => [
  p, p.mul(1.43).add(vec3(11.3, 4.7, 21.9)), p.mul(2.11).add(vec3(31.7, 17.1, 5.3)),
];
const ribbonBlend = (r1, r2, r3, braid) => mix(r1, max(r1, max(r2, r3)), braid.max(0.0).min(1.0));

/* Veil-style shock lacework and, at low gain with the ridging flattened, the
   giant faint OIII arc. Both are the same shell: only parameters differ. */
export function buildFilamentNodes(skyU, U) {
  const line = Fn((builder) => {
    const zEvo = U.uTev.mul(U.uFilMorph);

    /* Work in the shell's own frame: rotate, then squash one axis so the
       "circle" is an ellipse without the noise domain ever knowing. */
    const dR = rot2(skyU.sub(U.uArcCenter), U.uArcRot.negate()).toVar();
    const de = vec2(dR.x, dR.y.div(U.uArcSquash.max(0.05))).toVar();

    const rad = length(de).max(1e-4).toVar();
    const dirHat = de.div(rad).toVar();

    /* uTev's 4096 h wrap bounds expansion but also resets it: one visible
       shell snap every ~170 days, accepted. The cap keeps the domain sane. */
    const R = U.uArcRadius.add(U.uTev.mul(U.uArcExpand))
      .min(U.uArcRadius.mul(3.0)).max(1e-3).toVar();
    const invT = float(1).div(U.uArcThick.max(1e-4)).toVar();

    /* Angular extent via the direction dot product, not atan: no branch cut,
       and cos is monotone on [0,PI] so the smoothstep edges stay ascending. */
    const axis = vec2(cos(U.uArcPhase), sin(U.uArcPhase));
    const cosD = dot(dirHat, axis);
    const cosHalf = cos(U.uArcHalf.min(Math.PI)).toVar();
    const cosOut = cos(U.uArcHalf.add(U.uArcSoft).min(Math.PI)).min(cosHalf.sub(1e-4));
    const ext = smoothstep(cosOut, cosHalf, cosD).toVar();

    /* Noise domain rides the shell itself: xy trace a circle of radius R*kT,
       so the field is seamless all the way around with no polar unwrap. */
    const kT = U.uFilFreq;
    const kR = U.uFilFreq.mul(U.uFilAniso);
    const ring = dirHat.mul(R.mul(kT)).toVar();

    const dr = rad.sub(R).toVar();
    /* The four fields that need no warp go through one batch */
    const [sheetRaw, wRaw, kinkRaw, frayRaw] = batched(builder, fbm3o2, [
      vec3(ring.mul(U.uFilLaceF), zEvo.mul(0.4)).add(U.uFilOff.mul(5.0)),
      vec3(ring.mul(0.28), zEvo.mul(0.3)).add(U.uFilOff.mul(3.0)),
      vec3(ring.mul(1.1), zEvo.mul(0.6)).add(U.uFilOff.mul(11.0)),
      /* Own radial scale, or kR's top speckles it */
      vec3(ring.mul(U.uFilFrayF), dr.mul(U.uFilFrayF.mul(8.0)).add(zEvo.mul(0.7)))
        .add(U.uFilOff.mul(17.0)),
    ]);
    /* One field along the shell drives both the haze amplitude and which species
       leads, so color and glow stay in step around the arc. Its scale is dialed
       rather than fixed: too slow and the whole visible arc is one species. */
    const sheet = sheetRaw.mul(FBM2_NORM).toVar();

    /* Warp radially only: strands weaving in and out across the shell is what
       braids them, while a tangential warp would just slide the whole pattern. */
    const warp = wRaw.sub(FBM2_MID).mul(U.uFilWarp).toVar();
    /* A second warp four times faster kinks a thread along its length instead
       of sliding it, which is the difference between a ribbon and frayed rope. */
    const kink = kinkRaw.sub(FBM2_MID).mul(U.uFilKink).toVar();

    const sep = U.uFilSep.toVar();
    const drO = dr.sub(sep).toVar();
    const drH = dr.add(sep).toVar();

    /* Both species share one warped z, so they are the same threads displaced
       by 2*sep: the offset parallel strands of a real shock front. */
    const zW = warp.add(kink).add(zEvo).toVar();
    const pO = vec3(ring, drO.mul(kR).add(zW)).add(U.uFilOff).toVar();
    const pH = vec3(ring, drH.mul(kR).add(zW)).add(U.uFilOff).toVar();
    const ridges = batched(builder, (q) => ridged2(q, U.uFilSharp),
      [...ribbonPoints(pO), ...ribbonPoints(pH)]);
    const fO = ribbonBlend(ridges[0], ridges[1], ridges[2], U.uFilBraid).toVar();
    const fH = ribbonBlend(ridges[3], ridges[4], ridges[5], U.uFilBraid).toVar();

    const envO = float(1).sub(smoothstep(0.0, 1.0, drO.mul(invT).abs())).mul(ext).toVar();
    const envH = float(1).sub(smoothstep(0.0, 1.0, drH.mul(invT).abs())).mul(ext).toVar();

    /* Strand ends must fray, not stop where the mask stops: lifts the threshold
       only where the envelope fades. */
    const fray = frayRaw.mul(FBM2_NORM).mul(U.uFilFray).toVar();
    const eO = float(1).sub(envO).toVar();
    const eH = float(1).sub(envH).toVar();

    /* Envelope lowers the threshold the ridge must clear (remap doctrine, sdf.js) */
    const thO = mix(float(1.0), U.uFilTh, envO).add(fray.mul(eO).mul(eO).mul(eO));
    const thH = mix(float(1.0), U.uFilTh, envH).add(fray.mul(eH).mul(eH).mul(eH));
    const densO = smoothstep(thO, thO.add(U.uFilSoft.max(1e-3)), fO).toVar();
    const densH = smoothstep(thH, thH.add(U.uFilSoft.max(1e-3)), fH).toVar();

    /* A shell is bright only where its sheet folds toward edge-on, or the arc
       glows evenly. Named edgeOn because "patch" is a reserved WGSL keyword. */
    const edgeOn = mix(float(1).sub(U.uFilPatch), float(1.0),
      smoothstep(0.28, 0.72, wRaw.mul(FBM2_NORM))).toVar();

    /* Diffuse inter-strand glow on a much wider envelope. Amplitude modulation,
       not a carved boundary, so it multiplies where the strands remap. */
    const hzX = dr.mul(invT).div(U.uFilHazeW.max(1.0)).abs();
    const envHz = float(1).sub(smoothstep(0.0, 1.0, hzX)).toVar();
    const haze = envHz.mul(envHz).mul(ext.sqrt())
      .mul(mix(float(0.25), float(1.0), sheet)).mul(U.uFilHaze).toVar();

    /* Which species dominates alternates along the shell; that patchwork is what
       makes the red-and-teal lacework read as chemistry rather than tinting. */
    const lace = smoothstep(0.35, 0.65, sheet).toVar();
    const wO = mix(float(1.0), lace, U.uFilLace);
    const wH = mix(float(1.0), float(1).sub(lace), U.uFilLace);

    /* Haze enters both species equally, so the faint end desaturates toward
       neutral through the palette while only the threads carry color. */
    const gain = U.uFilGain.mul(edgeOn);
    const ha = densH.mul(wH).mul(gain).add(haze).mul(U.uFilHa).toVar();
    const oiii = densO.mul(wO).mul(gain).add(haze).mul(U.uFilOiii);
    return vec3(ha, oiii, ha.mul(U.uFilSii));
  })();

  return { line };
}

/* Spread by the render spine, like REFLECTION_DEFAULTS */
export const FILAMENT_DEFAULTS = {
  center: [0.5, 0.45], rot: 0.35, squash: 0.92, radius: 0.85, expand: 0.00015,
  thick: 0.075, phase: 0.6, half: 1.0, soft: 0.9,
  freq: 14.0, aniso: 12.0, warp: 2.2, kink: 1.1, sep: 0.002,
  sharp: 3.0, braid: 0.55, threshold: 0.5, softness: 0.16,
  fray: 0.9, frayF: 2.8,
  patch: 0.45, haze: 0.025, hazeW: 2.6, lace: 0.72, laceF: 1.8,
  gain: 0.26, ha: 1.0, oiii: 1.0, sii: 0.12, morphRate: 0.05,
};
