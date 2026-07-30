/* Compose: exposure → asinh stretch → palette matrix → SCNR → black point →
   IGN dither. Stars route around the palette; one exp over the summed layer
   tau extinguishes emission and continuum, but never the globule rim. */

import {
  Fn, float, vec2, vec3, vec4, texture, uv, exp, mix, min, max,
} from 'three/tsl';
import { ign, asinh3 } from './noise.js';
import { wispTau, WISP_SIGMA } from './dust.js';
import { globuleTauAndRim } from './globules.js';
import { reflectionTau } from './reflection.js';
import { echoTau } from './echo.js';
import { shadowFanTau } from './shadowfan.js';
import { searchlightTau } from './searchlight.js';
import { shapeTauAndRim } from './shape.js';
import { riftTau } from './starcloud.js';
import { lensWarp } from './lensing.js';

/* Interstellar reddening lives in dust.js (one constant, one law). That
   reflection self-extinguishes under its own summed tau is deliberate. */
const SIGMA = WISP_SIGMA;

export function buildComposeNodes({ lineTex, contTex, brightTex, U, layers = {}, lens = null }) {
  return Fn(() => {
    const screen = uv();

    /* A layer RT comes back v-flipped, so an offset applied to the sample uv
       lands upside down unless the parallax vector flips y first. */
    const par = U.uParallax.mul(vec2(1.0, -1.0));

    /* Overscanned layer RTs: mapping through the margin keeps parallax off RT
       edges, and subtracting moves the image with the star quads. */
    const sampleAt = (depth, at = screen) => {
      const offUV = par.mul(depth).div(U.uResolution);
      return at.sub(0.5).sub(offUV).div(U.uMarginScale).add(0.5);
    };

    /* Lensing warps the two scene RTs and nothing else. The bright star tier
       keeps its own untouched RT because foreground stars are not lensed, and
       that asymmetry — spikes straight, background smeared — is the whole read. */
    const warp = lens ? lensWarp(screen, U, lens) : null;

    /* Tangential 3-tap, weights 2:1:1. A lens magnifies along the arc, so
       averaging that way is the blur that removes a thin arc's hatching. */
    const off = warp ? warp.tang.mul(warp.smear).toVar() : null;
    const smear3 = (tex, depth) => {
      return texture(tex, sampleAt(depth, warp.at)).rgb.mul(2.0)
        .add(texture(tex, sampleAt(depth, warp.at.add(off).clamp(0.0, 1.0))).rgb)
        .add(texture(tex, sampleAt(depth, warp.at.sub(off).clamp(0.0, 1.0))).rgb)
        .mul(0.25);
    };

    const lineRaw = warp
      ? smear3(lineTex, U.uDepthLine)
      : texture(lineTex, sampleAt(U.uDepthLine)).rgb;
    let contRaw = warp
      ? smear3(contTex, U.uDepthCont)
      : texture(contTex, sampleAt(U.uDepthCont)).rgb;

    /* Dispersion is continuum-only: the line RT's channels are Hα/OIII/SII, where
       an R-out/B-in split would throw two adjacent red lines opposite ways. */
    if (warp) {
      const disp = contRaw.toVar();
      const rOut = texture(contTex, sampleAt(U.uDepthCont, warp.at.add(warp.disp).clamp(0.0, 1.0))).r;
      const bIn = texture(contTex, sampleAt(U.uDepthCont, warp.at.sub(warp.disp).clamp(0.0, 1.0))).b;
      disp.r.assign(mix(disp.r, rOut, warp.chroma));
      disp.b.assign(mix(disp.b, bIn, warp.chroma));
      contRaw = disp;
    }

    const line = warp ? lineRaw.mul(warp.gain).add(warp.ring) : lineRaw;
    const cont = warp ? contRaw.mul(warp.gain) : contRaw;
    const bright = texture(brightTex, screen).rgb;

    /* Sky y increases downward, the way the layer RTs and the baked shape frames
       author it; the same v-flip is why this base takes parallax unturned. */
    const skyDown = vec2(screen.x, float(1.0).sub(screen.y));

    /* Procedural layers evaluate here rather than in an RT, so parallax applies
       directly at whatever depth each one sits at */
    const skyAt = (depth) => skyDown
      .sub(U.uParallax.mul(depth).div(U.uResolution))
      .mul(vec2(U.uAspect, 1.0))
      .add(U.uCamera);
    const globs = (layers.globules ?? []).map((bag) =>
      globuleTauAndRim(skyAt(bag.uDepthGlob), bag, bag.cometary));
    const shapes = (layers.shape ?? []).map((bag) =>
      shapeTauAndRim(skyAt(bag.uDepthShp), bag, bag.shpMap, bag.shpOpts));

    /* One exp over the summed optical depth: extinguishing layer by layer would
       double-count the reddening in every overlap */
    let tau = wispTau(skyAt(U.uDepthWisp), U);
    for (const g of globs) tau = tau.add(g.tau);
    for (const bag of layers.reflection ?? []) {
      tau = tau.add(reflectionTau(skyAt(bag.uDepthRefl), bag));
    }
    for (const bag of layers.echo ?? []) {
      tau = tau.add(echoTau(skyAt(bag.uDepthEcho), bag));
    }
    for (const bag of layers.shadowFan ?? []) {
      tau = tau.add(shadowFanTau(skyAt(bag.uDepthFan), bag));
    }
    for (const bag of layers.searchlight ?? []) {
      tau = tau.add(searchlightTau(skyAt(bag.uDepthBeam), bag));
    }
    /* Same depth uniform the band's continuum was pre-shifted to, or the Great
       Rift would parallax off the glow it splits. Depth only sets parallax: one
       exp over the summed tau dims every layer alike, so amplitude is the lever. */
    for (const bag of layers.starcloud ?? []) {
      tau = tau.add(riftTau(skyAt(bag.uDepthSC), bag));
    }
    for (const s of shapes) tau = tau.add(s.tau);
    const T3 = exp(tau.negate().mul(SIGMA));

    /* Line emission takes the palette matrix and SCNR wherever it enters, so
       the extinction-exempt rim grades identically to the line RT */
    const toRGB = (lineVec) => {
      const rgb = U.uPalette.mul(lineVec).toVar();
      const neutral = min(rgb.g, mix(rgb.r, rgb.b, 0.5));
      rgb.g.assign(mix(rgb.g, neutral, U.uScnr));
      return rgb;
    };

    /* The rim skips ALL summed tau, not just its own globule's — correct only
       while globules are the nearest tau layer, which the depth defaults keep true */
    let lit = toRGB(line).add(cont).mul(T3);
    for (const g of globs) lit = lit.add(toRGB(g.rim));
    for (const s of shapes) lit = lit.add(toRGB(s.rim));

    const scene = lit.add(bright).mul(U.uExposure);

    /* Color-preserving stretch: scale by the stretched luminance ratio.
       Per-channel asinh hue-shifts crimson toward rust. */
    const lum = max(scene.r, max(scene.g, scene.b)).max(1e-5);
    const target = asinh3(vec3(lum.mul(U.uStretchK))).x.mul(U.uStretchNorm);
    const stretched = scene.mul(target.div(lum));
    const lifted = max(stretched.sub(U.uBlack), 0.0);

    /* Per-channel spatial dither; near-black gradients band without it */
    const px = screen.mul(U.uResolution);
    const noise = vec3(
      ign(px),
      ign(px.add(vec2(17.0, 41.0))),
      ign(px.add(vec2(43.0, 11.0))),
    ).sub(0.5).mul(U.uDither);

    return vec4(max(lifted.add(noise), 0.0), 1.0);
  })();
}
