/* Dust layers: integrated flux nebula (continuum) and dark extinction wisps.
   Wisps output optical depth, never dark paint — compose turns it into
   wavelength-dependent transmittance so thin edges redden before going black. */

import { Fn, vec3, vec4, mix, smoothstep, abs } from 'three/tsl';
import { fbm3o2, fbm3o4 } from './noise.js';
import { faintStarLayer } from './stars.js';

/* Continuum pass: IFN wisps at a few percent of range (the dither QA target)
   plus the two faint star grid scales. */
export function buildContinuumNodes(skyU, pxPerUnit, U) {
  return Fn(() => {
    const zSlow = U.uTev.mul(U.uIfnMorph);
    const ifn = fbm3o2(vec3(skyU.mul(U.uIfnFreq), zSlow).add(U.uIfnOff));
    const ifnCol = vec3(0.16, 0.14, 0.12).mul(ifn.mul(U.uIfnAmp));

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
  const pw = vec3(skyW.x.mul(0.75), skyW.y.mul(1.5), U.uTev.mul(U.uWispMorph))
    .mul(vec3(U.uWispFreq, U.uWispFreq, 1.0)).add(U.uWispOff);
  const n = fbm3o4(pw);
  const detail = fbm3o2(pw.mul(3.1));
  const carved = n.add(detail.sub(0.5).mul(0.45));
  return smoothstep(U.uWispTh, U.uWispTh.add(U.uWispSoft), carved).mul(U.uWispTau);
}
