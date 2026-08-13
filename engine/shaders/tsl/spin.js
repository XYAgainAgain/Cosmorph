/* The one galaxy angular law. Glow phase, sprite orbits, and the compose-side
   swirl warp share the contract in .dev/docs/plans/Perf-Plan.md. */

import { If, float, vec2, fract, length, sign, smoothstep } from 'three/tsl';
import { rot2 } from './sdf.js';

const TAU = Math.PI * 2;

/* Each live swirl needs a full-size plane pair, so this caps its VRAM cost. */
export const SPIN_MAX_LAYERS = 2;
/* The evolution clock's own wrap. uTev spans this times the scene's evolution
   rate, which is why nothing here may assume the raw 4096. */
export const SPIN_CLOCK_H = 4096.0;
export const SPIN_SAT_H = 512.0;
const DISC_GUARD = 1.15;
/* Predicted on-screen pixels of spin drift that buy a rebake. */
export const SPIN_REBAKE_PX = 1.0;
/* Real hours a demoted galaxy waits between rebakes. Rigid pricing alone buys
   one every few seconds at a high evolution rate, which is not worth a plane. */
export const SPIN_DEMOTED_MIN_H = 0.05;

export const spinWrap = (rate) => SPIN_CLOCK_H * (rate > 0 ? rate : 1);

/* Prewrapping in double preserves the small angle float32 loses near 10^5 rad;
   rot2 is 2π-periodic, so the shorter phase is equivalent. */
export const spinPhaseAt = (rate, tev) => {
  const p = rate * tev;
  return p - TAU * Math.round(p / TAU);
};

const satJs = (x) => {
  const u = Math.min(Math.max(x / SPIN_SAT_H, 0), 1);
  return u * u * (3 - 2 * u);
};
export const spinSatJs = (t, wrap) => satJs(t) * satJs(wrap - t);

/* A swirl plane prices only lead shear because compose reproduces rigid rotation. */
export function spinDriftPx(bag, tev, bakedTev, pxPerUnit, rigid) {
  const wrap = bag.uTevWrap.value;
  const dt = Math.abs(tev - bakedTev);
  /* A demoted galaxy turns in steps, and the Firmament hint says so: without a
     floor its rigid term buys a full-plane rebake every few real seconds. */
  if (rigid && dt < SPIN_DEMOTED_MIN_H * (wrap / SPIN_CLOCK_H)) return 0;
  const radiusPx = bag.uGxSize.value * Math.max(bag.uGxCutOut.value, 1e-3) * pxPerUnit;
  const shear = Math.abs(bag.uGxLead.value)
    * Math.abs(spinSatJs(tev, wrap) - spinSatJs(bakedTev, wrap));
  const turn = rigid ? Math.abs(bag.uGxSpin.value) * dt : 0;
  return (shear + turn) * radiusPx;
}

const sat = (U, t) => smoothstep(float(0.0), float(SPIN_SAT_H), t)
  .mul(smoothstep(float(0.0), float(SPIN_SAT_H), U.uTevWrap.sub(t)));

const leadAt = (U, r) => U.uGxLead.div(r.div(U.uGxLeadR.max(1e-3)).add(1.0));

/* Reversing the arm chirality reverses rotation, keeping both patterns trailing. */
const spinDir = (U) => sign(U.uGxWind).negate();

/* The bake stops turning where the warp would sample beyond the plane;
   otherwise sprites past the guard snap back at every rebake. */
const discW = (U, r) => {
  const edge = U.uGxCutOut.max(U.uGxCutIn.add(1e-3));
  return float(1.0).sub(smoothstep(edge, edge.mul(DISC_GUARD), r));
};

export const spinAngle = (U, r) => U.uGxSpinPhase
  .add(leadAt(U, r).mul(sat(U, U.uTev))).mul(spinDir(U)).mul(discW(U, r));

/* Two prewrapped phases differ across the seam, so rewrap their delta to [−π, π). */
const wrapPi = (x) => fract(x.div(TAU).add(0.5)).sub(0.5).mul(TAU);

/* Hoist θ(T) − θ(bakeT) terms once per plane; differencing first preserves
   small angles without making every lens tap pay a smoothstep. */
export function spinConst(U) {
  return {
    dPhase: wrapPi(U.uGxSpinPhase.sub(U.uGxBakeSpinPhase)).toVar(),
    dSat: sat(U, U.uTev).sub(sat(U, U.uGxBakeTev)).toVar(),
  };
}

/* Inverse warp on a bake's texture uv, per the G4 contract. */
export function spinWarpUV(tuv, U, k) {
  const cosI = U.uGxCosI.max(0.06).toVar();
  const size = U.uGxSize.max(1e-4).toVar();
  /* Render targets read back v-flipped; rotation exposes the otherwise hidden
     mirror and must account for its inverted turn. */
  const t = vec2(tuv.x, tuv.y.oneMinus()).toVar();
  const sky = t.sub(0.5).mul(U.uMarginScale).add(0.5)
    .mul(vec2(U.uAspect, 1.0)).add(U.uCamera).toVar();
  const q = rot2(sky.sub(U.uGxCenter), U.uGxPa.negate()).toVar();
  const pn = vec2(q.x, q.y.div(cosI)).div(size).toVar();
  const r = length(pn).toVar();

  const d = k.dPhase.add(leadAt(U, r).mul(k.dSat)).mul(discW(U, r)).mul(spinDir(U)).toVar();

  const rot = pn.toVar();
  /* Wavefronts share d, so this uniform branch avoids every tap's dead rotation. */
  If(d.abs().greaterThan(1e-7), () => {
    rot.assign(rot2(pn, d.negate()));
  });
  const back = rot2(vec2(rot.x, rot.y.mul(cosI)).mul(size), U.uGxPa).add(U.uGxCenter).toVar();
  const uvOut = back.sub(U.uCamera).div(vec2(U.uAspect, 1.0))
    .sub(0.5).div(U.uMarginScale).add(0.5).toVar();
  return vec2(uvOut.x, uvOut.y.oneMinus());
}
