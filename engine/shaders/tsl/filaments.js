/* Supernova-remnant shock filaments and the giant faint OIII arc. One shell
   envelope, ridged threads remapped through it, sitting in a diffuse haze.
   Line channels only, never RGB. */

import {
  Fn, float, vec2, vec3, dot, length, cos, sin, max, mix, smoothstep,
} from 'three/tsl';
import { fbm3o2, makeRidged, FBM2_NORM, FBM2_MID } from './noise.js';
import { rot2 } from './sdf.js';

const ridged2 = /*@__PURE__*/ makeRidged(2);

/* Three ridged octaves at non-harmonic frequency ratios, combined by max rather
   than sum: where crests cross they stay separate threads instead of pooling
   into one filled ribbon, which is what made the old field read as painted. */
export const ribbonField = /*@__PURE__*/ Fn(([p, sharp, braid]) => {
  const b = braid.max(0.0).min(1.0).toVar();
  const r1 = ridged2(p, sharp).toVar();
  const r2 = ridged2(p.mul(1.43).add(vec3(11.3, 4.7, 21.9)), sharp);
  const r3 = ridged2(p.mul(2.11).add(vec3(31.7, 17.1, 5.3)), sharp);
  return mix(r1, max(r1, max(r2, r3)), b);
});

/* Veil-style shock lacework and, at low gain with the ridging flattened, the
   giant faint OIII arc. Both are the same shell: only parameters differ. */
export function buildFilamentNodes(skyU, U) {
  const line = Fn(() => {
    const zEvo = U.uTev.mul(U.uFilMorph);

    /* Work in the shell's own frame: rotate, then squash one axis so the
       "circle" is an ellipse without the noise domain ever knowing. */
    const dR = rot2(skyU.sub(U.uArcCenter), U.uArcRot.negate()).toVar('dR');
    const de = vec2(dR.x, dR.y.div(U.uArcSquash.max(0.05))).toVar('de');

    const rad = length(de).max(1e-4).toVar('rad');
    const dirHat = de.div(rad).toVar('dirHat');

    /* uTev's 4096 h wrap bounds expansion but also resets it: one visible
       shell snap every ~170 days, accepted. The cap keeps the domain sane. */
    const R = U.uArcRadius.add(U.uTev.mul(U.uArcExpand))
      .min(U.uArcRadius.mul(3.0)).max(1e-3).toVar('shellR');
    const dr = rad.sub(R).toVar('dr');
    const invT = float(1).div(U.uArcThick.max(1e-4)).toVar('invT');

    /* Angular extent via the direction dot product, not atan: no branch cut,
       and cos is monotone on [0,PI] so the smoothstep edges stay ascending. */
    const axis = vec2(cos(U.uArcPhase), sin(U.uArcPhase));
    const cosD = dot(dirHat, axis);
    const cosHalf = cos(U.uArcHalf.min(Math.PI)).toVar('cosHalf');
    const cosOut = cos(U.uArcHalf.add(U.uArcSoft).min(Math.PI)).min(cosHalf.sub(1e-4));
    const ext = smoothstep(cosOut, cosHalf, cosD).toVar('ext');

    /* Noise domain rides the shell itself: xy trace a circle of radius R*kT,
       so the field is seamless all the way around with no polar unwrap. */
    const kT = U.uFilFreq;
    const kR = U.uFilFreq.mul(U.uFilAniso);
    const ring = dirHat.mul(R.mul(kT)).toVar('ring');

    /* One slow field along the shell drives both the haze amplitude and which
       species leads, so colour and glow stay in step around the arc. */
    const sheet = fbm3o2(vec3(ring.mul(0.13), zEvo.mul(0.4)).add(U.uFilOff.mul(5.0)))
      .mul(FBM2_NORM).toVar('sheet');

    /* Warp radially only: strands weaving in and out across the shell is what
       braids them, while a tangential warp would just slide the whole pattern. */
    const wRaw = fbm3o2(vec3(ring.mul(0.28), zEvo.mul(0.3)).add(U.uFilOff.mul(3.0))).toVar('wRaw');
    const warp = wRaw.sub(FBM2_MID).mul(U.uFilWarp).toVar('warp');
    /* A second warp four times faster kinks a thread along its length instead
       of sliding it, which is the difference between a ribbon and frayed rope. */
    const kink = fbm3o2(vec3(ring.mul(1.1), zEvo.mul(0.6)).add(U.uFilOff.mul(11.0)))
      .sub(FBM2_MID).mul(U.uFilKink).toVar('kink');

    const sep = U.uFilSep.toVar('sep');
    const drO = dr.sub(sep).toVar('drO');
    const drH = dr.add(sep).toVar('drH');

    /* Both species share one warped z, so they are the same threads displaced
       by 2*sep: the offset parallel strands of a real shock front. */
    const zW = warp.add(kink).add(zEvo).toVar('zW');
    const pO = vec3(ring, drO.mul(kR).add(zW)).add(U.uFilOff);
    const pH = vec3(ring, drH.mul(kR).add(zW)).add(U.uFilOff);
    const fO = ribbonField(pO, U.uFilSharp, U.uFilBraid).toVar('fO');
    const fH = ribbonField(pH, U.uFilSharp, U.uFilBraid).toVar('fH');

    const envO = float(1).sub(smoothstep(0.0, 1.0, drO.mul(invT).abs())).mul(ext).toVar('envO');
    const envH = float(1).sub(smoothstep(0.0, 1.0, drH.mul(invT).abs())).mul(ext).toVar('envH');

    /* Envelope lowers the threshold the ridge must clear (remap doctrine, sdf.js) */
    const thO = mix(float(1.0), U.uFilTh, envO);
    const thH = mix(float(1.0), U.uFilTh, envH);
    const densO = smoothstep(thO, thO.add(U.uFilSoft.max(1e-3)), fO).toVar('densO');
    const densH = smoothstep(thH, thH.add(U.uFilSoft.max(1e-3)), fH).toVar('densH');

    /* A shell is bright only where its sheet folds toward edge-on, or the arc
       glows evenly. Named edgeOn because "patch" is a reserved WGSL keyword. */
    const edgeOn = mix(float(1).sub(U.uFilPatch), float(1.0),
      smoothstep(0.28, 0.72, wRaw.mul(FBM2_NORM))).toVar('edgeOn');

    /* Diffuse inter-strand glow on a much wider envelope. Amplitude modulation,
       not a carved boundary, so it multiplies where the strands remap. */
    const hzX = dr.mul(invT).div(U.uFilHazeW.max(1.0)).abs();
    const envHz = float(1).sub(smoothstep(0.0, 1.0, hzX)).toVar('envHz');
    const haze = envHz.mul(envHz).mul(ext.sqrt())
      .mul(mix(float(0.25), float(1.0), sheet)).mul(U.uFilHaze).toVar('haze');

    /* Which species dominates wanders slowly along the shell; that patchwork
       is what makes the red-and-teal lacework read as chemistry, not tinting. */
    const lace = smoothstep(0.35, 0.65, sheet).toVar('lace');
    const wO = mix(float(1.0), lace, U.uFilLace);
    const wH = mix(float(1.0), float(1).sub(lace), U.uFilLace);

    /* Haze enters both species equally, so the faint end desaturates toward
       neutral through the palette while only the threads carry colour. */
    const gain = U.uFilGain.mul(edgeOn);
    const ha = densH.mul(wH).mul(gain).add(haze).mul(U.uFilHa).toVar('ha');
    const oiii = densO.mul(wO).mul(gain).add(haze).mul(U.uFilOiii);
    return vec3(ha, oiii, ha.mul(U.uFilSii));
  })();

  return { line };
}

/* Spread by the render spine, like REFLECTION_DEFAULTS */
export const FILAMENT_DEFAULTS = {
  center: [0.5, 0.45], rot: 0.35, squash: 0.92, radius: 0.85, expand: 0.00015,
  thick: 0.075, phase: 0.6, half: 1.0, soft: 0.9,
  freq: 9.0, aniso: 5.0, warp: 1.7, kink: 0.85, sep: 0.006,
  sharp: 5.0, braid: 0.75, threshold: 0.66, softness: 0.24,
  patch: 0.7, haze: 0.07, hazeW: 4.0, lace: 0.4,
  gain: 0.26, ha: 0.78, oiii: 1.0, sii: 0.12, morphRate: 0.05,
};
