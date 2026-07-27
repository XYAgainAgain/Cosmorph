/* Dark globule fields and the dark-on-emission rim operator. The body is
   extinction only (tau, same convention as the wisp layer); the ionization
   skin is separate line emission. Never mix the two into one output. */

import {
  Fn, float, vec2, vec3, vec4, floor, fract, dot, length,
  min, max, mix, exp, clamp, step, smoothstep,
} from 'three/tsl';
import { hash1, hash3, fbm3o2, fbm3o4, CELL_BIAS } from './noise.js';
import { remapCombine, sdfSlope } from './sdf.js';

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

/* One clump: xy = offset from the jittered center in cell units, z = jittered
   radius, w = 1 when the cell is occupied. hash1 costs a third of a pcg3d. */
const clumpCell = /*@__PURE__*/ Fn(([f, g, cell, off, radius, fill]) => {
  const c = cell.add(g).add(off.xy).toVar();
  const h = hash3(vec3(c, off.z).add(CELL_BIAS));
  const rj = hash1(vec3(c, off.z.add(97.0)).add(CELL_BIAS));
  const rr = radius.mul(mix(0.55, 1.45, rj)).max(1e-3);
  return vec4(f.sub(g).sub(h.xy), rr, step(h.z, fill));
});

/* Bok field: compact round clumps, unioned by max so overlaps do not stack
   into a slab. Returns coverage in [0,1], not optical depth. */
export const bokClumps = /*@__PURE__*/ Fn(([p, off, radius, fill, core]) => {
  const cell = floor(p);
  const f = fract(p);
  /* Below 1 so the blob's smoothstep edges stay ascending */
  const k0 = clamp(core, 0.0, 0.95).toVar();
  const cov = float(0).toVar();

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const k = clumpCell(f, vec2(dx, dy), cell, off, radius, fill).toVar();
      const blob = float(1).sub(smoothstep(k.z.mul(k0), k.z, length(k.xy)));
      cov.assign(max(cov, blob.mul(k.w)));
    }
  }
  return cov;
});

/* Cometary field: the same clumps under a distorted distance metric, blunt
   head toward the source and a tapering tail downstream. */
export const cometaryClumps = /*@__PURE__*/ Fn(([p, off, srcP, radius, fill, elong, taper, core]) => {
  const cell = floor(p);
  const f = fract(p);
  /* One axis for the whole neighborhood: the source is far compared to a cell,
     which saves eight normalizes per sample. */
  const L = dirTo(p, srcP).toVar();
  /* Invariant uGlobRadius * uGlobElong <= 1: a tail longer than one cell is
     truncated by the 3x3 search. The param schema enforces it host-side. */
  const invTail = float(1).div(elong.max(1e-3)).toVar();
  const k0 = clamp(core, 0.0, 0.95).toVar();
  const cov = float(0).toVar();

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const k = clumpCell(f, vec2(dx, dy), cell, off, radius, fill).toVar();
      const rr = k.z.toVar();
      const axis = dot(k.xy, L).toVar();
      const perp = length(k.xy.sub(L.mul(axis)));

      /* Compressing the anti-source axis extends the clump into a tail;
         widening the perpendicular downstream tapers it to a point. */
      const along = mix(invTail, float(1.0), smoothstep(rr.negate(), rr, axis));
      const narrow = float(1).add(taper.mul(max(axis.negate(), 0.0)).div(rr));
      const d = length(vec2(axis.mul(along), perp.mul(narrow)));

      const blob = float(1).sub(smoothstep(rr.mul(k0), rr, d));
      cov.assign(max(cov, blob.mul(k.w)));
    }
  }
  return cov;
});

/* Coverage field in [0,1]: fbm remapped through the clump silhouette, then
   chewed at the edges by high-frequency inverted Voronoi. */
export function globuleCoverage(sky, U, cometary = true) {
  const p = sky.mul(U.uGlobFreq).toVar();
  const shape = cometary
    ? cometaryClumps(p, U.uGlobOff, U.uGlobIonSrc.mul(U.uGlobFreq), U.uGlobRadius,
      U.uGlobFill, U.uGlobElong, U.uGlobTaper, U.uGlobCore)
    : bokClumps(p, U.uGlobOff, U.uGlobRadius, U.uGlobFill, U.uGlobCore);
  const cov = shape.toVar();

  const zEvo = U.uTev.mul(U.uGlobMorph);
  const n = fbm3o4(vec3(p.mul(U.uGlobDetail), zEvo).add(U.uGlobOff));
  const ero = worleyInv(p.mul(U.uGlobEroFreq), U.uGlobOff.add(vec3(19, 7, 53)), U.uGlobEroFall);
  return remapCombine(n, ero, cov, U.uGlobErode);
}

/* Opacity fraction in [0,1]. Sharp because the interior must saturate: a field
   sitting at tau 0.3-1.5 across the whole silhouette reads as fog. */
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
