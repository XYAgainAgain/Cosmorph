/* Star clusters: an analytic King-profile glow plus a hash-grid field of
   resolved members. Continuum RGB only — starlight carries no line signature.
   Globular and open are the same code under different parameters. */

import {
  Fn, float, vec2, vec3, clamp, dot, floor, mix, smoothstep, step,
} from 'three/tsl';
import { hash3, fbm3o2, CELL_BIAS } from './noise.js';
import { rot2 } from './sdf.js';

/* fbm3o2 means 0.375; the rescale keeps mean member density fixed as
   clumping rises, so richness stays the only count control. */
const CLUMP_GAIN = 8 / 3;

/* King (1962) surface brightness before the squaring. The squared bracket is
   what gives a compact core and a tidal edge that lands at zero slope. */
const kingF = /*@__PURE__*/ Fn(([r, rc]) => {
  return float(1).div(r.mul(r).div(rc.mul(rc)).add(1.0).sqrt());
});

/* Per-fragment constants shared by the glow and all nine member taps */
function clusterFrame(U) {
  const rc = U.uCluCore.max(1e-4).toVar();
  const rt = U.uCluTidal.max(rc.add(1e-3)).toVar();
  const edge = kingF(rt, rc).toVar();
  const hr = U.uCluHaloR.max(1e-3).toVar();
  return {
    rc,
    edge,
    den: float(1).sub(edge).max(1e-4).toVar(),
    haloR2: hr.mul(hr).toVar(),
    sq: U.uCluSquash.max(0.05).toVar(),
  };
}

/* Cluster-local frame. Rotation is isometric, so the member grid can live here
   and keep circular PSF footprints; only the radius reads the squash. */
function clusterLocal(sky, U) {
  return rot2(sky.sub(U.uCluCenter), U.uCluRot.negate()).toVar();
}

function ellipseRadius(q, sq) {
  const d = vec2(q.x, q.y.div(sq));
  return dot(d, d).max(1e-12).sqrt().toVar();
}

function profileAt(r, F, U) {
  const s = kingF(r, F.rc).sub(F.edge).max(0.0).div(F.den).toVar();
  /* Projected-Plummer wing past the tidal cut, which King truncates to exactly
     zero; without it the cluster ends on a visible circle. */
  const h = float(1).div(r.mul(r).div(F.haloR2).add(1.0)).toVar();
  return s.mul(s).add(h.mul(h).mul(U.uCluHalo)).toVar();
}

/* Normalized surface brightness, 1 at the core plus the halo term on top */
export function clusterProfile(sky, U) {
  const F = clusterFrame(U);
  return profileAt(ellipseRadius(clusterLocal(sky, U), F.sq), F, U);
}

/* Radially concentrated continuum glow: thousands of members too crowded to
   separate, so it is one smooth field rather than a pile of sprites. */
export function clusterGlow(sky, U) {
  return clusterProfile(sky, U).mul(U.uCluLum);
}

function membersWith(sky, pxPerUnit, U, F, clumped = true) {
  const cells = U.uCluCells.max(1e-3).toVar();
  const g = clusterLocal(sky, U).mul(cells).toVar();
  const base = floor(g).toVar();
  const pxScale = pxPerUnit.div(cells).toVar();
  const acc = vec3(0).toVar();

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const c = base.add(vec2(dx, dy));
      const h1 = hash3(vec3(c, 5.0).add(U.uCluOff).add(CELL_BIAS));
      const h2 = hash3(vec3(c, 83.0).add(U.uCluOff).add(CELL_BIAS));

      const starG = c.add(h1.xy).toVar();
      const dPx = g.sub(starG).mul(pxScale);

      /* Presence is sampled at the member's OWN position: reading the profile
         at the fragment cuts a star's footprint wherever the threshold crosses. */
      const starLocal = starG.div(cells).toVar();
      const rs = ellipseRadius(starLocal, F.sq);
      const prof = profileAt(rs, F, U);

      /* Inside the resolution radius crowding is total: individual points
         would read as sprite pileup on top of the fused glow. */
      const resolved = smoothstep(float(0), U.uCluResolve.max(1e-4), rs);
      /* Probability modulation, so multiply is correct (remap would carve).
         Build-time gated: at clump 0 the in-loop fbm is 9 dead calls/fragment. */
      const clump = clumped
        ? mix(float(1.0),
            fbm3o2(vec3(starLocal.mul(U.uCluClumpFreq), 0.0).add(U.uCluOff)).mul(CLUMP_GAIN),
            U.uCluClump)
        : float(1.0);

      const dens = prof.max(1e-6).pow(U.uCluMemFall.max(0.05))
        .mul(U.uCluRich).mul(resolved).mul(clump);
      const present = step(h1.z, dens);

      /* pow(x,3) and its square as multiplies: the exponents are compile-time
         constants, and three transcendentals × 9 taps is real per-fragment cost. */
      const rel = h2.x.mul(h2.x).mul(h2.x).toVar();
      const L = rel.mul(rel).mul(U.uCluMemGain);

      /* Flux-preserving sub-pixel clamp, as stars.js */
      const aTrue = mix(0.45, 1.25, rel).mul(U.uCluMemSize.max(0.05)).toVar();
      const aC = aTrue.max(0.7).toVar();
      const energy = aTrue.mul(aTrue).div(aC.mul(aC));

      const r2 = dot(dPx, dPx).div(aC.mul(aC));
      const x = float(1).div(r2.add(1.0));
      const psf = x.mul(x);

      /* Two populations plus a warm/cool per-star slide; two exact colors over
         a few hundred points reads synthetic */
      const pop = mix(U.uCluMemTint, U.uCluMemTint2, step(h2.z, U.uCluMemMix));
      const col = pop.mul(mix(vec3(1.06, 1.0, 0.94), vec3(0.94, 1.0, 1.06), h2.y));
      const colS = mix(vec3(1.0), col, smoothstep(0.0, 0.12, rel));

      acc.addAssign(colS.mul(L.mul(energy).mul(psf).mul(present)));
    }
  }
  return acc;
}

/* Granular sparkle where members start to resolve. Spatially stable by
   construction: cell-hash positions, no time term anywhere in this module. */
export function clusterMembers(sky, pxPerUnit, U, clumped = true) {
  return membersWith(sky, pxPerUnit, U, clusterFrame(U), clumped);
}

/* Membership mask in [0,1] for the faint-star layer to fold into its density.
   Exported and documented, deliberately NOT wired into dust.js. */
export function clusterBoost(sky, U) {
  const p = clusterProfile(sky, U);
  return clamp(p.max(1e-6).pow(U.uCluMemFall.max(0.05)), 0.0, 1.0);
}

/* clumped: false drops the in-loop clump fbm from the graph entirely; use it
   for the globular preset, whose clump default is 0. */
export function buildClusterNodes(skyU, pxPerUnit, U, { clumped = true } = {}) {
  const continuum = Fn(() => {
    const F = clusterFrame(U);
    const glow = profileAt(ellipseRadius(clusterLocal(skyU, U), F.sq), F, U);
    return U.uCluTint.mul(glow.mul(U.uCluLum)).add(membersWith(skyU, pxPerUnit, U, F, clumped));
  })();
  return { continuum };
}

/* Dense ball, warm old population, points only past the fused core */
export const GLOBULAR_DEFAULTS = {
  center: [0.72, 0.62],
  core: 0.018,
  tidal: 0.13,
  squash: 0.94,
  rot: 0.4,
  lum: 2.4,
  tint: [1.0, 0.86, 0.62],
  halo: 0.1,
  haloR: 0.075,
  cells: 190,
  rich: 1.0,
  /* In the same band as the faint field's brightScale (stars.js, 1.7 and 4.0):
     under pow(h2.x, 6) anything much lower resolves no members at all. */
  memGain: 1.8,
  memFall: 0.55,
  memSize: 0.85,
  resolve: 0.032,
  memTint: [1.0, 0.88, 0.7],
  memTint2: [0.74, 0.82, 1.0],
  memMix: 0.14,
  clump: 0.0,
  clumpFreq: 30.0,
};

/* Loose sprinkle, blue-white young population, one warm giant in the mix */
export const OPEN_CLUSTER_DEFAULTS = {
  center: [0.3, 0.7],
  core: 0.075,
  tidal: 0.2,
  squash: 0.78,
  rot: -0.6,
  lum: 0.22,
  tint: [0.72, 0.8, 1.0],
  halo: 0.35,
  haloR: 0.13,
  cells: 46,
  rich: 0.4,
  memGain: 1.6,
  memFall: 0.8,
  memSize: 1.35,
  resolve: 0.0,
  memTint: [0.78, 0.85, 1.0],
  memTint2: [1.0, 0.72, 0.48],
  memMix: 0.05,
  clump: 0.65,
  clumpFreq: 26.0,
};
