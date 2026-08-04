/* Dust layers: integrated flux nebula (continuum) and dark extinction wisps.
   Wisps output optical depth, never dark paint — compose turns it into
   wavelength-dependent transmittance so thin edges redden before going black. */

import { Fn, float, vec2, vec3, vec4, cos, sin, exp, mix, smoothstep, abs } from 'three/tsl';
import { fbm3o2, fbm3o4, valueNoise3, FBM2_NORM, FBM2_MID, FBM4_NORM } from './noise.js';
import { rot2 } from './sdf.js';
import { faintStarLayer } from './stars.js';

/* Blue is extinguished ~1.9× harder than red. Compose imports this to grade
   the summed tau of every layer; one constant, one reddening law. */
export const WISP_SIGMA = /*@__PURE__*/ vec3(1.0, 1.35, 1.9);

/* Continuum pass: IFN wisps at a few percent of range (the dither QA target)
   plus the two faint star grid scales. */
export function buildContinuumNodes(skyU, pxPerUnit, U, opts = {}) {
  const { grain = false, swirl = false, faint = true } = opts;
  return Fn(() => {
    const zSlow = U.uTev.mul(U.uIfnMorph);
    /* Real IFN combs one axis: squashing y in a rotated frame stretches the
       wisps along x, which an isotropic domain can never do. */
    const qr = rot2(skyU, U.uIfnRot).toVar();
    const q = vec2(qr.x, qr.y.mul(U.uIfnAniso)).toVar();
    /* One warp tap tears the fbm into sheets; unwarped it is round blobs, and
       the reference's wisps are sheared and filamentary at every scale. */
    const wn = fbm3o2(vec3(q.mul(U.uIfnFreq.mul(0.45)), zSlow).add(U.uIfnOff.mul(3.0)))
      .sub(FBM2_MID).toVar();
    const warp = wn.mul(U.uIfnWarp).toVar();
    /* The same tap read as an angle instead of an offset: translating the
       domain tears the sheets, rotating it curls them, and the two together
       are what reads as flow rather than as torn paper. */
    const qs = swirl ? rot2(q, wn.mul(U.uIfnSwirl)).toVar() : q;
    /* Four octaves for the torn-cotton scales, then a gamma rather than a
       threshold: it crushes the low end into dark voids and keeps edges soft. */
    const n = fbm3o4(vec3(qs.mul(U.uIfnFreq).add(warp), zSlow).add(U.uIfnOff))
      .mul(FBM4_NORM).toVar();
    /* Remap, never multiply. The coarse tap as a bias widens each wisp into a
       skirt where it runs high and eats the edge where it runs low; the fine
       tap is the plate grain every long-exposure reference carries. */
    let carved = n.add(wn.mul(U.uIfnFeather));
    if (grain) {
      carved = carved.add(valueNoise3(vec3(qs.mul(U.uIfnFreq.mul(7.0)), zSlow)
        .add(U.uIfnOff.mul(5.0))).sub(0.5).mul(U.uIfnGrain));
    }
    carved = carved.toVar();
    /* Blending back toward the ungamma'd field lifts the void floor, so a wisp
       feathers out instead of ending on a contrast step. */
    const ifn = mix(carved.max(1e-4).pow(U.uIfnGamma), carved, U.uIfnSoft);
    const ifnCol = vec3(0.16, 0.14, 0.12).mul(ifn.mul(U.uIfnAmp));

    /* The star grids belong to the stars entity and only ride here because they
       share the RT, so a duplicate IFN must not stamp a second copy of them. */
    if (!faint) return vec4(ifnCol, 1.0);

    /* Galactic-plane gradient + fbm clumping; uniform scatter is the tell */
    const bandD = abs(skyU.y.sub(skyU.x.mul(U.uBandTilt)).sub(U.uBandY));
    const grad = mix(1.0, U.uBandGain, smoothstep(0.0, U.uBandWidth, bandD));
    const clump = fbm3o2(vec3(skyU.mul(2.6), 0.0).add(U.uClumpOff)).mul(0.9).add(0.55);
    const density = U.uStarDensity.mul(grad).mul(clump).min(1.0);

    const twHalf = U.uTwinkleDepth.mul(0.5);
    const stars = faintStarLayer(skyU, pxPerUnit, 42.0, density, 1.7, U.uStarOffA, U.uTwinklePhase, twHalf)
      .add(faintStarLayer(skyU, pxPerUnit, 14.0, density.mul(0.55), 4.0, U.uStarOffB, U.uTwinklePhase, twHalf));

    return vec4(ifnCol.add(stars), 1.0);
  })();
}

/* Optical depth of the dark wisp layer, evaluated where compose asks */
export function wispTau(skyW, U) {
  /* Rotate first, then stretch along the rotated x: a lane is long, sinuous,
     and tapering, and an isotropic threshold gives round amoebas instead. */
  const ca = cos(U.uWispAngle);
  const sa = sin(U.uWispAngle);
  const rx = skyW.x.mul(ca).sub(skyW.y.mul(sa));
  const ry = skyW.y.mul(ca).add(skyW.x.mul(sa));
  const zEvo = U.uTev.mul(U.uWispMorph);

  /* Warping before the squash makes the lane snake; after it, the lane would
     just get wider. */
  const wp = vec3(vec2(rx, ry).mul(U.uWispFreq.mul(0.4)), zEvo.mul(0.5))
    .add(U.uWispOff.mul(1.7));
  const meander = fbm3o2(wp).sub(FBM2_MID).mul(U.uWispWarp);

  /* No domain bias needed: even at freq 12 the fbm-scaled lattice stays inside
     hash1's +1024 window, and a 65536 bias paints visible float32 cell seams. */
  const pw = vec3(rx.div(U.uWispAniso), ry.add(meander), zEvo)
    .mul(vec3(U.uWispFreq, U.uWispFreq, 1.0)).add(U.uWispOff);
  const n = fbm3o4(pw).mul(FBM4_NORM);
  const detail = fbm3o2(pw.mul(3.1)).mul(FBM2_NORM);
  /* Remap, never multiply: a multiplied detail mask reads as painted */
  const carved = n.add(detail.sub(0.5).mul(U.uWispDetail));

  const core = smoothstep(U.uWispTh, U.uWispTh.add(U.uWispSoft), carved);
  /* Reddening needs low-but-nonzero tau; inside an opaque silhouette nothing is
     left to redden, so the warm band lives on this faint skirt outside the core. */
  const skirt = smoothstep(U.uWispTh.sub(U.uWispFringe), U.uWispTh.add(U.uWispSoft), carved);
  return U.uWispTau.mul(mix(skirt.mul(U.uWispSkirt), float(1.0), core));
}

/* Wisp-only transmittance for the opt-in break with additive-last */
export function wispTransmittance(skyW, U) {
  return exp(wispTau(skyW, U).negate().mul(WISP_SIGMA));
}
