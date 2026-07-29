/* Light echo, V838 Monocerotis style: a static turbulent dust cloud lit
   sequentially by the expanding paraboloid isodelay shell of one stellar flash.
   Scattered starlight, so the output is continuum RGB; the Hα whisper is opt-in. */

import { Fn, float, floor, vec3, dot, mix, smoothstep } from 'three/tsl';
import { fbm3o2, fbm3o4, FBM2_MID, FBM2_NORM, FBM4_NORM } from './noise.js';

const WRAP_H = 4096.0;

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

  /* Past this bound z runs away with rho² and the sliced noise aliases: the
     cutoff is the one thing keeping the sampled domain finite. */
  const outR = U.uEchoOuter.max(1e-3).toVar();
  const halo = float(1).sub(smoothstep(outR.mul(0.6), outR, rd)).mul(U.uEchoHalo);
  return shell.add(halo).min(1.0).toVar();
}

/* Static per seed with no time in the domain, which makes it the catalog's
   P8 bake candidate; until that lands it spends 6 live octaves per fragment. */
function echoDensity(g, env, U) {
  const p = vec3(g.d.mul(U.uEchoFreq), g.zEcho.mul(U.uEchoFreq).mul(U.uEchoZSquash))
    .add(U.uEchoOff);
  const base = fbm3o4(p).mul(FBM4_NORM).toVar();
  const carved = base.add(fbm3o2(p.mul(3.1)).sub(FBM2_MID).mul(U.uEchoCarve))
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
  return atten.mul(mix(float(1.0), slab, U.uEchoSlab)).toVar();
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
    return tint.mul(bright);
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
  shellW: 0.17,
  dustXY: [0.09, -0.06],
  dustZ: 0.1,
  outer: 0.9,
  halo: 0.22,
  freq: 5.5,
  zSquash: 0.55,
  carve: 0.35,
  th: 0.52,
  soft: 0.22,
  refR: 0.34,
  fall: 2.0,
  attenMax: 2.5,
  slab: 0.5,
  slabMax: 3.0,
  lum: 0.4,
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
