/* Light echo, V838 Monocerotis style: a static turbulent dust cloud lit
   sequentially by the expanding paraboloid isodelay shell of one stellar flash.
   Scattered starlight, so the output is continuum RGB; the Hα whisper is opt-in. */

import { Fn, float, floor, vec3, dot, mix, smoothstep } from 'three/tsl';
import { fbm3o2, fbm3o4, ridged2, FBM2_MID, FBM2_NORM, FBM4_NORM } from './noise.js';

const WRAP_H = 4096.0;

/* Independent slice of the noise domain for the filament ridges */
const FIL_DOMAIN = /*@__PURE__*/ vec3(13.7, 41.3, 5.9);

/* Isodelay geometry. |r| - z = ct solves to z = (rho² - ct²)/(2ct), one z per
   screen point, which is the whole reason this needs no march. */
function echoGeometry(sky, U) {
  const span = U.uEchoSpan.max(1e-4).toVar();
  /* Whole cycles per wrap, never a running sum: quantizing the rate is what
     keeps a full-brightness ring from snapping to a new radius at the reset. */
  const cycles = floor(U.uEchoRate.mul(WRAP_H).div(span).add(0.5)).max(1.0).toVar();
  const u = U.uTev.div(WRAP_H).mul(cycles).add(U.uEchoPhase).fract().toVar();
  const ct = U.uEchoStart.max(1e-3).add(u.mul(span)).toVar();

  const d = sky.sub(U.uEchoSrc).toVar();
  const rho2 = dot(d, d).toVar();
  const zEcho = rho2.mul(float(0.5).div(ct)).sub(ct.mul(0.5)).toVar();
  /* |r| = z + ct identically on the shell, so the source distance is one add */
  const rr = zEcho.add(ct).max(1e-4).toVar();
  return { d, rho2, zEcho, rr, ct, u };
}

/* One flash per cycle: fade both ends, or the restart pops a full-brightness
   ring back into the middle of the frame. */
function echoLife(u, U) {
  const fi = U.uEchoFadeIn.max(1e-3).toVar();
  const out0 = float(1).sub(U.uEchoFadeOut).clamp(0.0, 0.999).toVar();
  return smoothstep(0.0, fi, u).mul(float(1).sub(smoothstep(out0, 1.0, u))).toVar();
}

/* The cloud in the source's own frame. Offsetting its center off the sky plane
   and off the star is what makes the rings read asymmetric instead of concentric. */
function echoCloud(g, U) {
  const dc = g.d.sub(U.uEchoDustXY).toVar();
  const zd = g.zEcho.sub(U.uEchoDustZ).toVar();
  const rd = dot(dc, dc).add(zd.mul(zd)).max(1e-8).sqrt().toVar();

  const x = rd.sub(U.uEchoShellR).div(U.uEchoShellW.max(1e-3)).toVar();
  const shell = float(1).sub(smoothstep(0.0, 1.0, x.mul(x))).toVar();

  /* A second dust shell further out. V838 shows three or four nested arcs at
     once, and one shell can only ever light a single band. */
  const x2 = rd.sub(U.uEchoShellR.add(U.uEchoShell2Off)).div(U.uEchoShellW.max(1e-3)).toVar();
  const shell2 = float(1).sub(smoothstep(0.0, 1.0, x2.mul(x2))).mul(U.uEchoShell2).toVar();

  /* Past this bound z runs away with rho² and the sliced noise aliases: the
     cutoff is the one thing keeping the sampled domain finite. */
  const outR = U.uEchoOuter.max(1e-3).toVar();
  const halo = float(1).sub(smoothstep(outR.mul(0.6), outR, rd)).mul(U.uEchoHalo);
  return shell.max(shell2).add(halo).min(1.0).toVar();
}

/* Static per seed with no time in the domain, which makes it the catalogue's
   P8 bake candidate; until that lands it spends 6 live octaves per fragment. */
function echoDensity(g, env, U) {
  const p = vec3(g.d.mul(U.uEchoFreq), g.zEcho.mul(U.uEchoFreq).mul(U.uEchoZSquash))
    .add(U.uEchoOff);
  const base = fbm3o4(p).mul(FBM4_NORM).toVar();
  /* Centered on the ridge's own mean, 1/(sharp+1), not 0.5: a sharpened ridge
     sits well below mid-level, and subtracting 0.5 would net out as density loss. */
  const fil = ridged2(p.mul(U.uEchoFilFreq).add(FIL_DOMAIN), U.uEchoFilSharp)
    .sub(float(1).div(U.uEchoFilSharp.add(1.0))).toVar();
  const carved = base
    .add(fbm3o2(p.mul(3.1)).sub(FBM2_MID).mul(U.uEchoCarve))
    .add(fil.mul(U.uEchoFil))
    .clamp(0.0, 1.0).toVar();

  /* Envelope lowers the threshold the noise must clear (remap doctrine, sdf.js).
     carved is clamped to 1 so threshold 1 outside the cloud is genuinely empty. */
  const th = mix(float(1.0), U.uEchoTh, env);
  const dens = smoothstep(th, th.add(U.uEchoSoft.max(1e-3)), carved).toVar();
  return { base, dens };
}

/* A fixed delay width covers dz = (|r|/ct)·dct of dust column, so the lit slab
   thickens outward: the edge brightening falls out of geometry, not noise. */
function echoIllum(g, U) {
  const atten = g.rr.div(U.uEchoRefR.max(1e-4)).pow(U.uEchoFall.max(0.0).negate())
    .min(U.uEchoAttenMax.max(1.0)).toVar();
  const slab = g.rr.div(g.ct).min(U.uEchoSlabMax.max(1.0));

  /* rho/ct crosses 1 exactly on the source plane and moves outward with the
     front, so weighting across it gives the annulus a direction of travel. */
  const w = U.uEchoSweepW.max(1e-3).toVar();
  const lead = smoothstep(float(1).sub(w), float(1).add(w), g.rho2.sqrt().div(g.ct)).toVar();
  const sweep = mix(float(1).sub(U.uEchoSweep), float(1).add(U.uEchoSweep), lead);

  return atten.mul(mix(float(1.0), slab, U.uEchoSlab)).mul(sweep).toVar();
}

/* The flash source itself. Moffat core plus a wide skirt, with the sub-pixel
   flux clamp from catalogue 3.7 so a small core stays bright instead of aliasing. */
function echoStar(sky, U) {
  const dPx = sky.sub(U.uEchoSrc).mul(U.uPxPerUnit).toVar();
  const aTrue = U.uEchoStarR.mul(U.uPxPerUnit).toVar();
  const aC = aTrue.max(0.7).toVar();
  const energy = aTrue.mul(aTrue).div(aC.mul(aC)).toVar();
  const x = float(1).div(dot(dPx, dPx).div(aC.mul(aC)).add(1.0)).toVar();
  return x.mul(x).add(x.mul(U.uEchoStarHalo)).mul(energy).mul(U.uEchoStarLum).toVar();
}

/* Extinction from the same cloud, read off one static slice at tauZ. An honest
   column integral wants a march; a fixed slice at least never animates. */
export function echoTau(skyW, U) {
  /* Noise rides the source frame like the lit field; only the envelope is
     cloud-centered. tauZ scales like any other z so the slice stays in units
     the lit field can agree with. Octave counts still differ, deliberately. */
  const d = skyW.sub(U.uEchoSrc).toVar();
  const dc = d.sub(U.uEchoDustXY).toVar();
  const rho = dot(dc, dc).max(1e-8).sqrt().toVar();
  const zt = U.uEchoTauZ.mul(U.uEchoFreq).mul(U.uEchoZSquash);
  const n = fbm3o2(vec3(d.mul(U.uEchoFreq), zt).add(U.uEchoOff)).mul(FBM2_NORM);

  const outR = U.uEchoOuter.max(1e-3).toVar();
  const env = float(1).sub(smoothstep(outR.mul(0.35), outR, rho));
  const th = mix(float(1.0), U.uEchoTauTh, env);
  return smoothstep(th, th.add(U.uEchoSoft.max(1e-3)), n).mul(U.uEchoTau.max(0.0));
}

export function buildEchoNodes(skyU, U, opts = {}) {
  const haOn = opts.ha ?? ECHO_DEFAULTS.haOn;
  const continuum = Fn(() => {
    const g = echoGeometry(skyU, U);
    const { base, dens } = echoDensity(g, echoCloud(g, U), U);
    const bright = dens.mul(echoIllum(g, U)).mul(echoLife(g.u, U))
      .mul(U.uEchoLum).toVar();

    /* Thin dust scatters blue, thick dust reddens as it self-absorbs, and the
       densest cores take the rose bias. That is the whole V838 palette. */
    const hueHi = U.uEchoHueHi.max(U.uEchoHueLo.add(1e-3));
    const t = smoothstep(U.uEchoHueLo, hueHi, base);
    const tint = mix(mix(U.uEchoCool, U.uEchoWarm, t), U.uEchoRose, dens.mul(U.uEchoRoseAmt));

    /* The star is not gated by the flash cycle: V838 is the brightest thing in
       every frame of the reference sequence, before and after the echo. */
    return tint.mul(bright).add(U.uEchoStarCol.mul(echoStar(skyU, U)));
  })();

  const out = { continuum, tauAt: (sky) => echoTau(sky, U) };

  /* Scattered starlight carries no line signature, so the Hα whisper is a
     stylistic choice. Off by default and then never built at all. */
  if (haOn) {
    out.line = Fn(() => {
      const g = echoGeometry(skyU, U);
      const { dens } = echoDensity(g, echoCloud(g, U), U);
      const em = dens.mul(echoIllum(g, U)).mul(echoLife(g.u, U)).mul(U.uEchoHa);
      return vec3(em, 0.0, 0.0);
    })();
  }
  return out;
}

/* Param block in the host's units (vectors as arrays), not uniform nodes. Keys
   match the uniform suffixes one-for-one. `haOn` is the build-time gate the
   host passes to buildEchoNodes; `ha` is the live gain once the pass exists. */
export const ECHO_DEFAULTS = {
  haOn: false,
  src: [0.6, 0.54],
  rate: 0.0004,
  span: 0.8192,
  start: 0.04,
  phase: 0.2,
  fadeIn: 0.18,
  fadeOut: 0.24,
  shellR: 0.34,
  shellW: 0.15,
  shell2: 0.5,
  shell2Off: 0.24,
  dustXY: [0.09, -0.06],
  dustZ: 0.1,
  outer: 0.9,
  halo: 0.1,
  freq: 10.0,
  zSquash: 0.55,
  carve: 0.45,
  fil: 0.3,
  filFreq: 2.4,
  filSharp: 2.6,
  th: 0.48,
  soft: 0.2,
  refR: 0.34,
  fall: 2.0,
  attenMax: 2.5,
  slab: 0.5,
  slabMax: 3.0,
  sweep: 0.45,
  sweepW: 0.35,
  lum: 0.5,
  starLum: 3.0,
  starR: 0.005,
  starHalo: 0.2,
  starCol: [1.0, 0.46, 0.3],
  cool: [0.52, 0.66, 0.92],
  warm: [1.0, 0.86, 0.66],
  rose: [1.0, 0.7, 0.72],
  roseAmt: 0.3,
  hueLo: 0.42,
  hueHi: 0.72,
  ha: 0.35,
  tau: 0.45,
  tauTh: 0.6,
  tauZ: 0.0,
};
