/* Emission nebula, 2D field. Writes line channels vec3(Hα, OIII, SII) only —
   never RGB. The palette matrix touches these once, in compose. */

import { Fn, float, vec2, vec3, vec4, dot, clamp, cos, sin, exp, smoothstep } from 'three/tsl';
/* Rotated-octave fbm throughout: this entity's cavity walls and pow-contrast
   chains amplify lattice seams that the other entities' soft fields hide. */
import { fbm3o2r, fbm3o4r, fbm3o5r, FBM2_NORM, FBM2_MID } from './noise.js';

/* A cavity blown out of a cloud, not a gradient: an ionization scalar with a
   wavy front, a limb-brightened wall term, and a hot interior. */
export function buildEmissionNodes(skyU, U) {
  return Fn(() => {
    const zEvo = U.uTev.mul(U.uMorphRate);
    const p3 = vec3(skyU.mul(U.uNebFreq), zEvo).add(U.uNebOff);

    const q1 = fbm3o4r(p3.mul(1.7));
    const q2 = fbm3o4r(p3.mul(1.7).add(vec3(5.2, 1.3, 2.8)));
    const M = fbm3o5r(p3.mul(2.4).add(vec3(q1, q2, float(0)).mul(U.uWarp)));

    const d = skyU.sub(U.uNebIonSrc);
    const G = float(1).div(dot(d, d).div(U.uNebIonR2).add(1.0));

    /* Bounded extent: low-frequency coverage carves real black sky, biased
       toward the ionizing source or the cavity lands in a coverage hole. */
    const cp = vec3(skyU.mul(U.uNebFreq).mul(0.9), zEvo.mul(0.4)).add(U.uNebOff.mul(2.0));
    const cov = smoothstep(U.uCovLo, U.uCovHi, fbm3o2r(cp).add(G.mul(U.uCovIon)));

    /* Grazing cavity walls are the bright regions: an iso-shell of the density
       field seen edge-on. Never |grad fbm| — gradient ridges align to the value-
       noise lattice and pow(limbK) amplifies them into a geometric maze. */
    const wp = cp.mul(2.4);
    const n0 = fbm3o2r(wp).mul(FBM2_NORM);
    /* Iso-level at the normalized field's midpoint, where the shell is one
       connected lacework; 4 sets the shell half-width at a quarter of range. */
    const wall = clamp(float(1).sub(n0.sub(0.5).abs().mul(4.0)), 0.0, 1.0)
      .max(1e-4).pow(U.uLimbK);
    /* Divided by E[wall], which falls as limbK rises: rational fit to a 4M-sample
       Monte Carlo, ≤0.34% over the 0.2–5 dial. Limb buys range, never brightness. */
    const eWall = U.uLimbK.mul(8.7483).add(1.0)
      .div(U.uLimbK.mul(U.uLimbK).mul(6.0763).add(U.uLimbK.mul(10.239)).add(1.0));
    const limb = wall.mul(U.uLimb).add(1.0).div(U.uLimb.mul(eWall).add(1.0));

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
    /* Meander breaks the comb's lattice-regular spacing: without it the bands
       repeat like ruled lines and cross into a geometric weave. ±0.94 period. */
    const mw = fbm3o2r(vec3(skyU.mul(U.uNebFreq).mul(0.35), zEvo.mul(0.2))
      .add(U.uNebOff.mul(9.0))).sub(FBM2_MID).mul(2.5);
    const sp = vec3(sRot.x.mul(U.uStriaFreq).add(mw), sRot.y.mul(U.uStriaFreqY), zEvo.mul(0.3))
      .add(U.uNebOff.mul(0.5));
    const lane = fbm3o2r(sp).mul(FBM2_NORM);
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
