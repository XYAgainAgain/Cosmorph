/* The showpiece galaxy: one hero object in spiral, shell-elliptical, or ring
   morphology. Split out of galaxies.js, which keeps the deep-field tier and
   stays the orchestrator. Starlight is continuum; only the HII knots reach
   the line RT. */

import {
  Fn, If, float, vec2, vec3, clamp, cos, exp, floor, fract, length,
  mix, pow, sin, smoothstep,
} from 'three/tsl';
import { hash1, fbm3o2, ridged4, FBM2_NORM, CELL_BIAS } from './noise.js';
import { rot2, remapRange } from './sdf.js';

/* Reciprocal so the shell-parity math multiplies instead of dividing */
const INV_TAU = 1 / (Math.PI * 2);
/* de Vaucouleurs r^1/4 law: I ∝ exp(-7.669 * ((r/re)^0.25 - 1)) */
export const DEV_K = -7.669;
/* Past six the harmonics alias against any sane arm sharpness */
export const ARM_MAX = 6;

/* cos/sin of m*theta for a continuous arm count, built by the Chebyshev ladder
   c(n+1) = 2*cos(t)*c(n) - c(n-1). No atan, so the spiral phase still has no
   branch cut to tear along. */
export const armHarmonic = /*@__PURE__*/ Fn(([dir, count]) => {
  const cs = [dir.x.toVar()];
  const sn = [dir.y.toVar()];
  const twice = dir.x.mul(2.0).toVar();
  cs.push(twice.mul(cs[0]).sub(1.0).toVar());
  sn.push(twice.mul(sn[0]).toVar());
  for (let m = 3; m <= ARM_MAX; m++) {
    cs.push(twice.mul(cs[m - 2]).sub(cs[m - 3]).toVar());
    sn.push(twice.mul(sn[m - 2]).sub(sn[m - 3]).toVar());
  }
  /* Triangular hat over the ladder: only the two harmonics bracketing `count`
     carry weight, so a fractional count is exactly the floor/ceil blend. The
     sum shortens where they disagree, giving strong arms and one weak one. */
  const acc = vec2(0).toVar();
  for (let m = 1; m <= ARM_MAX; m++) {
    const w = float(1).sub(count.sub(float(m)).abs()).max(0.0).toVar();
    acc.addAssign(vec2(cs[m - 1], sn[m - 1]).mul(w));
  }
  return acc;
});

/* The smoothstep collapses if the outer edge is not above the inner one, so the
   clamp is shared: the early-out gate must cut on the exact same radius. */
const extentEdge = (U) => U.uGxCutOut.max(U.uGxCutIn.add(1e-3));

/* Exponential wings never reach zero; without a cut a disk leaves a faint box
   across the frame. Taken per radius so a polar ring is not clipped by the host. */
export function extentCut(U, r) {
  return float(1).sub(smoothstep(U.uGxCutIn, extentEdge(U), r));
}

/* Pink beads strung along whatever structure carries the young stars. One
   noise field, thresholded, so the knots cluster instead of dusting evenly. */
function hiiLine(U, host, knotN) {
  const beads = smoothstep(U.uGxHiiTh, U.uGxHiiTh.add(0.18), knotN).toVar();
  const ha = host.mul(beads).mul(U.uGxHii).toVar();
  return vec3(ha, ha.mul(U.uGxHiiOiii), ha.mul(U.uGxHiiSii));
}

/* Second HII tier off the same noise field: the rare giant complexes. The skirt
   is what makes them read larger than the beads, not merely brighter. */
function hiiFlower(U, host, knotN, u) {
  const soft = U.uGxFlowerSoft.max(1e-3).toVar();
  const core = smoothstep(U.uGxFlowerTh, U.uGxFlowerTh.add(0.08), knotN).toVar();
  const skirt = smoothstep(U.uGxFlowerTh.sub(soft), U.uGxFlowerTh, knotN).toVar();
  /* Star formation peaks in a mid-disk annulus; unbanded, the tier scatters
     confetti over the bulge and the gas-poor outer wings. */
  const hi = U.uGxFlowerHi.max(U.uGxFlowerLo.add(1e-3)).toVar();
  const band = smoothstep(U.uGxFlowerLo, U.uGxFlowerLo.add(0.1), u)
    .mul(float(1).sub(smoothstep(hi, hi.add(0.15), u))).toVar();
  const ha = host.mul(core.add(skirt.mul(0.45))).mul(band).mul(U.uGxFlowerGain).toVar();
  return U.uGxFlowerTint.mul(ha);
}

/* Unfiltered lattice speckle in the static disk frame: one hash per cell, no
   interpolation, so it reads as unresolved stars rather than as noise. */
function granulation(U, pn) {
  const cell = floor(pn.mul(U.uGxGranFreq)).toVar();
  const h = hash1(vec3(cell, 19.0).add(U.uGxOff).add(CELL_BIAS)).toVar();
  const th = U.uGxGranTh.toVar();
  return {
    bright: smoothstep(th, th.add(0.12), h).mul(U.uGxGranBright).toVar(),
    /* The low tail mirrored through the same dial, so one threshold sets how much
       of the disk is lit clumps and how much is dust shadow. */
    dark: float(1).sub(smoothstep(float(1).sub(th).sub(0.12), float(1).sub(th), h))
      .mul(U.uGxGranDark).toVar(),
  };
}

/* Grand-design spiral: logarithmic arms over a Moffat bulge, dust lane on the
   near half. uGxArmAmt at 0 drops the arms and leaves a lenticular. */
function spiralGalaxy(U, pn, u, dir, look, wantLine) {
  const cont = vec3(0).toVar();
  const lines = wantLine ? vec3(0).toVar() : null;

  /* Every term below is multiplied by extentCut, which is exactly zero at and
     past the edge, so skipping the ridged/fbm chain out there changes nothing. */
  If(u.lessThan(extentEdge(U)), () => {
    /* Logarithmic spiral: constant pitch puts the phase on ln(r), tan(pitch) =
       m / uGxWind. Default spin is 2*PI/4096, one turn per uTev wrap. */
    const lnu = u.max(1e-3).log().toVar();
    const A = lnu.mul(U.uGxWind)
      .sub(U.uGxPhase).sub(U.uTev.mul(U.uGxSpin)).toVar();
    const ca = cos(A).toVar();
    const sa = sin(A).toVar();

    /* Mixing toward dir is a free m=1 mode: dir IS cos/sin of one theta, so one
       arm brightens and its opposite thins, which is what lopsided disks do. */
    const m = mix(armHarmonic(dir, U.uGxArmCount), dir, U.uGxArmAsym).toVar();
    const armCos = m.x.mul(ca).add(m.y.mul(sa)).toVar();
    const armSin = m.y.mul(ca).sub(m.x.mul(sa)).toVar();
    const arm = pow(armCos.mul(0.5).add(0.5).max(1e-4), U.uGxArmSharp.max(0.0)).toVar();

    /* Build-gated: at the barAmt=0 default this whole log/cos/sin/pow chain would
       be paid per fragment to multiply out to nothing. */
    let bar = null;
    if (look.bar) {
      /* The bar is the same arm pattern frozen at its own radius, so its ends land
         exactly where the arms root and the whole figure co-rotates as one. */
      const barLen = U.uGxBarLen.max(1e-3).toVar();
      const ab = barLen.log().mul(U.uGxWind).sub(U.uGxPhase).sub(U.uTev.mul(U.uGxSpin)).toVar();
      const barCos = m.x.mul(cos(ab)).add(m.y.mul(sin(ab))).toVar();
      bar = pow(barCos.mul(0.5).add(0.5).max(1e-4), U.uGxBarSharp.max(0.0))
        .mul(float(1).sub(smoothstep(barLen.mul(0.55), barLen, u)))
        .mul(U.uGxBarAmt).toVar();
    }

    /* Disk-frame noise: the arm pattern rotates through material that stays put,
       which is what a density wave actually does. */
    const mot = fbm3o2(vec3(pn.mul(U.uGxMotFreq), U.uTev.mul(U.uGxMorph)).add(U.uGxOff)).toVar();
    const gran = granulation(U, pn);
    /* Speckle and flocculence share one coverage floor, so the dark tier chews the
       arms into clumps; capped well under 1 to keep the remap's slope finite. */
    const armLo = clamp(mot.mul(U.uGxMotAmt).add(gran.dark), 0.0, 0.9).toVar();
    const armK = clamp(
      remapRange(arm, armLo, float(1.0), float(0.0), float(1.0)), 0.0, 1.0,
    ).toVar();
    const armF = mix(float(1.0), armK, U.uGxArmAmt).toVar();

    const rb = U.uGxBulgeR.max(1e-3).toVar();
    /* Moffat bulge rather than de Vaucouleurs: bounded at the center, so nothing
       needs clamping ahead of the compose stretch. */
    const bulge = pow(u.mul(u).div(rb.mul(rb)).add(1.0), U.uGxBulgeBeta.max(0.5).negate())
      .mul(U.uGxBulgeAmt).toVar();
    const fall = exp(u.mul(U.uGxDiskFall).negate()).toVar();
    const disk = fall.mul(armF).toVar();
    /* Bright speckle rides the arm-modulated disk, so the clumps crowd the arms
       the way unresolved star clouds do instead of dusting the face evenly. */
    const grit = disk.mul(gran.bright).toVar();

    /* The lane trails the arms by a fixed phase and only shows on the near half
       of the disk, where the dust sits in front of the light. */
    const near = smoothstep(U.uGxNearSoft.max(1e-3).negate(), U.uGxNearSoft.max(1e-3),
      dir.y.mul(U.uGxNearSide));
    const lp = U.uGxLanePhase.toVar();
    const laneCos = armCos.mul(cos(lp)).add(armSin.mul(sin(lp))).toVar();
    /* The phase frame spins ever faster toward the center, so dust texture
       activity eases out across the bulge instead of shredding the inner disk. */
    const act = smoothstep(rb, rb.mul(2.5), u).toVar();

    let band = pow(laneCos.mul(0.5).add(0.5).max(1e-4), U.uGxLaneSharp.max(0.0)).toVar();
    let fil = null;
    /* Both texture tiers are build-gated like the bar: an untextured lane pays
       for neither ridge field. */
    if (look.fil) {
      /* Ridged filaments on the wound (armCos, armSin, ln r) frame: constant-
         phase lines ARE the arms there, so every ridge winds with the spiral. */
      const filN = ridged4(vec3(
        armCos.mul(U.uGxLaneFilFreq), armSin.mul(U.uGxLaneFilFreq),
        lnu.mul(U.uGxLaneFilAlong).add(U.uTev.mul(U.uGxMorph)),
      ).add(U.uGxOff.mul(5.0)), U.uGxLaneFilSharp).toVar();
      /* The same scalar jitters the band's phase: lanes hug a wandering side of
         the arm instead of running mechanically parallel to it. */
      const j = filN.sub(0.5).mul(U.uGxLaneWob).mul(act).toVar();
      const laneSin = armSin.mul(cos(lp)).sub(armCos.mul(sin(lp))).toVar();
      band = pow(laneCos.mul(cos(j)).add(laneSin.mul(sin(j)))
        .mul(0.5).add(0.5).max(1e-4), U.uGxLaneSharp.max(0.0)).toVar();
      /* Carve only the band's heart: the wings stay the smooth classic lane, or
         the texture reads as veins across the whole disk face. */
      const heart = smoothstep(0.2, 0.6, band).toVar();
      fil = mix(float(1.0).sub(U.uGxLaneFil.mul(act).mul(heart)), float(1.0), filN).toVar();
    }
    let lane = (fil ? band.mul(fil) : band).mul(near).mul(U.uGxLaneDepth).toVar();

    if (look.spurs) {
      /* Spur feathers jut across the arm: plain unwound polar sampling, so the
         ridges cut the band instead of following it. max() keeps crossings from
         double-darkening; the laneDepth factor keeps it the group's master dial. */
      const spN = ridged4(vec3(
        dir.mul(U.uGxSpurFreq),
        lnu.mul(U.uGxSpurFreq).mul(0.35).add(U.uTev.mul(U.uGxMorph)),
      ).add(U.uGxOff.mul(11.0)), U.uGxSpurFilSharp).toVar();
      const sp = U.uGxSpurPhase.toVar();
      const spCos = armCos.mul(cos(sp)).add(armSin.mul(sin(sp))).toVar();
      const spBand = pow(spCos.mul(0.5).add(0.5).max(1e-4), U.uGxSpurSharp.max(0.0)).toVar();
      const spurs = smoothstep(0.45, 0.8, spN).mul(spBand).mul(near)
        .mul(U.uGxSpurAmt).mul(U.uGxLaneDepth).mul(act);
      lane = lane.max(spurs).toVar();
    }

    const barLum = bar ? bar.mul(fall).toVar() : null;
    const body = bulge.add(disk).add(grit);
    const lum = (barLum ? body.add(barLum) : body).toVar();
    /* The divisor must sum every additive dial: leave grit or the bar out and lum
       runs past it, which clips the lane remap flat and stops the lane carving. */
    let peak = U.uGxBulgeAmt.add(1.0).add(U.uGxGranBright);
    if (barLum) peak = peak.add(U.uGxBarAmt);
    const n = lum.div(peak.max(1.0)).toVar();
    const carved = clamp(remapRange(n, lane, float(1.0), float(0.0), float(1.0)), 0.0, 1.0);

    const cut = extentCut(U, u).toVar();

    /* Tint by which component dominates, so the arms stay blue right up against
       a warm bulge instead of the whole inner disk going yellow. A bar counts
       with the bulge: it is the same old red population, not young disk stars. */
    const w = (barLum ? bulge.add(barLum) : bulge).div(lum.max(1e-3));
    const tintHi = U.uGxTintHi.max(U.uGxTintLo.add(1e-3));
    const tint = mix(U.uGxDisk, U.uGxBulge, smoothstep(U.uGxTintLo, tintHi, w));

    cont.assign(tint.mul(carved).mul(cut).mul(U.uGxGain));
    /* The knot noise is only built for the line pass; leaving it in the continuum
       body would emit a whole dead fbm there. */
    if (wantLine) {
      const knotN = fbm3o2(vec3(pn.mul(U.uGxHiiFreq), U.uTev.mul(U.uGxMorph)).add(U.uGxOff.mul(7.0)))
        .mul(FBM2_NORM).toVar();
      /* Scaled by uGxArmAmt too: a lenticular has no arms, so it must not keep
         stringing HII regions along the spiral pattern nothing else can see. */
      const host = armK.mul(disk).mul(cut).mul(U.uGxArmAmt).toVar();
      lines.assign(hiiLine(U, host, knotN).add(hiiFlower(U, host, knotN, u)));
    }
  });

  const out = { cont };
  if (wantLine) out.line = lines;
  return out;
}

/* NGC 3923 class: a de Vaucouleurs elliptical wearing nested merger shells.
   Consecutive shells fall on opposite sides, which is the detail that sells it. */
function shellGalaxy(U, u, dir) {
  /* The r^1/4 law is singular at the center; the floor bounds it and uGxDevNorm
     (its matching reciprocal peak, computed host-side) renormalizes to 1. */
  const x = u.div(U.uGxDevRe.max(1e-3)).max(U.uGxDevFloor.max(1e-4)).toVar();
  const dev = exp(pow(x, 0.25).sub(1.0).mul(DEV_K))
    .mul(U.uGxDevNorm).mul(U.uGxBulgeAmt).toVar();

  const sPhase = u.mul(U.uGxShellFreq).add(U.uGxShellPhase).toVar();
  const crest = pow(cos(sPhase).mul(0.5).add(0.5).max(1e-4), U.uGxShellSharp.max(0.0)).toVar();
  /* Shell index parity as ±1, from fract rather than a modulo: fract(x) is
     x - floor(x) on every backend, so negative indices alternate correctly too. */
  const side = fract(floor(sPhase.mul(INV_TAU).add(0.5)).mul(0.5)).mul(4.0).sub(1.0).toVar();
  const axisDir = rot2(dir, U.uGxShellRot.negate()).toVar();
  /* Each shell takes the half-plane its parity points at, tapered over uGxShellCut.
     The half-turn offset above flips parity at troughs, so no arc splits its crest. */
  const sideMask = smoothstep(float(0.0), U.uGxShellCut.max(1e-3), axisDir.x.mul(side)).toVar();

  const amp = smoothstep(float(0.0), U.uGxShellIn.max(1e-3), u)
    .mul(exp(u.mul(U.uGxShellFall).negate())).toVar();
  const shells = crest.mul(sideMask).mul(amp).mul(U.uGxShellAmt).toVar();

  const cont = U.uGxBulge.mul(dev).add(U.uGxShellTint.mul(shells))
    .mul(extentCut(U, u)).mul(U.uGxGain);
  return { cont };
}

/* Hoag's Object, the Cartwheel, and NGC 660: a detached ring of hot blue stars
   around a Sersic nucleus, with an empty gap the disk never fills. */
function ringGalaxy(sky, U, u, dir, look, wantLine) {
  const rb = U.uGxBulgeR.max(1e-3).toVar();
  const nucleus = pow(u.mul(u).div(rb.mul(rb)).add(1.0), U.uGxBulgeBeta.max(0.5).negate())
    .mul(U.uGxBulgeAmt).toVar();

  const ringW = U.uGxRingW.max(1e-4).toVar();
  const dr = u.sub(U.uGxRingR).div(ringW).toVar();
  const band = exp(dr.mul(dr).negate()).toVar();

  /* Noise sampled on the unit direction circle is seamless all the way round,
     with no atan and therefore no branch cut to tear the beading along. Radius
     rides the third axis or the beads have no radial extent and comb the ring. */
  const knotN = fbm3o2(vec3(
    dir.mul(U.uGxKnotFreq),
    u.mul(U.uGxKnotFreq).add(U.uTev.mul(U.uGxMorph)),
  ).add(U.uGxOff)).mul(FBM2_NORM).toVar();
  const beads = mix(float(1).sub(U.uGxKnotAmt), float(1.0), smoothstep(0.32, 0.72, knotN)).toVar();
  const ring = band.mul(beads).mul(U.uGxRingAmt).toVar();

  const cont = U.uGxBulge.mul(nucleus).add(U.uGxRing.mul(ring)).toVar();

  if (look.spokes) {
    /* Radius enters the noise domain slowly, so the field varies fast around
       the ring and barely along it: streaks that read as radial spokes. */
    const spN = fbm3o2(vec3(dir.mul(U.uGxSpokeFreq), u.mul(U.uGxSpokeAniso)).add(U.uGxOff.mul(3.0)))
      .mul(FBM2_NORM).toVar();
    const inner = smoothstep(U.uGxSpokeIn, U.uGxSpokeIn.add(0.06), u)
      .mul(float(1).sub(smoothstep(U.uGxRingR.sub(ringW), U.uGxRingR, u))).toVar();
    const spokes = smoothstep(U.uGxSpokeTh, U.uGxSpokeTh.add(0.22), spN)
      .mul(inner).mul(U.uGxSpokeAmt).toVar();
    cont.addAssign(U.uGxRing.mul(spokes));
  }

  const edge = extentCut(U, u).toVar();
  cont.mulAssign(edge);

  if (look.polar) {
    /* The same ring primitive on a second disk plane: two galaxies crossed at
       right angles is the entire polar-ring read. */
    const qp = rot2(sky.sub(U.uGxCenter), U.uGxPa.add(U.uGxPolarPa).negate()).toVar();
    const pp = vec2(qp.x, qp.y.div(U.uGxPolarCosI.max(0.06))).div(U.uGxSize.max(1e-4)).toVar();
    const up = length(pp).max(1e-4).toVar();
    const pd = up.sub(U.uGxPolarR).div(U.uGxPolarW.max(1e-4)).toVar();
    const pring = exp(pd.mul(pd).negate()).mul(U.uGxPolarAmt).mul(extentCut(U, up)).toVar();
    cont.addAssign(U.uGxRing.mul(pring));
  }

  const out = { cont: cont.mul(U.uGxGain) };
  if (wantLine) out.line = hiiLine(U, band.mul(edge).mul(U.uGxRingAmt), knotN);
  return out;
}

/* One showpiece at a uniform-specified pose. Morphology is a build-time branch,
   so a scene only ever compiles the silhouette it asked for. */
export function showpieceGalaxy(sky, U, look = {}, wantLine = false) {
  /* Deproject: rotate into the major-axis frame, then stretch the minor axis
     back out. Orthographic is exact enough for an object this distant. */
  const q = rot2(sky.sub(U.uGxCenter), U.uGxPa.negate()).toVar();
  const pn = vec2(q.x, q.y.div(U.uGxCosI.max(0.06))).div(U.uGxSize.max(1e-4)).toVar();
  const u = length(pn).max(1e-4).toVar();
  const dir = pn.div(u).toVar();

  if (look.ring) return ringGalaxy(sky, U, u, dir, look, wantLine);
  if (look.shell) return shellGalaxy(U, u, dir);
  return spiralGalaxy(U, pn, u, dir, look, wantLine);
}
