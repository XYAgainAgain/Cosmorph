/* 2D SDF shape pipeline: the authored-silhouette core for globules, pillars,
   cometary shapes, and the Horsehead. Scalar fields only, never color. */

import {
  Fn, float, vec2, abs, clamp, cos, dot, length, max, min, mix,
  sin, smoothstep, sqrt, step,
} from 'three/tsl';
import { fbm3o4 } from './noise.js';

const EPS = 1e-6;

/* Shapes are authored axis-aligned; orientation rotates the sample point into
   the shape's local frame, so callers pass the negated angle. */
export const rot2 = /*@__PURE__*/ Fn(([p, angle]) => {
  const c = cos(angle).toVar();
  const s = sin(angle).toVar();
  return vec2(c.mul(p.x).sub(s.mul(p.y)), s.mul(p.x).add(c.mul(p.y)));
});

// Primitives

export const sdCircle = /*@__PURE__*/ Fn(([p, c, r]) => length(p.sub(c)).sub(r));

/* Gradient-normalized approximation, not exact: error grows with eccentricity
   but vanishes at the boundary, which is the only place an envelope reads. */
export const sdEllipse = /*@__PURE__*/ Fn(([p, c, r]) => {
  const rr = max(abs(r), vec2(EPS)).toVar();
  const q = p.sub(c).toVar();
  const k1 = length(q.div(rr)).toVar();
  const k2 = max(length(q.div(rr.mul(rr))), float(EPS)).toVar();
  return k1.mul(k1.sub(1.0)).div(k2);
});

/* Capsule: distance to segment a→b, inflated by r */
export const sdSegment = /*@__PURE__*/ Fn(([p, a, b, r]) => {
  const pa = p.sub(a).toVar();
  const ba = b.sub(a).toVar();
  const h = clamp(dot(pa, ba).div(max(dot(ba, ba), float(EPS))), 0.0, 1.0).toVar();
  return length(pa.sub(ba.mul(h))).sub(r);
});

/* b is the half-extent before rounding; r is the corner radius */
export const sdRoundBox = /*@__PURE__*/ Fn(([p, c, b, r]) => {
  const q = abs(p.sub(c)).sub(b).add(r).toVar('boxQ');
  return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(r);
});

/* Cometary silhouette: round head of radius headR tapering to tailR over len,
   tail pointing along +X before `angle` turns it. Needs |headR-tailR| <= len. */
export const sdTeardrop = /*@__PURE__*/ Fn(([p, c, headR, tailR, len, angle]) => {
  const q = rot2(p.sub(c), angle.negate()).toVar('tearQ');
  const h = max(len, float(EPS)).toVar('tearH');
  /* Axis folded onto +Y of a local (across, along) frame so the shape is
     symmetric about its own axis with one abs */
  const s = vec2(abs(q.y), q.x).toVar('tearS');
  const b = headR.sub(tailR).div(h).toVar('tearB');
  const a = sqrt(max(float(1).sub(b.mul(b)), float(0))).toVar('tearA');
  const k = dot(s, vec2(b.negate(), a)).toVar('tearK');

  const head = length(s).sub(headR);
  const tail = length(s.sub(vec2(0.0, h))).sub(tailR);
  const body = dot(s, vec2(a, b)).sub(headR);
  return mix(mix(body, tail, step(a.mul(h), k)), head, step(k, float(0)));
});

/* Crescent: ring of radius ra, thickness rb, spanning ±aperture radians about
   +Y in the local frame. aperture >= PI closes it into a full annulus. */
export const sdArc = /*@__PURE__*/ Fn(([p, c, ra, rb, angle, aperture]) => {
  const q = rot2(p.sub(c), angle.negate()).toVar('arcQ');
  const qa = vec2(abs(q.x), q.y).toVar('arcQa');
  /* Clamped: past PI the cap frame folds back over +Y and leaves a stray blob,
     where the shape should simply have closed into an annulus. */
  const ap = aperture.min(Math.PI).toVar('arcAp');
  const sc = vec2(sin(ap), cos(ap)).toVar('arcSc');
  const ring = abs(length(qa).sub(ra));
  const cap = length(qa.sub(sc.mul(ra)));
  /* Past the aperture the nearest point is an end cap, inside it the ring */
  return mix(ring, cap, step(sc.x.mul(qa.y), sc.y.mul(qa.x))).sub(rb);
});

// Smooth booleans

/* iq's polynomial smooth min. k is the blend width in distance units. */
export const smin = /*@__PURE__*/ Fn(([a, b, k]) => {
  const kk = max(k, float(EPS)).toVar();
  const h = clamp(b.sub(a).mul(0.5).div(kk).add(0.5), 0.0, 1.0).toVar();
  return mix(b, a, h).sub(kk.mul(h).mul(float(1).sub(h)));
});

export const smax = /*@__PURE__*/ Fn(([a, b, k]) => {
  const kk = max(k, float(EPS)).toVar();
  const h = clamp(b.sub(a).mul(-0.5).div(kk).add(0.5), 0.0, 1.0).toVar();
  return mix(b, a, h).add(kk.mul(h).mul(float(1).sub(h)));
});

export const opUnion = /*@__PURE__*/ Fn(([d1, d2, k]) => smin(d1, d2, k));
export const opSubtract = /*@__PURE__*/ Fn(([d1, d2, k]) => smax(d1, d2.negate(), k));
export const opIntersect = /*@__PURE__*/ Fn(([d1, d2, k]) => smax(d1, d2, k));

// Field operators

/* d = sdf + amp*fbm is not a valid SDF, and does not need to be: fixed-step
   marching has no Lipschitz requirement. Do not "fix" this. */
export function sdfDisplace(d, p3, amp, fbm = fbm3o4) {
  /* fbm is [0,1]; centering it keeps the silhouette from creeping outward */
  return d.add(fbm(p3).sub(0.5).mul(2.0).mul(float(amp))).toVar();
}

/* 1 deep inside, 0 outside. The feather straddles the surface so the authored
   boundary stays where it was authored. */
export const sdfEnvelope = /*@__PURE__*/ Fn(([d, feather]) => {
  /* Unnamed: two entities calling this in one pass collide on a named var */
  const f = max(feather, float(EPS)).toVar();
  return smoothstep(f.mul(-0.5), f.mul(0.5), d.negate());
});

/* Analytic half-chord through a spherical shell at projected radius rp,
   normalized by its true peak: limb brightening for free, no painted edge. */
export const shellChord = /*@__PURE__*/ Fn(([rp, rOut, rIn]) => {
  const q = rp.mul(rp).toVar();
  const o2 = rOut.mul(rOut).toVar();
  const i2 = rIn.mul(rIn).toVar();
  const chord = o2.sub(q).max(0.0).sqrt().sub(i2.sub(q).max(0.0).sqrt());
  return chord.div(o2.sub(i2).max(1e-8).sqrt());
});

/* Guarded five-arg remap. Assumes hi > lo (every doctrine chain does): the
   denominator is floored, not sign-corrected. */
export const remapRange = /*@__PURE__*/ Fn(([v, lo, hi, ln, hn]) => {
  const t = v.sub(lo).div(max(hi.sub(lo), float(EPS))).toVar();
  return ln.add(t.mul(hn.sub(ln)));
});

/* Combine an authored envelope with noise by REMAP, never multiply. Multiply
   gives a mask-shaped fade with noise inside; remap makes noise carve. */
export const remapCombine = /*@__PURE__*/ Fn(([env, detail, coverage, erosion]) => {
  const cov = clamp(coverage, 0.0, 1.0).toVar();
  const d = remapRange(env, float(1).sub(cov), float(1), float(0), float(1)).toVar();
  /* Second remap chews wisps off the edge rather than fading them */
  d.assign(remapRange(d, detail.mul(erosion), float(1), float(0), float(1)));
  return clamp(d, 0.0, 1.0);
});

// Derivatives (rim lighting)

/* Central differences on a caller-supplied sampler, 4 taps. */
export function sdfGradient(sample, p, eps = 0.002) {
  const e = float(eps);
  const gx = sample(p.add(vec2(e, 0.0))).sub(sample(p.sub(vec2(e, 0.0))));
  const gy = sample(p.add(vec2(0.0, e))).sub(sample(p.sub(vec2(0.0, e))));
  return vec2(gx, gy).div(e.mul(2.0)).toVar();
}

/* Directional derivative along dir, 2 taps. For a unit-gradient field this
   equals N·dir, so rim facing costs one extra tap instead of four. */
export function sdfSlope(sample, p, dir, eps = 0.002) {
  const e = float(eps);
  return sample(p.add(dir.mul(e))).sub(sample(p)).div(e).toVar();
}
