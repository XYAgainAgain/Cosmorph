/* Baked composite: walk the depth-plane bakes back to front through the same
   grading chain live compose runs — duplicated on purpose, so the live path's
   bit-parity never depends on a baked-path edit. */

import {
  Fn, vec2, vec3, vec4, texture, uv, exp, mix, min, max,
} from 'three/tsl';
import { ign, asinh3 } from './noise.js';
import { WISP_SIGMA } from './dust.js';
import { lensWarp } from './lensing.js';

/* planes: deep → close, built planes only, each { texA, texB, texRim, uDepth }.
   RT A is line rgb + summed tau in alpha, RT B is continuum rgb. */
export function buildBakedComposeNodes({ planes, brightTex, U, lens = null, dust = null }) {
  return Fn(() => {
    const screen = uv();
    const par = U.uParallax.mul(vec2(1.0, -1.0));

    const sampleAt = (depthU, at = screen) => {
      const offUV = par.mul(depthU).div(U.uResolution);
      return at.sub(0.5).sub(offUV).div(U.uMarginScale).add(0.5);
    };

    const warp = lens ? lensWarp(screen, U, lens) : null;
    const off = warp ? warp.tang.mul(warp.smear).toVar() : null;
    /* Tangential 3-tap, weights 2:1:1, as the live compose smears. The center
       tap is the caller's, since tau reads that same sample. */
    const smear3 = (tex, depthU, center) => center.mul(2.0)
      .add(texture(tex, sampleAt(depthU, warp.at.add(off).clamp(0.0, 1.0))).rgb)
      .add(texture(tex, sampleAt(depthU, warp.at.sub(off).clamp(0.0, 1.0))).rgb)
      .mul(0.25);

    const at = warp ? warp.at : screen;

    /* Split, unlike the live path's single toRGB: extinction is per-RGB-channel,
       so the matrix rides inside the walk while concave SCNR runs once per sum. */
    const palette = (lineVec) => U.uPalette.mul(lineVec);
    const scnr = (rgb) => {
      const graded = rgb.toVar();
      const neutral = min(graded.g, mix(graded.r, graded.b, 0.5));
      graded.g.assign(mix(graded.g, neutral, U.uScnr));
      return graded;
    };

    /* out = (out + E) × T per plane: a plane's own emission is extinguished by
       its own tau, which is what the live single-sum does for co-planar layers.
       Line and continuum ride separate sums because SCNR must not see continuum. */
    let outLine = vec3(0.0);
    let outCont = vec3(0.0);
    let tTot = vec3(1.0);
    for (const pl of planes) {
      const a = texture(pl.texA, sampleAt(pl.uDepth, at)).toVar();
      const lineRaw = warp ? smear3(pl.texA, pl.uDepth, a.rgb) : a.rgb;
      const contCenter = texture(pl.texB, sampleAt(pl.uDepth, at)).rgb;
      let contRaw = warp ? smear3(pl.texB, pl.uDepth, contCenter) : contCenter;
      if (warp) {
        const disp = contRaw.toVar();
        const rOut = texture(pl.texB, sampleAt(pl.uDepth, warp.at.add(warp.disp).clamp(0.0, 1.0))).r;
        const bIn = texture(pl.texB, sampleAt(pl.uDepth, warp.at.sub(warp.disp).clamp(0.0, 1.0))).b;
        disp.r.assign(mix(disp.r, rOut, warp.chroma));
        disp.b.assign(mix(disp.b, bIn, warp.chroma));
        contRaw = disp;
      }
      const trans = exp(a.a.negate().mul(WISP_SIGMA)).toVar();
      const emitLine = palette(lineRaw);
      outLine = outLine.add(warp ? emitLine.mul(warp.gain) : emitLine).mul(trans);
      outCont = outCont.add(warp ? contRaw.mul(warp.gain) : contRaw).mul(trans);
      tTot = tTot.mul(trans);
    }

    let lit = scnr(outLine).add(outCont);

    /* The march front-attenuated its emission internally and its tau already
       rode into its owning plane's alpha, so this lands after the walk. */
    if (dust) {
      const dl = texture(dust.lineTex, sampleAt(dust.uDepth, at)).rgb;
      lit = lit.add(scnr(palette(dl))).add(texture(dust.contTex, sampleAt(dust.uDepth, at)).rgb);
    }

    /* Rims skip all tau, the same exemption the live path grants them */
    let rimRaw = null;
    for (const pl of planes) {
      if (!pl.texRim) continue;
      const rim = texture(pl.texRim, sampleAt(pl.uDepth, at)).rgb;
      rimRaw = rimRaw ? rimRaw.add(rim) : rim;
    }
    if (rimRaw) lit = lit.add(scnr(palette(rimRaw)));

    /* Drawn ring emission, extinguished by the whole walk's transmittance. */
    if (warp) lit = lit.add(scnr(palette(warp.ring)).mul(tTot));

    const bright = texture(brightTex, screen).rgb;
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
