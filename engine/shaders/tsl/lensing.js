/* Gravitational lensing as a compose-pass UV warp. The scene is sampled at the
   source-plane position β = θ − α(θ), so tangential arcs, multiple images, and a
   ring at r = θ_E are the lens equation solving itself, not shapes anyone drew. */

import {
  cos, float, length, max, min, mix, sin, smoothstep, sqrt, vec2, vec3,
} from 'three/tsl';

export const LENS_DEFAULTS = {
  on: false,
  halos: 0,
  thetaE: 0.16,
  core: 0.04,
  center: [0.5, 0.5],
  ellip: 0.25,
  angle: 0.6,
  point: 0,
  shear1: 0.05,
  shear2: 0,
  haloStrength: 0.35,
  haloSpread: 0.25,
  magBoost: 0.35,
  smear: 0.5,
  ringGain: 0.05,
  ringWidth: 0.02,
  chroma: 0.35,
};

export const LENS_MAX_HALOS = 3;

const HALO_UNIFORMS = ['uLensH0', 'uLensH1', 'uLensH2'];

/* |det A| passes through zero on the critical curve, so its reciprocal has to
   be capped before it multiplies the sampled scene. */
const MAG_CAP = 6.0;

/* The band, in screen uv, over which the warp relaxes before its sample would
   leave the frame. */
const EDGE_FADE = 0.05;

/* Distance from a uv to the nearest frame border, negative once outside */
const inset = (p) => min(min(p.x, p.x.oneMinus()), min(p.y, p.y.oneMinus()));

/* One softened halo's deflection and its potential's Hessian, in whatever frame
   `d` arrives in; `p`/`q` are the elliptical potential's axis weights (omit for a
   circular halo). Both profiles ring at r = √(θ_E² − rc²), gone once rc ≥ θ_E. */
function haloTerm(d, b, rc, pointMix, p = null, q = null) {
  /* Deliberate: the ellipticity sits in the potential, not the mass, so past
     e ≈ 0.3 the ring pinches peanut-shaped. Aesthetic standby, not a bug. */
  const wx = p ? p.mul(d.x) : d.x;
  const wy = q ? q.mul(d.y) : d.y;
  /* The core radius is what keeps this finite at r = 0; it is floored host-side */
  const soft = sqrt(rc.mul(rc).add(wx.mul(d.x)).add(wy.mul(d.y))).toVar();
  const inv = float(1.0).div(soft).toVar();
  const b2 = b.mul(b).toVar();
  const a1 = mix(b, b2.mul(inv), pointMix).toVar();
  const a2 = b2.mul(inv).mul(inv).mul(pointMix).negate();
  const sx = wx.mul(inv).toVar();
  const sy = wy.mul(inv).toVar();
  const diag = a1.mul(inv).toVar();
  const k = a2.sub(diag).toVar();
  /* The main halo's Hessian is read three times by the frame rotation below */
  return {
    ax: a1.mul(sx),
    ay: a1.mul(sy),
    hxx: k.mul(sx).mul(sx).add(p ? diag.mul(p) : diag).toVar(),
    hyy: k.mul(sy).mul(sy).add(q ? diag.mul(q) : diag).toVar(),
    hxy: k.mul(sx).mul(sy).toVar(),
    soft,
  };
}

/* Screen uv → warped sample uv, magnification gain, the tangential smear axis,
   the dispersion offset, and the ring's line emission. `halos` is a build-time
   count: the sub-halo terms are unrolled, never looped. */
export function lensWarp(screen, U, { halos = 0 } = {}) {
  /* Sky y runs down and x spans the aspect, the same frame every entity's
     framed position lives in, so the lens center is one of those positions. */
  const sky = vec2(screen.x, float(1.0).sub(screen.y))
    .mul(vec2(U.uAspect, 1.0))
    .add(U.uCamera);
  const d = sky.sub(U.uLensAt).toVar();

  const ct = cos(U.uLensRot).toVar();
  const st = sin(U.uLensRot).toVar();
  /* Both frame rotations are spelled out rather than calling rot2, so this pair
     of trig evaluations is the only one the whole warp pays for. R(−θ) here. */
  const lensFrame = vec2(
    ct.mul(d.x).add(st.mul(d.y)),
    ct.mul(d.y).sub(st.mul(d.x)),
  ).toVar();
  const main = haloTerm(
    lensFrame,
    U.uLensThetaE, U.uLensCore, U.uLensPoint,
    float(1.0).sub(U.uLensEllip).toVar(),
    float(1.0).add(U.uLensEllip).toVar(),
  );

  /* The frame rotation has to come back out of the deflection and out of its
     Hessian: H_world = R·H·Rᵀ. */
  const alpha = vec2(
    ct.mul(main.ax).sub(st.mul(main.ay)),
    st.mul(main.ax).add(ct.mul(main.ay)),
  ).toVar();
  const cs = ct.mul(st).toVar();
  const cc = ct.mul(ct).toVar();
  const ss = st.mul(st).toVar();
  let ax = alpha.x;
  let ay = alpha.y;
  let hxx = cc.mul(main.hxx).sub(cs.mul(main.hxy).mul(2.0)).add(ss.mul(main.hyy));
  let hyy = ss.mul(main.hxx).add(cs.mul(main.hxy).mul(2.0)).add(cc.mul(main.hyy));
  let hxy = cs.mul(main.hxx.sub(main.hyy)).add(cc.sub(ss).mul(main.hxy));

  /* h.xy is the seeded unit-disc offset, h.z its strength jitter */
  for (let i = 0; i < Math.min(halos, LENS_MAX_HALOS); i++) {
    const h = U[HALO_UNIFORMS[i]];
    const sub = haloTerm(
      d.sub(h.xy.mul(U.uLensHaloSpread)),
      U.uLensThetaE.mul(U.uLensHaloStr).mul(h.z),
      U.uLensCore, U.uLensPoint,
    );
    ax = ax.add(sub.ax);
    ay = ay.add(sub.ay);
    hxx = hxx.add(sub.hxx);
    hyy = hyy.add(sub.hyy);
    hxy = hxy.add(sub.hxy);
  }

  /* External shear: the gradient of ½γ₁(x²−y²) + γ₂xy, whose Hessian is the
     constant [[γ₁, γ₂], [γ₂, −γ₁]]. It is what turns a ring into a cross. */
  const g1 = U.uLensShear.x;
  const g2 = U.uLensShear.y;
  ax = ax.add(g1.mul(d.x)).add(g2.mul(d.y));
  ay = ay.add(g2.mul(d.x)).sub(g1.mul(d.y));
  hxx = hxx.add(g1);
  hyy = hyy.sub(g1);
  hxy = hxy.add(g2);

  /* A = ∂β/∂θ = I − H. Surface brightness is already conserved by the warp, so
     this gain is an aesthetic tell: it is what makes a thin arc clear the dither. */
  const detA = float(1.0).sub(hxx).mul(float(1.0).sub(hyy)).sub(hxy.mul(hxy));
  const mu = float(1.0).div(detA.abs().max(1e-3)).toVar();
  const over = mu.sub(1.0).max(0.0).toVar();
  /* The roll-off rides the excess over 1, not μ itself: a hard min leaves a
     flat plateau, and softening μ would dim the whole μ ≈ 1 field along with it. */
  const mag = min(mu, 1.0).add(over.div(over.div(MAG_CAP - 1.0).add(1.0))).toVar();
  /* Same excess on a 0–1 scale. It drives smear and dispersion so both live
     where the arcs are, and are absent on flat sky. */
  const arc = over.div(over.add(MAG_CAP - 1.0)).toVar();

  /* β = θ − α, carried back into screen uv: x un-scales by the aspect and y
     flips, because the sky frame this was computed in runs downward. */
  const beta = screen.add(vec2(ax.div(U.uAspect).negate(), ay)).toVar();

  /* The sampled point's radius about the lens center, in screen uv: the
     dispersion axis, and the tangential axis is its perpendicular. */
  const rad = vec2(d.x.sub(ax).div(U.uAspect), d.y.sub(ay).negate()).toVar();
  const vis = vec2(rad.x.mul(U.uAspect), rad.y).toVar();
  const visLen = length(vis).max(1e-5).toVar();
  /* Perpendicular taken in aspect-corrected space, then returned to uv, or the
     smear would shear off the arc on any non-square frame. */
  const tang = vec2(vis.y.negate().div(visLen).div(U.uAspect), vis.x.div(visLen)).toVar();

  const smear0 = arc.mul(U.uLensSmear).mul(U.uLensThetaE).mul(0.06).toVar();
  const disp0 = arc.mul(U.uLensChroma).mul(0.04).toVar();

  /* A sample that walked off the frame hits the uv clamp and replicates the
     border pixel into a streak, so the displacement fades on where the probe
     would land, not on how far β overshot. Guard covers the side taps too. */
  const guard = float(EDGE_FADE).add(smear0).add(length(rad).mul(disp0)).toVar();
  /* Slack caps at the pixel's own inset, so a sample that barely moves is never
     penalized: only travel toward the border costs strength. */
  const slack = max(min(guard, inset(screen)), 1e-4).toVar();
  const keep = smoothstep(0.0, slack, inset(beta)).toVar();

  /* soft = √(rc² + r²), so soft = θ_E is exactly r = √(θ_E² − rc²): the effective
     ring radius, elliptical for free, without a second sqrt. Modulated by the
     magnification so it breaks into arcs instead of reading as a drawn hoop. */
  const ring = smoothstep(0.0, U.uLensRingW, main.soft.sub(U.uLensThetaE).abs())
    .oneMinus().mul(arc.mul(0.7).add(0.3)).toVar();
  /* One term serves the ring and the soft outer glow: the wide low skirt is what
     makes a small-θ_E lens legible at all. */
  const skirt = smoothstep(0.0, U.uLensThetaE.mul(2.0).max(1e-3), main.soft)
    .oneMinus().toVar();

  return {
    at: mix(screen, beta, keep).clamp(0.0, 1.0).toVar(),
    gain: mix(float(1.0), mix(float(1.0), mag, U.uLensMag), keep).toVar(),
    tang,
    smear: smear0.mul(keep).toVar(),
    disp: rad.mul(disp0.mul(keep)).toVar(),
    chroma: arc.mul(U.uLensChroma).mul(0.7).mul(keep).toVar(),
    /* OIII-dominant because real lensed arcs are blue star-forming galaxies, and
       it enters as line channels so the palette grades it like any emission. */
    ring: vec3(0.6, 1.0, 0.35).mul(U.uLensRingGain).mul(ring.add(skirt.mul(0.08))).toVar(),
  };
}
