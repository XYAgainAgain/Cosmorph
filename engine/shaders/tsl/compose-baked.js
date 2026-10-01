/* Baked composite: walk the depth-plane bakes back to front through the same
   grading chain live compose runs — duplicated on purpose, so the live path's
   bit-parity never depends on a baked-path edit. */

import {
  Fn, If, float, vec2, vec3, vec4, texture, uv, exp, mix, min, max,
} from 'three/tsl';
import { ign } from './noise.js';
import { twinkled } from './twinkle.js';
import { WISP_SIGMA } from './dust.js';
import { lensWarp } from './lensing.js';
import { spinConst, spinWarpUV } from './spin.js';

/* Under these a lens tap lands within a sliver of a texel, or of an output
   code, of the center tap, so its whole group is skipped. */
const LENS_SMEAR_MIN_PX = 1 / 16;
const LENS_CHROMA_MIN = 1 / 256;

/* planes: deep → close, built planes only, each { texA, texB, texRim, uDepth, swirl, fade }.
   RT A is line rgb + summed tau in alpha, RT B is continuum rgb + star amplitude in alpha;
   `swirl` lists the galaxy bags this plane spins between rebakes, `fade` the outgoing generation. */
export function buildBakedComposeNodes({ planes, brightTex, U, lens = null, dust = null }) {
  return Fn(() => {
    const screen = uv();
    const par = U.uParallax.mul(vec2(1.0, -1.0));

    /* One parallax offset per depth uniform, however many taps walk it */
    const offs = new Map();
    const sampleAt = (depthU, at = screen) => {
      if (!offs.has(depthU)) offs.set(depthU, par.mul(depthU).div(U.uResolution).toVar());
      return at.sub(0.5).sub(offs.get(depthU)).div(U.uMarginScale).add(0.5);
    };

    /* Explicit LOD 0: the bakes carry no mips, so this is the same texel without
       the derivative path, and it stays legal inside a branch. */
    const lod0 = (read) => read.level(float(0.0));

    const warp = lens ? lensWarp(screen, U, lens) : null;
    const at = warp ? warp.at : screen;

    /* Every tap runs the whole chain: lens destination, then this plane's
       parallax transform, then the galaxy's inverse rotation. Sharing the
       center tap's displacement smeared a lens offset of many texels. */
    const spinK = new Map();
    /* The outgoing generation's terms are rebuilt inside each branch that reads them:
       a variable first emitted in one branch is out of scope in the next. */
    const prevK = (pl) => (pl.swirl?.length
      ? pl.fade.swirlPrev.map((bag, j) => spinConst(bag, spinK.get(pl)[j])) : null);
    const tapUV = (pl, screenAt, edge = false, kPrev = null) => {
      let t = sampleAt(pl.uDepth, screenAt);
      const k = kPrev ?? spinK.get(pl);
      const bags = kPrev ? pl.fade.swirlPrev : pl.swirl;
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
    /* Every tap is named: two unnamed reads of one texture collapse into a
       single node and the later tap silently inherits the first tap's uv. */
    /* A fading plane's targets are two-layer arrays, current generation in uFront.
       depth() and level() each clone the node and drop its name, so the name goes last. */
    const tap = (pl, tex, at, name, layer = pl.fade?.uFront) => lod0(
      layer ? texture(tex, at).depth(layer) : texture(tex, at)).setName(name);
    const taps = [];
    for (const [i, pl] of planes.entries()) {
      /* Hoisted per plane, not per tap: every uniform-only term of the inverse */
      if (pl.swirl?.length) spinK.set(pl, pl.swirl.map((bag) => spinConst(bag)));
      /* Each distinct tap position resolves its uv once; both RTs reuse it */
      const uvC = tapUV(pl, at);
      const a = tap(pl, pl.texA, uvC, `texPlaneA${i}`).toVar();
      const b = tap(pl, pl.texB, uvC, `texPlaneB${i}`).toVar();
      /* A settled plane skips the outgoing fetch: at weight 1 the mix is the incoming
         tap. Same screen point, its own bake reference, so only the morph fades. */
      if (pl.fade) {
        If(pl.fade.uFade.lessThan(1.0), () => {
          const uvP = tapUV(pl, at, false, prevK(pl));
          a.assign(mix(tap(pl, pl.texA, uvP, `texPrevA${i}`, pl.fade.uBack), a, pl.fade.uFade));
          b.assign(mix(tap(pl, pl.texB, uvP, `texPrevB${i}`, pl.fade.uBack), b, pl.fade.uFade));
        });
      }
      /* A variable first made inside a branch is scoped to it, so the lens
         branches below assign into these, declared out here. */
      taps.push({ a, b, line: warp ? a.rgb.toVar() : a.rgb, bSm: warp ? b.toVar() : b });
    }

    if (warp) {
      /* Lens taps fade with their plane like the center tap, or a swap flips the smear in one frame */
      const lensTaps = (pl, reads) => {
        const uvAt = (uvs, pt, k) => {
          if (!uvs.has(pt)) uvs.set(pt, tapUV(pl, pt, true, k));
          return uvs.get(pt);
        };
        const cur = new Map();
        const out = reads.map(([tex, pt, name]) => tap(pl, tex, uvAt(cur, pt), name).toVar());
        if (!pl.fade) return out;
        If(pl.fade.uFade.lessThan(1.0), () => {
          const k = prevK(pl);
          /* Without swirl both generations share a uv, already resolved out here */
          const prevUV = k ? new Map() : cur;
          reads.forEach(([tex, pt, name], j) => {
            const prev = tap(pl, tex, uvAt(prevUV, pt, k), `${name}p`, pl.fade.uBack);
            out[j].assign(mix(prev, out[j], pl.fade.uFade));
          });
        });
        return out;
      };
      /* One branch for every plane: away from the critical curve the smear is a
         sliver of a texel, and those pixels pay the center taps only. */
      If(warp.smear.mul(U.uResolution.y).greaterThan(LENS_SMEAR_MIN_PX), () => {
        const tang = warp.tang.mul(warp.smear).toVar();
        for (const [i, pl] of planes.entries()) {
          const p0 = warp.at.add(tang).toVar();
          const p1 = warp.at.sub(tang).toVar();
          const [a0, a1, b0, b1] = lensTaps(pl, [
            [pl.texA, p0, `texPlaneA${i}s0`], [pl.texA, p1, `texPlaneA${i}s1`],
            [pl.texB, p0, `texPlaneB${i}s0`], [pl.texB, p1, `texPlaneB${i}s1`],
          ]);
          /* Tangential 3-tap, weights 2:1:1, as the live compose smears. Whole
             vec4, so the star-amplitude alpha rides its own light's footprint. */
          taps[i].line.assign(taps[i].a.mul(2.0).add(a0).add(a1).mul(0.25).rgb);
          taps[i].bSm.assign(taps[i].b.mul(2.0).add(b0).add(b1).mul(0.25));
        }
      });
      for (const t of taps) t.cont = t.bSm.rgb.toVar();
      If(warp.chroma.greaterThan(LENS_CHROMA_MIN), () => {
        for (const [i, pl] of planes.entries()) {
          const [rOut, bIn] = lensTaps(pl, [
            [pl.texB, warp.at.add(warp.disp).toVar(), `texPlaneB${i}cr`],
            [pl.texB, warp.at.sub(warp.disp).toVar(), `texPlaneB${i}cb`],
          ]);
          taps[i].cont.r.assign(mix(taps[i].cont.r, rOut.r, warp.chroma));
          taps[i].cont.b.assign(mix(taps[i].cont.b, bIn.b, warp.chroma));
        }
      });
    }

    for (const t of taps) {
      const contRaw = warp ? t.cont : t.bSm.rgb;
      const trans = exp(t.a.a.negate().mul(WISP_SIGMA)).toVar();
      const emitLine = palette(t.line);
      outLine = outLine.add(warp ? emitLine.mul(warp.gain) : emitLine).mul(trans);
      outCont = outCont.add(warp ? contRaw.mul(warp.gain) : contRaw).mul(trans);
      /* Star amplitude walks the same extinction as the light it describes, or a
         lane-buried star reads W = 1 and twinkles the gas in front of it. One
         channel, since W is a scalar ratio; green is the middle of WISP_SIGMA. */
      outStar = outStar.add(warp ? t.bSm.a.mul(warp.gain) : t.bSm.a).mul(trans.g);
      tTot = tTot.mul(trans);
    }

    let lit = scnr(outLine).add(outCont);

    /* The march front-attenuated its emission internally and its tau already
       rode into its owning plane's alpha, so this lands after the walk. */
    if (dust) {
      const dl = lod0(texture(dust.lineTex, sampleAt(dust.uDepth, at))).setName('texDustLine').rgb;
      const dc = lod0(texture(dust.contTex, sampleAt(dust.uDepth, at))).setName('texDustCont').rgb;
      lit = lit.add(scnr(palette(dl))).add(dc);
    }

    /* Rims skip all tau, the same exemption the live path grants them */
    let rimRaw = null;
    for (const [i, pl] of planes.entries()) {
      if (!pl.texRim) continue;
      const rimAt = sampleAt(pl.uDepth, at).toVar();
      const rimTap = tap(pl, pl.texRim, rimAt, `texRim${i}`).toVar();
      /* No spin warp on a rim, so both generations read the same uv */
      if (pl.fade) {
        If(pl.fade.uFade.lessThan(1.0), () => {
          rimTap.assign(mix(tap(pl, pl.texRim, rimAt, `texRimPrev${i}`, pl.fade.uBack), rimTap, pl.fade.uFade));
        });
      }
      const rim = rimTap.rgb;
      rimRaw = rimRaw ? rimRaw.add(rim) : rim;
    }
    if (rimRaw) lit = lit.add(scnr(palette(rimRaw)));

    /* Drawn ring emission, extinguished by the whole walk's transmittance. */
    if (warp) lit = lit.add(scnr(palette(warp.ring)).mul(tTot));

    const bright = lod0(texture(brightTex, screen)).setName('texBright').rgb;
    const px = screen.mul(U.uResolution);
    /* Every plane shares one outStar, so the phase field anchors to the deepest
       plane's parallax: one stated approximation instead of a screen-locked lattice. */
    const starPx = (planes.length > 0 ? sampleAt(planes[0].uDepth, at) : at).mul(U.uResolution);
    const scene = twinkled(lit, outStar, starPx, U).add(bright).mul(U.uExposure);

    /* Color-preserving stretch: scale by the stretched luminance ratio.
       Per-channel asinh hue-shifts crimson toward rust. */
    const lum = max(scene.r, max(scene.g, scene.b)).max(1e-5);
    /* asinh(x) = ln(x + sqrt(x² + 1)) on the one lane the stretch reads */
    const lumK = lum.mul(U.uStretchK).toVar();
    const target = lumK.add(lumK.mul(lumK).add(1.0).sqrt()).log().mul(U.uStretchNorm);
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
