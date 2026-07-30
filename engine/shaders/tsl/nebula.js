/* Emission nebula, 2D field. Writes line channels vec3(Hα, OIII, SII) only —
   never RGB. The palette matrix touches these once, in compose. */

import { Fn, float, vec2, vec3, vec4, dot, clamp, cos, sin, exp, length, smoothstep } from 'three/tsl';
import { fbm3o2, fbm3o4, fbm3o5, FBM2_NORM } from './noise.js';

/* Forward-difference step, in noise-domain units rather than sky units, so the
   wall term tracks the field's own features at any frequency. */
const GRAD_EPS = 0.09;

/* A cavity blown out of a cloud, not a gradient: an ionization scalar with a
   wavy front, a limb-brightened wall term, and a hot interior. */
export function buildEmissionNodes(skyU, U) {
  return Fn(() => {
    const zEvo = U.uTev.mul(U.uMorphRate);
    const p3 = vec3(skyU.mul(U.uNebFreq), zEvo).add(U.uNebOff);

    const q1 = fbm3o4(p3.mul(1.7));
    const q2 = fbm3o4(p3.mul(1.7).add(vec3(5.2, 1.3, 2.8)));
    const M = fbm3o5(p3.mul(2.4).add(vec3(q1, q2, float(0)).mul(U.uWarp)));

    const d = skyU.sub(U.uIonSrc);
    const G = float(1).div(dot(d, d).div(U.uIonR2).add(1.0));

    /* Bounded extent: low-frequency coverage carves real black sky, biased
       toward the ionizing source or the cavity lands in a coverage hole. */
    const cp = vec3(skyU.mul(U.uNebFreq).mul(0.9), zEvo.mul(0.4)).add(U.uNebOff.mul(2.0));
    const cov = smoothstep(U.uCovLo, U.uCovHi, fbm3o2(cp).add(G.mul(U.uCovIon)));

    /* Grazing cavity walls are the bright regions: the density gradient is the
       brightness. Two octaves, not one: a single octave's gradient carries the
       lattice's axis alignment, and pow(limbK) amplifies it into a maze. */
    const wp = cp.mul(2.4);
    const w0 = fbm3o2(wp);
    const gx = fbm3o2(wp.add(vec3(GRAD_EPS, 0.0, 0.0))).sub(w0);
    const gy = fbm3o2(wp.add(vec3(0.0, GRAD_EPS, 0.0))).sub(w0);
    /* 1.1 normalizes a 2-octave slope over GRAD_EPS into roughly [0,1] */
    const wall = clamp(length(vec2(gx, gy)).mul(1.0 / GRAD_EPS).mul(1.1), 0.0, 1.0)
      .max(1e-4).pow(U.uLimbK);
    /* Divided by the field's own mean wall value so the dial buys internal
       dynamic range instead of overall brightness: walls rise, fill drops. */
    const limb = wall.mul(U.uLimb).add(1.0).div(U.uLimb.mul(0.45).add(1.0));

    /* The front wanders on the mottling field (a circle reads as drafted), in
       front widths; wob × width caps at 0.15 so slider extremes cannot shred it. */
    const ion = G.add(M.sub(0.5).mul(U.uFrontWob.mul(U.uFrontW).min(0.15)));
    const front = smoothstep(U.uFrontAt.sub(U.uFrontW), U.uFrontAt.add(U.uFrontW), ion);
    /* The ridge is the Gaussian of the front, not the front itself. It takes the
       entity gain too, or muting the layer would leave its rim burning. */
    const fz = ion.sub(U.uFrontAt).div(U.uFrontW);
    const ridge = exp(fz.mul(fz).negate())
      .mul(U.uFrontGain).mul(cov).mul(limb).mul(U.uNebGain);

    /* Striations are anisotropy: y frequency is x over the anisotropy (host-
       applied), rotated off-axis so the comb doesn't read as an artifact. */
    const sc = cos(U.uStriaAngle);
    const ss = sin(U.uStriaAngle);
    const sRot = vec2(
      skyU.x.mul(sc).sub(skyU.y.mul(ss)),
      skyU.x.mul(ss).add(skyU.y.mul(sc)),
    );
    const sp = vec3(sRot.x.mul(U.uStriaFreq), sRot.y.mul(U.uStriaFreqY), zEvo.mul(0.3))
      .add(U.uNebOff.mul(0.5));
    const lane = fbm3o2(sp).mul(FBM2_NORM);
    const stria = float(1).add(lane.sub(0.5).mul(U.uStria).mul(2.0));

    const E = G.mul(M.sub(0.5).mul(U.uMottle).add(1.0))
      .mul(cov)
      .mul(front)
      .mul(stria)
      .max(1e-5)
      .pow(U.uNebContrast)
      .mul(U.uNebGain)
      .mul(limb);

    /* OIII confined to the hottest zone or crimson Hα turns rust; Hα dips
       where fully ionized, which is what lets the cavity read teal. */
    const hot = smoothstep(U.uHotLo, U.uHotHi, G);
    return vec4(
      E.mul(float(1).sub(hot.mul(U.uHotHaCut))).add(ridge),
      E.mul(hot.mul(U.uOiii).add(0.015)).add(ridge.mul(U.uFrontOiii)),
      E.mul(U.uSii),
      1.0,
    );
  })();
}
