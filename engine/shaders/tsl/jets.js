/* Herbig-Haro protostellar jet and, with the beam switched off at build time,
   a runaway-star bow shock: the same paraboloid cap either way. One thin beam,
   a drifting knot chain, offset shock strands. Line channels only, never RGB. */

import {
  Fn, float, vec3, cos, dot, exp, floor, fract, mix, sin, smoothstep, step,
} from 'three/tsl';
import { fbm3o2, ridged2, hash1, FBM2_NORM } from './noise.js';
import { remapCombine, rot2 } from './sdf.js';

const TAU = Math.PI * 2;

/* Independent slices of the noise domain, same trick as reflection.js */
const SHOCK_DOMAIN = /*@__PURE__*/ vec3(3.9, 17.1, 8.3);
const BEAM_DOMAIN = /*@__PURE__*/ vec3(23.7, 6.1, 12.9);
const STREAK_DOMAIN = /*@__PURE__*/ vec3(41.3, 9.7, 28.1);

/* 1D value noise: valueNoise3 would pay for eight lattice corners to
   interpolate along one axis, and the knot jitter only ever needs the one. */
const noise1 = /*@__PURE__*/ Fn(([x, off]) => {
  const i = floor(x).toVar();
  const f = x.sub(i).toVar();
  const t = f.mul(f).mul(f.mul(-2.0).add(3.0));
  const a = hash1(vec3(i, 0.0, 0.0).add(off));
  const b = hash1(vec3(i.add(1.0), 0.0, 0.0).add(off));
  return mix(a, b, t);
});

/* Shell coverage from a signed distance. The envelope lowers the bar the ambient
   mottle has to clear (remap doctrine, sdf.js), so the mottle carves the shell. */
function shellDens(dx, invT, span, mottle, U) {
  const env = float(1).sub(smoothstep(0.0, 1.0, dx.mul(invT).abs())).mul(span).toVar();
  const th = mix(float(1.0), U.uJetBowTh, env);
  const ero = smoothstep(th, th.add(U.uJetSoft.max(1e-3)), mottle);
  return remapCombine(mottle, ero, env, U.uJetTexAmt);
}

/* Paraboloid cap opening back toward the source, apex leading at `stand` along
   the arm. Two strands at ±sep are one shock front, not two objects. */
function bowStrands(along, ty, stand, mottle, tEvo, U) {
  const at = U.uJetBowCurv.mul(ty).toVar();
  const f = stand.sub(along).sub(at.mul(ty)).toVar();

  /* One inverse gradient length does both jobs: it turns f into a distance and
     it IS the compression falloff along the wings, so no edge is ever painted. */
  const g2 = at.mul(2.0).toVar();
  const gk = float(1).div(float(1).add(g2.mul(g2)).sqrt()).toVar();
  const dn = f.mul(gk).toVar();

  const invT = float(1).div(U.uJetBowThick.max(1e-4)).toVar();
  const outer = U.uJetBowSpan.max(1e-4).toVar();
  const span = float(1).sub(smoothstep(outer.mul(0.7), outer, ty.abs())).toVar();
  const facing = gk.max(1e-4).pow(U.uJetBowFace.max(0.0)).toVar();

  /* Aniso on the across-front axis, so a shell a hundredth of a sky unit thick
     still resolves nested sub-arcs instead of one painted parenthesis. */
  const sp = vec3(
    dn.mul(U.uJetStreakFreq).mul(U.uJetStreakAniso),
    ty.mul(U.uJetStreakFreq),
    tEvo,
  ).add(U.uJetOff).add(STREAK_DOMAIN);
  const streak = ridged2(sp, U.uJetStreakSharp).toVar();
  const comb = mix(float(1).sub(U.uJetStreak), float(1.0), streak).toVar();

  return {
    lead: shellDens(dn.add(U.uJetBowSep), invT, span, mottle, U).mul(facing).mul(comb),
    trail: shellDens(dn.sub(U.uJetBowSep), invT, span, mottle, U).mul(facing).mul(comb),
  };
}

/* High excitation rides the leading strand, the cooling zone trails it. The
   trailing Hα fraction is what keeps that strand visible under HOO at all. */
function addCap(cap, acc, U) {
  const lead = cap.lead.mul(U.uJetBowGain).toVar();
  const trail = cap.trail.mul(U.uJetBowGain).toVar();
  acc.ha.addAssign(lead.add(trail.mul(U.uJetTrailHa)));
  acc.oiii.addAssign(lead.mul(U.uJetLeadOiii));
  acc.sii.addAssign(trail);
}

/* Source star: same Moffat-plus-clamp shape as echo.js's, present in both looks */
function sourceStar(sky, U) {
  const dPx = sky.sub(U.uJetSrc).mul(U.uPxPerUnit).toVar();
  const aTrue = U.uJetStarR.mul(U.uPxPerUnit).toVar();
  const aC = aTrue.max(0.7).toVar();
  const energy = aTrue.mul(aTrue).div(aC.mul(aC)).toVar();
  const x = float(1).div(dot(dPx, dPx).div(aC.mul(aC)).add(1.0)).toVar();
  return x.mul(x).add(x.mul(U.uJetStarHalo)).mul(energy).mul(U.uJetStarLum).toVar();
}

export function buildJetNodes(skyU, U, opts = {}) {
  const { beam, bow, counter, wake } = { ...JET_DEFAULTS.look, ...opts };

  const line = Fn(() => {
    const tEvo = U.uTev.mul(U.uJetMorph).toVar();
    const q = rot2(skyU.sub(U.uJetSrc), U.uJetAngle.negate()).toVar();

    /* Precession bends the axis into an S: the sine is taken on the signed
       along-axis coord, so the two arms bow in opposite directions. */
    const wig = sin(q.x.mul(U.uJetPrecFreq).add(tEvo.mul(U.uJetPrecRate))).mul(U.uJetPrecess);
    const ty = q.y.sub(wig).toVar();
    /* Clamped here, not host-side: a live editor pokes uniforms past build clamps,
       and asym outside (0, 1] collides the two bow caps or inverts the arms. */
    const asym = U.uJetAsym.max(0.05).min(1.0).toVar();

    const acc = {
      ha: float(0).toVar(),
      oiii: float(0).toVar(),
      sii: float(0).toVar(),
    };

    /* Ambient clumpiness the shocks plow into, anchored in the jet's own
       frame so one evaluation serves both caps and the wake. */
    let mottle = null;
    if (bow || wake) {
      mottle = fbm3o2(vec3(q.mul(U.uJetShockFreq), tEvo.mul(0.5))
        .add(U.uJetOff).add(SHOCK_DOMAIN)).mul(FBM2_NORM).toVar();
    }

    if (beam) {
      /* Signed along-axis coord here, unlike the knots: the arms should mirror
         in knot position without mirroring their fine texture too. */
      const tex = fbm3o2(vec3(
        q.x.mul(U.uJetTexFreq),
        ty.mul(U.uJetTexFreq).mul(U.uJetTexAniso),
        tEvo,
      ).add(U.uJetOff).add(BEAM_DOMAIN)).mul(FBM2_NORM).toVar();

      /* Knots mirror across the source, so they key off the folded coord; the
         arms differ only in reach, via the asymmetry on the far side. */
      const s = q.x.abs().toVar();
      const armK = mix(asym, float(1.0), step(float(0), q.x)).toVar();
      const armL = U.uJetLen.mul(armK).max(1e-4).toVar();
      const w = U.uJetWidth.mul(float(1).add(s.div(armL).mul(U.uJetFlare)))
        .max(1e-4).toVar();

      /* Flux-preserving clamp (catalogue 3.7): never render the beam narrower
         than ~0.7 px, dim it instead, or a pencil-thin jet aliases into nothing. */
      const wPx = w.mul(U.uPxPerUnit).toVar();
      const wUse = wPx.max(0.7).div(U.uPxPerUnit).toVar();
      const rr = ty.div(wUse).toVar();
      const core = exp(rr.mul(rr).negate()).mul(w.div(wUse)).toVar();

      /* Taper fraction capped below 1 so the two smoothstep edges cannot meet */
      const taper = float(1).sub(smoothstep(armL.mul(U.uJetTaper.min(0.98)), armL, s)).toVar();
      const birth = smoothstep(float(0), U.uJetGap.max(1e-4), s).toVar();

      /* Jitter is a continuous field in s rather than a per-knot hash, so a
         drifting knot can never cross a cell seam and pop. */
      const ku = s.mul(U.uJetKnotFreq).toVar();
      const jit = noise1(ku.mul(0.6), U.uJetOff).sub(0.5).mul(U.uJetKnotJit);
      /* fract folds the drift, and the jitter keys off position not phase, so the
         knot train alone survives uTev's 4096 h wrap; axis and texture still snap. */
      const kph = ku.add(jit).sub(fract(tEvo.mul(U.uJetDrift))).mul(TAU).toVar();
      const lobe = cos(kph).mul(0.5).add(0.5).max(1e-4).pow(U.uJetKnotSharp.max(0.0)).toVar();

      const fade = mix(float(1.0), U.uJetKnotFade, s.div(armL).min(1.0));
      const env = core.mul(taper).mul(birth).mul(fade)
        .mul(mix(U.uJetKnotFloor.max(0.0).min(1.0), float(1.0), lobe)).toVar();

      /* The envelope lowers the threshold the texture has to clear (remap
         doctrine, sdf.js), so the noise carves the beam rather than tinting it. */
      const th = mix(float(1.0), U.uJetTh, env);
      const ero = smoothstep(th, th.add(U.uJetSoft.max(1e-3)), tex).toVar();
      const amp = remapCombine(tex, ero, env, U.uJetTexAmt).mul(U.uJetBeamGain).toVar();

      acc.ha.addAssign(amp);
      acc.oiii.addAssign(amp.mul(U.uJetBeamOiii));
      acc.sii.addAssign(amp.mul(U.uJetBeamSii));
    }

    if (bow) {
      addCap(bowStrands(q.x, ty, U.uJetBowStand, mottle, tEvo, U), acc, U);
      if (counter) {
        const back = U.uJetBowStand.mul(asym).toVar();
        addCap(bowStrands(q.x.negate(), ty, back, mottle, tEvo, U), acc, U);
      }
    }

    if (wake) {
      const wq = q.x.negate().toVar();
      const wLen = U.uJetWakeLen.max(1e-4).toVar();
      const wW = U.uJetWakeW
        .mul(float(1).add(wq.div(wLen).max(0.0).mul(U.uJetWakeFlare))).max(1e-4).toVar();
      const rr = ty.div(wW).toVar();
      /* Soft birth rather than a step, or the cut across the star reads as a line */
      const env = exp(rr.mul(rr).negate())
        .mul(float(1).sub(smoothstep(float(0), wLen, wq)))
        .mul(smoothstep(float(0), U.uJetGap.max(1e-4), wq)).toVar();
      /* Streamers along the wake, same trick as the cap: a smooth trail reads
         as an airbrushed smear at any gain that makes it visible. */
      const streak = ridged2(vec3(
        wq.mul(U.uJetStreakFreq).mul(0.45),
        ty.mul(U.uJetStreakFreq).mul(U.uJetStreakAniso.mul(0.3)),
        tEvo,
      ).add(U.uJetOff).add(STREAK_DOMAIN), U.uJetStreakSharp).toVar();

      const th = mix(float(1.0), U.uJetTh, env);
      const ero = smoothstep(th, th.add(U.uJetSoft.max(1e-3)), mottle).toVar();
      const amp = remapCombine(mottle, ero, env, U.uJetTexAmt)
        .mul(mix(float(1).sub(U.uJetStreak), float(1.0), streak))
        .mul(U.uJetWakeGain).toVar();
      acc.ha.addAssign(amp);
      acc.sii.addAssign(amp.mul(U.uJetBeamSii));
    }

    return vec3(acc.ha.mul(U.uJetHa), acc.oiii.mul(U.uJetOiii), acc.sii.mul(U.uJetSii));
  })();

  /* The source is a star, so it is continuum, not a line species. Both looks
     build it; muting is the star-brightness param, not the graph. */
  const continuum = Fn(() => U.uJetStarCol.mul(sourceStar(skyU, U)))();

  return { line, continuum };
}

/* Bipolar HH jet, the default look. Positions in sky units, vectors as arrays.
   `look` is a build-time gate the host passes to buildJetNodes, not a uniform;
   the runaway bow shock is { beam: false, counter: false, wake: true }. */
export const JET_DEFAULTS = {
  look: { beam: true, bow: true, counter: true, wake: false },
  src: [0.58, 0.40], angle: 0.62, len: 0.4, asym: 0.82,
  width: 0.0045, flare: 1.6, taper: 0.7, gap: 0.018,
  precess: 0.012, precFreq: 7.0, precRate: 0.35,
  knotFreq: 26.0, knotSharp: 4.0, knotJit: 0.35, knotFloor: 0.3,
  knotFade: 0.6, drift: 3.0,
  texFreq: 20.0, texAniso: 0.25, threshold: 0.2, softness: 0.45, texAmt: 0.6,
  beamGain: 1.1, beamOiii: 0.55, beamSii: 0.25,
  starLum: 1.1, starR: 0.005, starHalo: 0.05, starCol: [1.0, 0.82, 0.66],
  shockFreq: 26.0,
  streak: 0.7, streakFreq: 26.0, streakAniso: 8.0, streakSharp: 2.4,
  bowStand: 0.42, bowCurv: 11.0, bowThick: 0.016, bowSep: 0.011,
  bowSpan: 0.12, bowFace: 1.4, bowTh: 0.22, bowGain: 0.7,
  leadOiii: 0.55, trailHa: 0.55,
  wakeGain: 0.3, wakeLen: 0.55, wakeW: 0.04, wakeFlare: 1.6,
  ha: 0.95, oiii: 1.0, sii: 0.7, morphRate: 0.12,
};
