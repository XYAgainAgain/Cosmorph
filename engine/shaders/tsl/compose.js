/* Compose: exposure → asinh stretch → palette matrix → SCNR → black point →
   IGN dither. Stars route around the palette; transmittance multiplies both
   emission and continuum before grading. */

import {
  Fn, vec2, vec3, vec4, texture, uv, exp, mix, min, max,
} from 'three/tsl';
import { ign, asinh3 } from './noise.js';
import { wispTau } from './dust.js';

/* Interstellar reddening: blue is extinguished ~1.9× harder than red */
const SIGMA = vec3(1.0, 1.35, 1.9);

export function buildComposeNodes({ lineTex, contTex, brightTex, U }) {
  return Fn(() => {
    const screen = uv();

    /* Compose uv y runs opposite the star quads' clip y, so the parallax
       vector flips y here or the layers mirror the stars vertically */
    const par = U.uParallax.mul(vec2(1.0, -1.0));

    /* Layer RTs render an overscanned domain; sampling maps back through the
       margin so parallax offsets never clamp at an RT edge. Subtracting the
       offset moves the image the same direction the star quads translate. */
    const sampleAt = (depth) => {
      const offUV = par.mul(depth).div(U.uResolution);
      return screen.sub(0.5).sub(offUV).div(U.uMarginScale).add(0.5);
    };

    const line = texture(lineTex, sampleAt(U.uDepthLine)).rgb;
    const cont = texture(contTex, sampleAt(U.uDepthCont)).rgb;
    const bright = texture(brightTex, screen).rgb;

    /* Wisps are the near layer: procedural, so parallax applies directly */
    const wispShift = par.mul(U.uDepthWisp).div(U.uResolution);
    const skyW = screen.sub(wispShift).mul(vec2(U.uAspect, 1.0));
    const T3 = exp(wispTau(skyW, U).negate().mul(SIGMA));

    const lineRGB = U.uPalette.mul(line).toVar();
    const neutral = min(lineRGB.g, mix(lineRGB.r, lineRGB.b, 0.5));
    lineRGB.g.assign(mix(lineRGB.g, neutral, U.uScnr));

    const scene = lineRGB.add(cont).mul(T3).add(bright).mul(U.uExposure);

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
