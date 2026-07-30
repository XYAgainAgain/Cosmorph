/* Wolf-Rayet wind bubble: a crisp nested two-color shell (OIII inside Hα),
   brain-fiber texture from a two-level domain warp, a bow-shock squash, and
   optional Thor's-Helmet horns. Line channels only, never RGB. */

import {
  Fn, float, vec2, vec3, cos, sin, dot, length, max, mix, pow, smoothstep,
} from 'three/tsl';
import { fbm3o2, ridged2, FBM2_NORM, FBM2_MID } from './noise.js';
import { rot2, sdSegment, sdfEnvelope, shellChord } from './sdf.js';

/* Independent noise slices: a warp level correlated with the field it displaces
   folds the pattern back onto itself instead of convolving it. */
const WARP_A = /*@__PURE__*/ vec3(13.7, 5.1, 29.3);
const WARP_B = /*@__PURE__*/ vec3(41.9, 23.7, 7.9);
const WARP_C = /*@__PURE__*/ vec3(3.1, 47.3, 17.7);
const WARP_D = /*@__PURE__*/ vec3(27.3, 11.9, 43.1);

/* Fixed shear direction for the fine warp; arbitrary, only needs to be oblique */
const KINK_DIR = /*@__PURE__*/ vec3(0.7, -0.5, 0.9);

export function buildWrBubbleNodes(skyU, U, { horns = false } = {}) {
  const line = Fn(() => {
    const zEvo = U.uTev.mul(U.uWrbMorph);

    /* Motion axis on local +X, so the bow shock and the horn fold share a frame */
    const d = rot2(skyU.sub(U.uWrbCenter), U.uWrbAxis.negate()).toVar();

    /* uTev's 4096 h wrap bounds expansion but also resets it: one shell snap
       every ~170 days, accepted as in filaments.js. The cap bounds the domain. */
    const R = U.uWrbRadius.add(U.uTev.mul(U.uWrbExpand))
      .min(U.uWrbRadius.mul(1.5)).max(1e-3).toVar();

    /* Deform space before evaluating the shell: scaling a coordinate up shrinks
       the bubble along it, so the leading face flattens and its flank flares. */
    const lead = smoothstep(0.0, 1.0, d.x.div(R)).toVar();
    const squash = float(1).add(U.uWrbBow.mul(lead)).max(0.2).toVar();
    const flare = float(1).sub(U.uWrbWing.mul(lead)).max(0.2).toVar();
    const dq = vec2(d.x.mul(squash), d.y.mul(flare)).toVar();

    const rp = length(dq).max(1e-4).toVar();
    const dirHat = dq.div(rp).toVar();

    /* Thickness is a fraction of each shell's own radius, so the nesting ratio
       does not also thin the inner shell. Clamped so rIn < rOut always holds. */
    const rOiii = R.mul(U.uWrbRatio.max(0.15).min(0.95)).toVar();
    const inHa = R.mul(float(1).sub(U.uWrbThick.max(0.02).min(0.9))).toVar();
    const inOiii = rOiii.mul(float(1).sub(U.uWrbThickO.max(0.02).min(0.9))).toVar();

    const profH = shellChord(rp, R, inHa).toVar();
    const profO = shellChord(rp, rOiii, inOiii).toVar();

    /* Angular extent from the direction dot product, not atan: no branch cut,
       and cos is monotone on [0,PI] so the smoothstep edges stay ascending. */
    const keep = vec2(cos(U.uWrbGapPhase), sin(U.uWrbGapPhase));
    const halfA = U.uWrbComp.max(0.0).min(1.0).mul(Math.PI).toVar();
    const cosIn = cos(halfA).toVar();
    const cosOut = cos(halfA.add(U.uWrbCompSoft).min(Math.PI)).min(cosIn.sub(1e-4));
    /* The soft edge would leave a stub arc lit at comp = 0; fade it to truly zero */
    const ext = smoothstep(cosOut, cosIn, dot(dirHat, keep))
      .mul(smoothstep(0.0, 0.03, U.uWrbComp)).toVar();

    /* Parabolic stand-in for the hemisphere height: C1 at the limb, where the
       true sqrt has infinite slope and would smear a whole noise period into 3 px. */
    const zs = R.mul(R).sub(rp.mul(rp)).max(0.0).div(R).mul(U.uWrbFibAniso);
    const s = vec3(dq, zs).mul(U.uWrbFibFreq).add(U.uWrbOff).toVar();

    /* Coarse level: two slices make a warp vector whose third component is a
       combination, since only the screen plane is ever seen edge-on. */
    const sc = s.mul(0.35).add(vec3(0.0, 0.0, zEvo.mul(0.4))).toVar();
    const nA = fbm3o2(sc.add(WARP_A)).toVar();
    const nB = fbm3o2(sc.add(WARP_B)).toVar();
    const warpV = vec3(nA.sub(FBM2_MID), nB.sub(FBM2_MID), nA.sub(nB).mul(0.5))
      .mul(U.uWrbWarp).toVar();
    const q1 = s.add(warpV).toVar();

    /* Fine level is one eval sheared along a fixed direction rather than a full
       gradient: it kinks fibers along their length, which is all it must do. */
    const nC = fbm3o2(q1.mul(2.1).add(WARP_C)).sub(FBM2_MID).toVar();
    const qk = q1.add(KINK_DIR.mul(nC.mul(U.uWrbWarp2))).toVar();
    /* One ridge scale draws closed iso-contours, which read as a topographic map.
       A second non-harmonic scale combined by max makes the crests branch and
       vary in width, which is what turns contour lines into a tangle of hairs. */
    const fib = max(ridged2(qk, U.uWrbFibSharp),
      ridged2(qk.mul(1.87).add(WARP_D), U.uWrbFibSharp)).toVar();

    const soft = U.uWrbSoft.max(1e-3).toVar();
    const envH = profH.mul(ext).toVar();
    /* The OIII sphere survives a gap that has already broken the Hα shell,
       which is what Sh2-308 looks like next to a crescent. */
    const envO = profO.mul(mix(float(1.0), ext, U.uWrbCompO)).toVar();

    /* Envelope lowers the threshold the fiber must clear (remap doctrine, sdf.js) */
    const thH = mix(float(1.0), U.uWrbTh, envH);
    const thO = mix(float(1.0), U.uWrbTh, envO);
    /* Same iso-contour problem as above: the fine warp slice as along-fiber
       gain breaks the crests into veins of varying brightness for free. */
    const grain = mix(float(1).sub(U.uWrbGrain.clamp(0.0, 1.0)), float(1.0),
      nC.add(FBM2_MID).mul(FBM2_NORM)).toVar();
    const densH = smoothstep(thH, thH.add(soft), fib).mul(grain).toVar();
    const densO = smoothstep(thO, thO.add(soft), fib).mul(grain).toVar();

    /* Brightness wanders around the shell; an evenly lit ring reads as drawn.
       Reuses the coarse field, so the patchiness costs no extra noise. */
    const mottle = mix(float(1).sub(U.uWrbPatch), float(1.0),
      smoothstep(0.25, 0.75, nA.mul(FBM2_NORM))).toVar();
    const gain = U.uWrbGain.mul(mottle).toVar();

    /* Fibers alone leave the gaps at zero, which reads as a wireframe doodle.
       The bare chord under them is the gas sheet the veins ride on (Sh2-308). */
    const sheetH = densH.add(envH.mul(U.uWrbShell).mul(mix(float(0.5), float(1.0), fib)))
      .min(1.0).toVar();
    const sheetO = densO.add(envO.mul(U.uWrbShell).mul(mix(float(0.5), float(1.0), fib)))
      .min(1.0).toVar();

    /* Stratification is strong but never absolute; the bleed keeps each shell
       from reading as a flat single-species ring. */
    const ha = sheetH.mul(gain).add(sheetO.mul(gain).mul(U.uWrbBleed)).toVar();
    const oiii = sheetO.mul(gain).add(sheetH.mul(gain).mul(U.uWrbBleed)).toVar();

    if (horns) {
      /* Folding |y| evaluates both horns from one capsule */
      const hp = vec2(dq.x, dq.y.abs()).toVar();
      const root = vec2(cos(U.uWrbHornPhi), sin(U.uWrbHornPhi)).mul(R).toVar();
      const away = U.uWrbHornPhi.add(U.uWrbHornTilt).toVar();
      const tip = root.add(vec2(cos(away), sin(away)).mul(R.mul(U.uWrbHornLen))).toVar();
      const dh = sdSegment(hp, root, tip, R.mul(U.uWrbHornW)).toVar();
      const envN = sdfEnvelope(dh, U.uWrbHornFeather).toVar();
      const thN = mix(float(1.0), U.uWrbTh, envN);
      const eN = smoothstep(thN, thN.add(soft), fib).mul(gain).mul(U.uWrbHornAmt).toVar();
      ha.addAssign(eN);
      oiii.addAssign(eN.mul(U.uWrbBleed));
    }

    const haE = ha.mul(U.uWrbHa).toVar();
    return vec3(haE, oiii.mul(U.uWrbOiii), haE.mul(U.uWrbSii));
  })();

  /* The central star is continuum: a bubble's whole payload is the scale ratio
     between the one dot that blew it and the shell, so the dot has to be there. */
  const continuum = Fn(() => {
    const d = skyU.sub(U.uWrbCenter).sub(U.uWrbStarAt.mul(U.uWrbRadius)).toVar();
    const r2 = dot(d, d).toVar();
    /* Moffat, not Gaussian (catalog Part 3.1); base >= 1 keeps the pow defined */
    const core = pow(r2.div(U.uWrbStarCore.mul(U.uWrbStarCore).max(1e-8)).add(1.0),
      U.uWrbStarBeta.max(0.5).negate()).toVar();
    const halo = float(1).div(r2.div(U.uWrbStarHaloR.mul(U.uWrbStarHaloR).max(1e-6)).add(1.0));
    return U.uWrbStarTint.mul(core.add(halo.mul(U.uWrbStarHalo)).mul(U.uWrbStarLum));
  })();

  return { line, continuum };
}

/* Param block in the host's units (vectors as arrays), not uniform nodes.
   thick/thickO are fractions of their own shell radius; hornW and hornLen are
   fractions of R; starAt is an offset in units of R. */
export const WRBUBBLE_DEFAULTS = {
  center: [0.46, 0.52], radius: 0.28, expand: 0.000034, axis: 0.35,
  bow: 0.55, wing: 0.3,
  ratio: 0.9, thick: 0.2, thickO: 0.38,
  comp: 0.8, compSoft: 0.5, gapPhase: 2.4, compO: 0.4,
  fibFreq: 44.0, fibAniso: 0.55, fibSharp: 2.8, warp: 0.85, warp2: 0.9,
  threshold: 0.6, softness: 0.18, patch: 0.55, bleed: 0.32, shell: 0.5,
  grain: 0.75,
  gain: 0.3, ha: 0.85, oiii: 1.0, sii: 0.1, morphRate: 0.06,
  horns: false,
  hornPhi: 0.95, hornTilt: 0.55, hornLen: 0.85, hornW: 0.055,
  hornFeather: 0.05, hornAmt: 0.7,
  starAt: [0.06, -0.04], starLum: 0.45, starCore: 0.006, starBeta: 1.9,
  starHalo: 0.05, starHaloR: 0.07, starTint: [0.76, 0.86, 1.0],
};
