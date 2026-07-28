/* Compose: exposure → asinh stretch → palette matrix → SCNR → black point →
   IGN dither. Stars route around the palette; one exp over the summed layer
   tau extinguishes emission and continuum, but never the globule rim. */

import {
  Fn, vec2, vec3, vec4, texture, uv, exp, mix, min, max,
} from 'three/tsl';
import { ign, asinh3 } from './noise.js';
import { wispTau } from './dust.js';
import { globuleTauAndRim } from './globules.js';
import { reflectionTau } from './reflection.js';

/* Interstellar reddening: blue is extinguished ~1.9× harder than red. That
   reflection self-extinguishes under its own summed tau is deliberate. */
const SIGMA = vec3(1.0, 1.35, 1.9);

export function buildComposeNodes({ lineTex, contTex, brightTex, U, layers = {} }) {
  return Fn(() => {
    const screen = uv();

    /* Compose uv y runs opposite the star quads' clip y, so the parallax
       vector flips y here or the layers mirror the stars vertically */
    const par = U.uParallax.mul(vec2(1.0, -1.0));

    /* Overscanned layer RTs: mapping through the margin keeps parallax off RT
       edges, and subtracting moves the image with the star quads. */
    const sampleAt = (depth) => {
      const offUV = par.mul(depth).div(U.uResolution);
      return screen.sub(0.5).sub(offUV).div(U.uMarginScale).add(0.5);
    };

    const line = texture(lineTex, sampleAt(U.uDepthLine)).rgb;
    const cont = texture(contTex, sampleAt(U.uDepthCont)).rgb;
    const bright = texture(brightTex, screen).rgb;

    /* Procedural layers evaluate here rather than in an RT, so parallax applies
       directly at whatever depth each one sits at */
    const skyAt = (depth) => screen
      .sub(par.mul(depth).div(U.uResolution))
      .mul(vec2(U.uAspect, 1.0))
      .add(U.uCamera);
    const glob = layers.globules
      ? globuleTauAndRim(skyAt(U.uDepthGlob), U, layers.globules.cometary)
      : null;

    /* One exp over the summed optical depth: extinguishing layer by layer would
       double-count the reddening in every overlap */
    let tau = wispTau(skyAt(U.uDepthWisp), U);
    if (glob) tau = tau.add(glob.tau);
    if (layers.reflection) tau = tau.add(reflectionTau(skyAt(U.uDepthRefl), U));
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
    if (glob) lit = lit.add(toRGB(glob.rim));

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
