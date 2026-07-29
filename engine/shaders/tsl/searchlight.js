/* Protoplanetary nebula, Egg Nebula class: twin hard-edged searchlight beams
   escaping the polar cavities, concentric mass-loss arcs, and the equatorial
   dust torus that hides the star. Scattered starlight, so continuum, never line. */

import {
  Fn, float, vec3, clamp, cos, floor, length, mix, smoothstep, step,
} from 'three/tsl';
import { fbm3o2, FBM2_NORM } from './noise.js';
import { rot2 } from './sdf.js';

const WRAP_H = 4096.0;
const TURN = Math.PI * 2;

/* uTev wraps at 4096 h and every drifting phase here feeds cos only, so
   rounding the rate to whole turns per wrap makes that reset invisible. */
const seamlessPhase = /*@__PURE__*/ Fn(([tev, rate]) => {
  const turns = floor(rate.mul(WRAP_H / TURN).add(0.5)).toVar();
  return tev.mul(turns).mul(TURN / WRAP_H);
});

/* Local frame with the polar axis on +Y, so one abs() serves both lobes */
function beamFrame(sky, U) {
  const axis = U.uBeamAxis.add(seamlessPhase(U.uTev, U.uBeamSpin));
  return rot2(sky.sub(U.uBeamCenter), axis.negate()).toVar();
}

export function buildSearchlightNodes(skyU, U, opts = {}) {
  const useArcs = opts.arcs !== false;
  const useRungs = opts.rungs === true;

  const continuum = Fn(() => {
    const zEvo = U.uTev.mul(U.uBeamMorph);
    const q = beamFrame(skyU, U);
    const rad = length(q).max(1e-4).toVar();
    const along = q.y.abs().max(1e-4).toVar();
    const drift = (useArcs || useRungs) ? seamlessPhase(U.uTev, U.uBeamArcDrift).toVar() : null;

    /* Cosine off the polar axis, never atan: no branch cut, and cos stays
       monotone so the edges ascend. Past PI/2 the cone opens through the
       equator and the beam pair is gone, so the half-angle clamps here. */
    const cosA = along.div(rad).toVar();
    const halfC = U.uBeamHalf.min(1.5).toVar();
    const cosIn = cos(halfC).toVar();
    const cosOut = cos(halfC.add(U.uBeamSoft)).min(cosIn.sub(1e-4)).toVar();
    /* This smoothstep is the entire effect: it only reads as a searchlight
       while the angular cutoff stays hard. */
    const ext = smoothstep(cosOut, cosIn, cosA).toVar();

    /* A cavity wall is a sheet: near the angular rim the line of sight runs along
       it, so the beam edge brightens by geometry instead of being painted. */
    const limb = float(1).sub(smoothstep(0.0, 1.0,
      cosA.sub(cosIn).div(float(1).sub(cosIn).max(1e-3))));
    const wall = mix(float(1.0), limb.max(1e-4).pow(U.uBeamWallK.max(0.0)),
      U.uBeamWall.clamp(0.0, 1.0)).toVar();

    /* The throat stands in for the torus swallowing the beam base, and hides the
       apex where the cone angle degenerates into single-pixel noise. */
    const throat = smoothstep(0.0, U.uBeamThroat.max(1e-4), along).toVar();
    const tipOut = U.uBeamLen.max(1e-3).toVar();
    const tip = float(1).sub(smoothstep(tipOut.mul(U.uBeamTaper.min(0.95)), tipOut, along)).toVar();

    /* Escaping light dilutes along the beam; base >= 1 keeps the pow defined */
    const fade = along.div(U.uBeamCore.max(1e-3)).add(1.0)
      .pow(U.uBeamFall.max(0.05).negate()).toVar();

    /* Real bipolar cavities are never twins; one lobe always leads. Clamped
       in-module: past 1 the trailing lobe emits negative light. */
    const asymC = U.uBeamAsym.clamp(0.0, 1.0).toVar();
    const lobe = mix(float(1).sub(asymC), float(1).add(asymC), step(0.0, q.y)).toVar();

    /* Noise frozen in angle streaks radially, which is how clumps near the star
       cast shadow rays down the cone. Clamped because q.x/along runs away toward
       the equator and noise.js casts its domain through uint. */
    const ang = clamp(q.x.div(along), -4.0, 4.0).toVar();
    const rays = fbm3o2(vec3(ang.mul(U.uBeamRayFreq),
      along.mul(U.uBeamRayFreq).mul(U.uBeamRayAniso), zEvo).add(U.uBeamOff))
      .mul(FBM2_NORM).toVar();

    /* Half the dilution raises the remap threshold, so shadow rays thin out
       toward the tip instead of keeping full coverage and merely dimming. */
    const fadeS = fade.sqrt().toVar();
    const env = ext.mul(throat).mul(tip).mul(fadeS).toVar();
    /* Envelope lowers the threshold the dust must clear (remap doctrine, sdf.js) */
    const th = mix(float(1.0), U.uBeamTh, env);
    const dens = smoothstep(th, th.add(U.uBeamRaySoft.max(1e-3)), rays).toVar();

    /* Interior glow enters as amplitude, so the hard cutoff still owns the edge;
       env² already carries the full dilution, the structure keeps its other half. */
    const lit = dens.mul(U.uBeamStruct).mul(fadeS)
      .add(env.mul(env).mul(U.uBeamGlow))
      .mul(lobe).mul(wall).toVar();

    if (useRungs) {
      /* Red Rectangle ladder: the rungs are pulsed, so they ride the beam
         as modulation rather than carving a second silhouette. */
      const rung = cos(along.mul(U.uBeamRungFreq).sub(drift)).mul(0.5).add(0.5);
      lit.mulAssign(mix(float(1.0), rung.max(1e-4).pow(U.uBeamRungSharp.max(0.0)),
        U.uBeamRungAmt.clamp(0.0, 1.0)));
    }

    if (useArcs) {
      /* Pulsed mass-loss shells: cos of radius with amplitude decay, broken up
         by a slow azimuthal field. No local torus mask: the dust lane darkens
         the arcs only through the shared extinction sum, so wire the tau. */
      const ring = cos(rad.mul(U.uBeamArcFreq).sub(drift)).mul(0.5).add(0.5);
      const shells = ring.max(1e-4).pow(U.uBeamArcSharp.max(0.0)).toVar();
      const rr = rad.div(U.uBeamArcR.max(1e-3)).toVar();
      const azim = fbm3o2(vec3(q.div(rad).mul(U.uBeamArcAzimFreq), zEvo.mul(0.5))
        .add(U.uBeamOff.mul(3.0))).mul(FBM2_NORM);
      lit.addAssign(shells
        .mul(smoothstep(0.0, U.uBeamArcIn.max(1e-4), rad))
        .div(rr.mul(rr).add(1.0))
        .mul(mix(float(0.3), float(1.0), azim))
        .mul(U.uBeamArcAmp));
    }

    /* Bone-white cooling out of a pale-yellow core, held low in saturation:
       this object is carried by its structure, not by its color. */
    const warm = float(1).sub(smoothstep(0.0, U.uBeamWarmR.max(1e-3), rad));
    return mix(U.uBeamTint, U.uBeamWarm, warm.mul(U.uBeamWarmAmt.clamp(0.0, 1.0)))
      .mul(lit).mul(U.uBeamLum);
  })();

  return { continuum, tauAt: (sky) => searchlightTau(sky, U) };
}

/* Occluder only: the torus emits nothing, and the dark lane across the beams'
   base is why the star reads as hidden rather than merely absent. Module-level
   like reflectionTau, so compose imports it without building a second graph. */
export function searchlightTau(skyW, U) {
  const zEvo = U.uTev.mul(U.uBeamMorph);
  const q = beamFrame(skyW, U);
  const across = q.x.abs().toVar();
  const rr = U.uBeamTorusR.max(1e-3).toVar();

  /* A real torus flares outward, and the flare also keeps the ansae from
     ending on a cut edge. */
  const halfT = U.uBeamTorusT.max(1e-4)
    .mul(across.div(rr).mul(U.uBeamTorusFlare).add(1.0)).toVar();
  const lane = float(1).sub(smoothstep(0.0, 1.0, q.y.abs().div(halfT)))
    .mul(float(1).sub(smoothstep(rr.mul(0.55), rr, across))).toVar();

  /* Ansae: an edge-on ring is deepest at its tangent points, where the line of
     sight runs the length of the tube. Negative values would amplify the scene
     through exp(-tau), so both depth params clamp here. */
  const ansae = mix(float(1.0), float(1).add(U.uBeamAnsae.max(0.0)),
    smoothstep(rr.mul(0.35), rr.mul(0.9), across));

  const th = mix(float(1.0), U.uBeamTorusTh, lane);
  const clumps = fbm3o2(vec3(q.mul(U.uBeamTorusFreq), zEvo).add(U.uBeamOff.mul(7.0)))
    .mul(FBM2_NORM);
  const dens = smoothstep(th, th.add(U.uBeamTorusSoft.max(1e-3)), clumps);
  /* Floored coverage: a hole in an occluder uncovers what it exists to hide */
  return lane.mul(mix(U.uBeamTorusFloor.clamp(0.0, 1.0), float(1.0), dens))
    .mul(ansae).mul(U.uBeamTau.max(0.0));
}

/* Param block in the host's units (vectors as arrays). Keys map to uniform
   suffixes except threshold → Th and morphRate → Morph, as in filaments.
   `arcs` and `rungs` are build-time flags, not uniforms. */
export const SEARCHLIGHT_DEFAULTS = {
  center: [0.5, 0.52],
  axis: 0.55,
  spin: 0.003,
  half: 0.3,
  soft: 0.035,
  throat: 0.05,
  len: 0.72,
  taper: 0.55,
  core: 0.06,
  fall: 1.8,
  asym: 0.22,
  wall: 0.45,
  wallK: 1.6,
  rayFreq: 9.0,
  rayAniso: 0.1,
  threshold: 0.34,
  raySoft: 0.42,
  struct: 0.5,
  glow: 0.3,
  lum: 0.6,
  tint: [1.0, 0.97, 0.9],
  warm: [1.0, 0.93, 0.76],
  warmR: 0.12,
  warmAmt: 0.6,
  arcs: true,
  arcFreq: 46.0,
  arcSharp: 2.5,
  arcAmp: 0.05,
  arcR: 0.35,
  arcIn: 0.06,
  arcDrift: 0.009,
  arcAzimFreq: 4.0,
  rungs: false,
  rungFreq: 34.0,
  rungSharp: 2.0,
  rungAmt: 0.5,
  torusR: 0.3,
  torusT: 0.045,
  torusFlare: 0.6,
  ansae: 0.8,
  torusFreq: 7.0,
  torusTh: 0.42,
  torusSoft: 0.18,
  torusFloor: 0.45,
  tau: 2.2,
  morphRate: 0.05,
};
