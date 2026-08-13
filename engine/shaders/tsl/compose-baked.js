/* Baked composite: walk the depth-plane bakes back to front through the same
   grading chain live compose runs — duplicated on purpose, so the live path's
   bit-parity never depends on a baked-path edit. */

import {
  Fn, float, vec2, vec3, vec4, texture, uv, exp, mix, min, max,
} from 'three/tsl';
import { ign, asinh3 } from './noise.js';
import { twinkled } from './twinkle.js';
import { WISP_SIGMA } from './dust.js';
import { lensWarp } from './lensing.js';
import { spinConst, spinWarpUV } from './spin.js';

/* planes: deep → close, built planes only, each { texA, texB, texRim, uDepth,
   swirl, fade }. RT A is line rgb + summed tau in alpha, RT B is continuum rgb + star
   amplitude in alpha; `swirl` lists the galaxy bags whose spin this plane
   carries between rebakes. */
export function buildBakedComposeNodes({ planes, brightTex, U, lens = null, dust = null }) {
  return Fn(() => {
    const screen = uv();
    const par = U.uParallax.mul(vec2(1.0, -1.0));

    const sampleAt = (depthU, at = screen) => {
      const offUV = par.mul(depthU).div(U.uResolution);
      return at.sub(0.5).sub(offUV).div(U.uMarginScale).add(0.5);
    };

    const warp = lens ? lensWarp(screen, U, lens) : null;
    const at = warp ? warp.at : screen;
    const tang = warp ? warp.tang.mul(warp.smear).toVar() : null;

    /* Every tap runs the whole chain: lens destination, then this plane's
       parallax transform, then the galaxy's inverse rotation. Sharing the
       center tap's displacement smeared a lens offset of many texels. */
    const spinK = new Map();
    const spinKPrev = new Map();
    const tapUV = (pl, screenAt, edge = false, prev = false) => {
      let t = sampleAt(pl.uDepth, screenAt);
      const k = (prev ? spinKPrev : spinK).get(pl);
      const bags = prev ? pl.fade.swirlPrev : pl.swirl;
      if (k) bags.forEach((bag, j) => { t = spinWarpUV(t, bag, k[j]); });
      /* Clamped after the warp, never before: an edge galaxy has to be able to
         read the overscan margin instead of smearing the outermost texel. */
      return (edge ? t.clamp(0.0, 1.0) : t).toVar();
    };

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
    let outStar = float(0.0);
    let tTot = vec3(1.0);
    /* Only the first read of a texture is named. Every read shares one sampler
       uniform, but two same-named nodes collapse and the later tap loses its uv. */
    for (const [i, pl] of planes.entries()) {
      /* Hoisted per plane, not per tap: the two saturation terms are the only
         uniform-only work in the inverse. */
      if (pl.swirl?.length) spinK.set(pl, pl.swirl.map((bag) => spinConst(bag)));
      if (pl.fade && pl.swirl?.length) {
        spinKPrev.set(pl, pl.fade.swirlPrev.map((bag) => spinConst(bag)));
      }
      /* Each distinct tap position resolves its uv once; both RTs reuse it */
      const uvC = tapUV(pl, at);
      /* The outgoing generation gets its own tap: same screen point, its own
         bake reference, so the two are aligned in sky and only the morph fades. */
      const uvP = pl.fade ? tapUV(pl, at, false, true) : null;
      const uvT = warp
        ? [tapUV(pl, warp.at.add(tang), true), tapUV(pl, warp.at.sub(tang), true)]
        : null;
      /* Tangential 3-tap, weights 2:1:1, as the live compose smears. The center
         tap is the caller's, since tau reads that same sample. Whole vec4, so the
         star-amplitude alpha rides the same footprint its own light does.
         Every tap is named: two unnamed reads of one texture collapse into a
         single node and the later tap silently inherits the first tap's uv. */
      const smear3 = (tex, center, tag) => center.mul(2.0)
        .add(texture(tex, uvT[0]).setName(`${tag}${i}s0`))
        .add(texture(tex, uvT[1]).setName(`${tag}${i}s1`)).mul(0.25);

      const cur = texture(pl.texA, uvC).setName(`texPlaneA${i}`).toVar();
      /* Only the center tap fades; brief lens-wing ghosting avoids permanently
         doubling every plane's tap count. */
      const a = pl.fade
        ? mix(texture(pl.fade.texA2, uvP).setName(`texPrevA${i}`), cur, pl.fade.uFade).toVar()
        : cur;
      const lineRaw = warp ? smear3(pl.texA, a, 'texPlaneA').rgb : a.rgb;
      const curB = texture(pl.texB, uvC).setName(`texPlaneB${i}`).toVar();
      const b = pl.fade
        ? mix(texture(pl.fade.texB2, uvP).setName(`texPrevB${i}`), curB, pl.fade.uFade).toVar()
        : curB;
      const bSm = warp ? smear3(pl.texB, b, 'texPlaneB').toVar() : b;
      let contRaw = bSm.rgb;
      if (warp) {
        const disp = contRaw.toVar();
        const rOut = texture(pl.texB, tapUV(pl, warp.at.add(warp.disp), true))
          .setName(`texPlaneB${i}cr`).r;
        const bIn = texture(pl.texB, tapUV(pl, warp.at.sub(warp.disp), true))
          .setName(`texPlaneB${i}cb`).b;
        disp.r.assign(mix(disp.r, rOut, warp.chroma));
        disp.b.assign(mix(disp.b, bIn, warp.chroma));
        contRaw = disp;
      }
      const trans = exp(a.a.negate().mul(WISP_SIGMA)).toVar();
      const emitLine = palette(lineRaw);
      outLine = outLine.add(warp ? emitLine.mul(warp.gain) : emitLine).mul(trans);
      outCont = outCont.add(warp ? contRaw.mul(warp.gain) : contRaw).mul(trans);
      /* Star amplitude walks the same extinction as the light it describes, or a
         lane-buried star reads W = 1 and twinkles the gas in front of it. One
         channel, since W is a scalar ratio; green is the middle of WISP_SIGMA. */
      outStar = outStar.add(warp ? bSm.a.mul(warp.gain) : bSm.a).mul(trans.g);
      tTot = tTot.mul(trans);
    }

    let lit = scnr(outLine).add(outCont);

    /* The march front-attenuated its emission internally and its tau already
       rode into its owning plane's alpha, so this lands after the walk. */
    if (dust) {
      const dl = texture(dust.lineTex, sampleAt(dust.uDepth, at)).setName('texDustLine').rgb;
      const dc = texture(dust.contTex, sampleAt(dust.uDepth, at)).setName('texDustCont').rgb;
      lit = lit.add(scnr(palette(dl))).add(dc);
    }

    /* Rims skip all tau, the same exemption the live path grants them */
    let rimRaw = null;
    for (const [i, pl] of planes.entries()) {
      if (!pl.texRim) continue;
      const rim = texture(pl.texRim, sampleAt(pl.uDepth, at)).setName(`texRim${i}`).rgb;
      rimRaw = rimRaw ? rimRaw.add(rim) : rim;
    }
    if (rimRaw) lit = lit.add(scnr(palette(rimRaw)));

    /* Drawn ring emission, extinguished by the whole walk's transmittance. */
    if (warp) lit = lit.add(scnr(palette(warp.ring)).mul(tTot));

    const bright = texture(brightTex, screen).setName('texBright').rgb;
    const px = screen.mul(U.uResolution);
    /* Every plane shares one outStar, so the phase field anchors to the deepest
       plane's parallax: one stated approximation instead of a screen-locked lattice. */
    const starPx = (planes.length > 0 ? sampleAt(planes[0].uDepth, at) : at).mul(U.uResolution);
    const scene = twinkled(lit, outStar, starPx, U).add(bright).mul(U.uExposure);

    /* Color-preserving stretch: scale by the stretched luminance ratio.
       Per-channel asinh hue-shifts crimson toward rust. */
    const lum = max(scene.r, max(scene.g, scene.b)).max(1e-5);
    const target = asinh3(vec3(lum.mul(U.uStretchK))).x.mul(U.uStretchNorm);
    const stretched = scene.mul(target.div(lum));
    const lifted = max(stretched.sub(U.uBlack), 0.0);

    /* Per-channel spatial dither; near-black gradients band without it */
    const noise = vec3(
      ign(px),
      ign(px.add(vec2(17.0, 41.0))),
      ign(px.add(vec2(43.0, 11.0))),
    ).sub(0.5).mul(U.uDither);

    return vec4(max(lifted.add(noise), 0.0), 1.0);
  })();
}
