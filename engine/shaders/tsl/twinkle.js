/* One twinkle law for both star tiers. The live bright quads and the baked
   faint field must read as one phenomenon, so neither owns its own sin. */

import { Fn, If, float, vec3, dot, sin } from 'three/tsl';
import { valueNoise2 } from './noise.js';

const TAU = Math.PI * 2;
/* Below this a texel holds no starlight worth modulating, so the phase field
   and its three sins are skipped outright. */
const STAR_EPS = 1e-4;

/* Three temporal octaves, each riding its own CPU-wrapped phase rather than a
   multiple of one: an incommensurate rate folded in here would jump at wrap. */
export const twinkleMod = /*@__PURE__*/ Fn(([ph, phOff, amt]) => {
  const w = sin(ph.x.add(phOff).mul(TAU)).mul(0.55)
    .add(sin(ph.y.add(phOff.mul(1.7)).mul(TAU)).mul(0.30))
    .add(sin(ph.z.add(phOff.mul(2.9)).mul(TAU)).mul(0.15));
  /* Same envelope the single-sin bright tier had: never brighter than baseline,
     dimming by at most `amt`, so twinkle cannot inflate total flux. */
  return float(1.0).sub(amt).add(amt.mul(w.mul(0.5).add(0.5)));
});

/* Band-limited phase field in [0,1). Wavelength belongs between PSF width and mean star spacing:
   below it a PSF gets an internal gradient and crawls; above it, neighbors lock into one shimmering sheet. */
export const twinklePhaseField = /*@__PURE__*/ Fn(([px, wave]) => {
  return valueNoise2(px.div(wave.max(1.0)));
});

/* C × (1 + W(m − 1)) with W = Astar / luma(C). An approximation and labeled as
   one: the exact result is Cgas + m·Cstar, which one scalar cannot separate.
   `px` must be the parallax-shifted coordinate of the plane being masked, or
   the stars slide across a screen-locked lattice as the pointer moves. */
export function twinkled(rgbIn, aStar, px, U) {
  const rgb = rgbIn.toVar();
  const out = rgb.toVar();
  If(aStar.greaterThan(STAR_EPS), () => {
    const lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722)).max(1e-5);
    const w = aStar.div(lum).clamp(0.0, 1.0);
    const m = twinkleMod(
      U.uTwinklePhase, twinklePhaseField(px, U.uTwinkleWave), U.uTwinkleFieldDepth);
    out.assign(rgb.mul(float(1.0).add(w.mul(m.sub(1.0)))));
  });
  return out;
}
