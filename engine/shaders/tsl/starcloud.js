/* The Milky Way band: unresolved starlight as a broad continuum glow, split
   lengthwise by the Great Rift's extinction. Starlight carries no line
   signature, so this module emits continuum and optical depth only. */

import { Fn, float, vec3, mix, pow, smoothstep } from 'three/tsl';
import { fbm3o2, fbm3o4, fbm3o5, FBM2_NORM, FBM4_NORM, FBM5_NORM } from './noise.js';

/* The same line the star-density gradient rides, y = x*tilt + bandY, with the
   along axis its perpendicular. Neither is normalized for tilt, matching dust.js. */
function bandFrame(sky, U) {
  return {
    across: sky.y.sub(sky.x.mul(U.uBandTilt)).sub(U.uBandY),
    along: sky.x.add(sky.y.mul(U.uBandTilt)),
  };
}

/* Lateral profile, 1 at the band core. Core plus a wider wing because a single
   term either cuts off hard at the frame edge or floods the whole frame. */
function bandProfile(across, U) {
  const f = U.uSCFalloff.max(0.05).negate().toVar();
  const q = across.div(U.uSCWidth.max(1e-3)).toVar();
  /* Base is >= 1 by construction, so a negative exponent is always defined */
  const core = pow(q.mul(q).add(1.0), f);
  const qw = q.div(U.uSCWingScale.max(1.0));
  const wing = pow(qw.mul(qw).add(1.0), f);
  const wgt = U.uSCWing.max(0.0).toVar();
  return core.add(wing.mul(wgt)).div(wgt.add(1.0));
}

/* Both fbm chains are build-gated: at 0 the term is arithmetically inert but
   the octaves still run, and the five-octave grain is the whole layer's cost. */
export function buildStarcloudNodes(skyU, U, opts = {}) {
  const { grain: grainOn = false, patch: patchOn = false } = opts;
  const continuum = Fn(() => {
    const across = bandFrame(skyU, U).across;
    const zEvo = U.uTev.mul(U.uSCMorph).toVar();
    const prof = bandProfile(across, U).toVar();

    let lit = prof;
    if (patchOn) {
      /* Profile lowers the threshold the mottle must clear (remap doctrine, sdf.js) */
      const m = fbm3o2(vec3(skyU.mul(U.uSCPatchFreq), zEvo).add(U.uSCOff.mul(3.0))).mul(FBM2_NORM);
      const th = mix(float(1.0), U.uSCPatchTh, prof).toVar();
      /* Not "patch": that is a reserved WGSL keyword and toVar-ing it is fatal */
      const mottle = smoothstep(th, th.add(U.uSCPatchSoft.max(1e-3)), m);
      lit = prof.add(mottle.mul(U.uSCPatch));
    }
    /* Five octaves are what sell billions of unresolved stars. This modulates an
       emissivity rather than combining noise with a silhouette, so it multiplies. */
    if (grainOn) {
      const g = fbm3o5(vec3(skyU.mul(U.uSCGrainFreq), zEvo.mul(0.25)).add(U.uSCOff)).mul(FBM5_NORM);
      lit = lit.mul(float(1).add(g.sub(0.5).mul(U.uSCGrain)).max(0.0));
    }

    const lum = lit.mul(U.uSCGain);
    return U.uSCTint.mul(lum);
  })();

  return { continuum };
}

/* Great Rift optical depth; same tau convention as the wisp layer (dust.js) */
export function riftTau(skyW, U) {
  const { across, along } = bandFrame(skyW, U);
  const zEvo = U.uTev.mul(U.uRiftMorph).toVar();

  /* A straight lane reads as a drawn stripe however the interior is textured,
     so the rift meanders on low-frequency noise of the along-band coordinate. */
  const wander = fbm3o2(vec3(along.mul(U.uRiftWanderFreq), 0.0, zEvo).add(U.uRiftOff))
    .mul(FBM2_NORM).sub(0.5).mul(U.uRiftWander);
  const sr = across.sub(U.uRiftCenter).sub(wander).toVar();
  const env = float(1).sub(smoothstep(0.0, 1.0, sr.abs().div(U.uRiftW.max(1e-3))));

  /* Domain compressed along the band and not across it: dust in the plane is
     drawn out lengthwise, and that anisotropy is what braids the lane. */
  const p = vec3(along.mul(U.uRiftFreq).mul(U.uRiftAniso), sr.mul(U.uRiftFreq), zEvo)
    .add(U.uRiftOff).toVar();
  const n = fbm3o4(p).mul(FBM4_NORM);
  const detail = fbm3o2(p.mul(3.1)).mul(FBM2_NORM);
  const carved = n.add(detail.sub(0.5).mul(0.45));

  const th = mix(float(1.0), U.uRiftTh, env).toVar();
  return smoothstep(th, th.add(U.uRiftSoft.max(1e-3)), carved).mul(U.uRiftTau);
}

/* Bare keys take uSC*, rift* keys take uRift* */
export const STARCLOUD_DEFAULTS = {
  width: 0.25,
  falloff: 1.6,
  wing: 0.12,
  wingScale: 2.6,
  /* Deep-background gain: the band must read as a luminosity gradient under the
     compose stretch, not as a lit subject. Overshooting clips flat. */
  gain: 0.02,
  tint: [1.0, 0.93, 0.8],
  grainFreq: 22.0,
  grain: 0.55,
  patchFreq: 3.4,
  patchTh: 0.52,
  patchSoft: 0.3,
  patch: 0.45,
  morphRate: 0.04,

  riftCenter: 0.03,
  riftW: 0.12,
  riftWander: 0.12,
  riftWanderFreq: 1.4,
  riftFreq: 4.2,
  riftAniso: 0.28,
  riftTh: 0.36,
  riftSoft: 0.16,
  riftTau: 1.6,
  riftMorph: 0.04,
};
