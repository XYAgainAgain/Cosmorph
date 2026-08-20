/* Dark globule fields and the dark-on-emission rim operator. The body is
   extinction only (tau, same convention as the wisp layer); the ionization
   skin is separate line emission. Never mix the two into one output. */

import {
  Fn, float, vec2, vec3, vec4, floor, fract, dot, length,
  min, max, mix, exp, clamp, step, smoothstep,
} from 'three/tsl';
import { hash1, hash3, fbm3o2, fbm3o4, CELL_BIAS } from './noise.js';
import { remapCombine, sdfSlope } from './sdf.js';

/* Independent slice of the noise domain for the clustering lattice */
const CLUST_DOMAIN = /*@__PURE__*/ vec3(29.0, 61.0, 13.0);

/* Worley F1 in cell units over a 3x3 neighborhood. Seeded by integer cell
   offsets, never a fractional domain shift, so the lattice stays aligned. */
export const worleyF1 = /*@__PURE__*/ Fn(([p, off]) => {
  const cell = floor(p);
  const f = fract(p);
  /* Init to 9, not a huge sentinel: max squared distance in a 3x3 search
     approaches 8, and a mediump fallback tops out at 65504. */
  const d2 = float(9.0).toVar();

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const g = vec2(dx, dy);
      const h = hash3(vec3(cell.add(g).add(off.xy), off.z).add(CELL_BIAS));
      const r = g.add(h.xy).sub(f);
      d2.assign(min(d2, dot(r, r)));
    }
  }
  return d2.sqrt();
});

/* Inverted Voronoi: peaks at the feature points, zero by `falloff` cell units.
   The cheap primitive for clumped structure, so it erodes the silhouette. */
export const worleyInv = /*@__PURE__*/ Fn(([p, off, falloff]) => {
  return float(1).sub(smoothstep(float(0), falloff.max(1e-3), worleyF1(p, off)));
});

/* Guarded direction. At a coincident point this returns zero, which collapses
   the teardrop to a round clump instead of producing NaN. */
const dirTo = /*@__PURE__*/ Fn(([from, to]) => {
  const d = to.sub(from).toVar();
  return d.div(dot(d, d).max(1e-8).sqrt());
});

/* One clump: xy = offset from the jittered center, z = radius, w = occupancy.
   All of it keys off the integer cell, so nothing can pop mid-blob. */
function clumpCell(f, g, cell, U) {
  const c = cell.add(g).add(U.uGlobOff.xy).toVar();
  const h = hash3(vec3(c, U.uGlobOff.z).add(CELL_BIAS)).toVar();
  const rj = hash1(vec3(c, U.uGlobOff.z.add(97.0)).add(CELL_BIAS)).toVar();

  /* One coarse-lattice hash drives both occupancy and size, so clumps knot up
     with empty sky between. Seed added after the scale, or the slider pans. */
  const cl = hash1(floor(vec3(cell.add(g), 0.0).mul(U.uGlobClustFreq))
    .add(U.uGlobOff).add(CLUST_DOMAIN).add(CELL_BIAS)).toVar();
  const knot = mix(float(1).sub(U.uGlobCluster), float(1).add(U.uGlobCluster), cl).toVar();

  const rr = U.uGlobRadius.mul(mix(0.55, 1.45, rj)).mul(knot).max(1e-3);
  return vec4(f.sub(g).sub(h.xy), rr, step(h.z, U.uGlobFill.mul(knot)));
}

/* Radial profile in [0,1]: flat opaque core out to `core`, then a power-law
   feathered skirt; a plateau with a hard edge reads as a cutout. */
function clumpProfile(q, rr, U) {
  const k0 = clamp(U.uGlobCore, 0.0, 0.95).toVar();
  const t = float(1).sub(q.div(rr).sub(k0).div(float(1).sub(k0).max(1e-3)).clamp(0.0, 1.0));
  /* max(0), not an epsilon: a floored base leaves 0.63 coverage everywhere at
     the smallest exponent, and pow(0, y>0) is defined on both backends. */
  return t.max(0.0).pow(U.uGlobProf.max(0.05));
}

/* Bok field: compact round clumps, unioned by max so overlaps do not stack
   into a slab. Returns coverage in [0,1], not optical depth. */
function bokClumps(p, U) {
  const cell = floor(p);
  const f = fract(p);
  /* JS-side expression fold, never .assign(): these run outside any Fn stack,
     where TSL silently drops assigns and the whole clump union vanishes. */
  let cov = float(0);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const k = clumpCell(f, vec2(dx, dy), cell, U).toVar();
      cov = max(cov, clumpProfile(length(k.xy), k.z, U).mul(k.w));
    }
  }
  return cov;
}

/* Cometary field: the same clumps under a distorted distance metric, blunt
   head toward the source and a tapering tail downstream. */
function cometaryClumps(p, srcP, U) {
  const cell = floor(p);
  const f = fract(p);
  /* One axis for the whole neighborhood: the source is far compared to a cell,
     which saves eight normalizes per sample. */
  const L = dirTo(p, srcP).toVar();
  /* The jittered, clustered tail reach may hit ~1.5 cells; past that the 3×3
     search truncates it. The param schema enforces the bound host-side. */
  const invTail = float(1).div(U.uGlobElong.max(1e-3)).toVar();
  /* Same no-stack constraint as bokClumps: fold, don't assign */
  let cov = float(0);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const k = clumpCell(f, vec2(dx, dy), cell, U).toVar();
      const rr = k.z.toVar();
      const axis = dot(k.xy, L).toVar();
      const perp = length(k.xy.sub(L.mul(axis)));

      /* Compressing the anti-source axis extends the clump into a tail;
         widening the perpendicular downstream tapers it to a point. */
      const along = mix(invTail, float(1.0), smoothstep(rr.negate(), rr, axis));
      const narrow = float(1).add(U.uGlobTaper.mul(max(axis.negate(), 0.0)).div(rr));
      const d = length(vec2(axis.mul(along), perp.mul(narrow)));

      /* The tail is a thinner column than the head, so it has to read
         translucent rather than carrying the head's opacity out with it. */
      const thin = mix(float(1.0), U.uGlobTailOp,
        smoothstep(float(0), rr, axis.negate()));
      cov = max(cov, clumpProfile(d, rr, U).mul(thin).mul(k.w));
    }
  }
  return cov;
}

/* Coverage field in [0,1]: fbm remapped through the clump silhouette, then
   chewed at the edges by high-frequency inverted Voronoi. */
export function globuleCoverage(sky, U, cometary = true) {
  const p = sky.mul(U.uGlobFreq).toVar();
  const shape = cometary
    ? cometaryClumps(p, U.uGlobIonSrc.mul(U.uGlobFreq), U)
    : bokClumps(p, U);
  const cov = shape.toVar();

  const zEvo = U.uTev.mul(U.uGlobMorph);
  const n = fbm3o4(vec3(p.mul(U.uGlobDetail), zEvo).add(U.uGlobOff));
  const ero = worleyInv(p.mul(U.uGlobEroFreq), U.uGlobOff.add(vec3(19, 7, 53)), U.uGlobEroFall);
  return remapCombine(n, ero, cov, U.uGlobErode);
}

/* Opacity fraction in [0,1]. A wide softness is deliberate: a hard edge here
   is what made every clump a flat cutout at uniform opacity. */
export function globuleDensity(sky, U, cometary = true) {
  const th = U.uGlobTh;
  return smoothstep(th, th.add(U.uGlobSoft.max(1e-3)), globuleCoverage(sky, U, cometary));
}

/* Same tau convention as the wisp layer (dust.js) */
export function globuleTau(sky, U, cometary = true) {
  return globuleDensity(sky, U, cometary).mul(U.uGlobTau);
}

/* One density field feeds both outputs: tau for the extinction sum, rim for the
   extinction-exempt photoevaporation skin. Splitting them re-evaluates the field. */
export function globuleTauAndRim(sky, U, cometary = true) {
  const L = dirTo(sky, U.uGlobIonSrc).toVar();
  const d0 = globuleDensity(sky, U, cometary).toVar();

  /* sdfSlope taps the base point too; handing back d0 for it keeps this at
     two field evals instead of three. */
  const dens = (q) => (q === sky ? d0 : globuleDensity(q, U, cometary));
  const slope = sdfSlope(dens, sky, L, U.uRimEps.max(1e-4));

  /* Density falling along L means the edge faces the source. The slope is
     per unit length, so uRimFacing scales with 1/uRimEps. */
  const facing = smoothstep(float(0), U.uRimFacing.max(1e-3), slope.negate()).toVar();

  /* Gaussian of the front, not the front itself: the ridge is a thin band
     across the boundary, plus a wider dim halo hugging it. */
  const b = d0.sub(U.uRimAt).div(U.uRimW.max(1e-3)).toVar();
  const b2 = b.mul(b).negate().toVar();
  const glow = exp(b2).add(exp(b2.mul(0.11)).mul(U.uRimHalo));

  const dp = U.uGlobIonSrc.sub(sky);
  const G = float(1).div(dot(dp, dp).div(U.uGlobIonR2.max(1e-4)).add(1.0)).toVar();

  /* A uniform glow reads as an outline; real fronts bead into knots */
  const nk = fbm3o2(vec3(sky.mul(U.uRimKnotFreq), U.uTev.mul(U.uGlobMorph)).add(U.uGlobOff.mul(3.0)));
  const bead = mix(float(1).sub(U.uRimKnot), float(1), nk);

  const rim = glow.mul(facing).mul(G).mul(bead).mul(U.uRimGain).toVar();
  /* OIII confined to the hottest zone, as nebula.js */
  const hot = smoothstep(U.uGlobHotLo, U.uGlobHotHi, G);
  return {
    tau: d0.mul(U.uGlobTau),
    rim: vec3(rim, rim.mul(hot.mul(U.uRimOiii).add(0.01)), rim.mul(U.uRimSii)),
  };
}
