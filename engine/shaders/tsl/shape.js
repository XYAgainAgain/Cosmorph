/* Shape-textured entity (Horsehead class): a baked column-density field over the
   whole source frame, scaffolded by a signed distance. Line channels and tau. */

import {
  If, clamp, float, vec2, vec3, abs, dot, exp, length, max, mix, smoothstep, texture,
} from 'three/tsl';
import { fbm3o2, fbm3o4 } from './noise.js';
import { worleyInv } from './globules.js';
import { remapCombine, rot2, sdfEnvelope } from './sdf.js';

/* Own slice of the hash domain for the edge-chewing cell field */
const ERO_DOMAIN = /*@__PURE__*/ vec3(23.0, 5.0, 61.0);

/* Sky → the asset's unit frame, centered on zero. Sky y runs down, which
   reverses the handedness and with it the sign of the inverse rotation. */
function shapeLocal(sky, U) {
  return rot2(sky.sub(U.uShpCenter), U.uShpRot).div(U.uShpScale).toVar();
}

/* The bake writes rows top-down onto v, and sky y runs down too, so the frame
   drops straight onto the texture with nothing to flip. */
function shapeTexUV(q) {
  return q.add(0.5);
}

/* Outside the baked frame the sampler clamps, which would freeze the field into
   stripes; the box-exit distance keeps it rising outward instead. */
function boxExit(q) {
  return length(max(abs(q).sub(0.5), vec2(0.0)));
}

/* Distance channel only, for the facing derivative's second tap: a full sample
   would refetch the column for nothing. */
function shapeDistAt(sky, U, map) {
  const q = shapeLocal(sky, U);
  const r = texture(map, shapeTexUV(q)).x;
  return r.mul(U.uShpSpread).add(boxExit(q)).mul(U.uShpScale);
}

function shapeSample(sky, U, map) {
  const q = shapeLocal(sky, U);
  const t = texture(map, shapeTexUV(q)).toVar();
  const outer = boxExit(q).toVar();
  /* Chebyshev inset: the column has to die before the rectangular texture
     boundary can read as a box. */
  const inset = float(0.5).sub(max(abs(q.x), abs(q.y))).toVar();
  return {
    d: t.x.mul(U.uShpSpread).add(outer).mul(U.uShpScale).toVar(),
    col: t.y.toVar(),
    fade: smoothstep(float(0), U.uShpEdge, inset).toVar(),
    outer: outer.mul(U.uShpScale).toVar(),
  };
}

/* One field evaluation feeding both outputs. The polygon is a scaffold, not the
   silhouette: the baked column already carries the head, the translucent mane,
   and the bank it rises out of. */
function shapeField(sky, U, s) {
  const env = sdfEnvelope(s.d, U.uShpFeather).toVar();
  /* Confidence in the traced core, mixed toward opaque rather than added to it:
     adding saturates the column flat and takes the interior mottling with it,
     which is exactly how the silhouette turned into a black sticker. */
  const raw = clamp(s.col.mul(U.uShpDens), 0.0, 1.0).toVar();
  const col = mix(raw, float(1.0), env.mul(U.uShpCore)).mul(s.fade).toVar();

  const n = fbm3o4(vec3(sky.mul(U.uShpFreq), U.uTev.mul(U.uShpMorph)).add(U.uShpOff)).toVar();
  const ero = worleyInv(sky.mul(U.uShpEroFreq), U.uShpOff.add(ERO_DOMAIN), U.uShpEroFall);
  /* Remap, never multiply: multiplying would fade the whole cloud out under the
     noise instead of letting the noise carve its boundary. */
  const carve = remapCombine(n, ero, col, U.uShpErode).toVar();
  const bite = smoothstep(U.uShpTh, U.uShpTh.add(U.uShpSoft), carve).toVar();

  /* Erosion scales the column, never zeroes it: a hard chew would break the
     continuous bank into disconnected blotches. */
  const dens = col.mul(mix(U.uShpVeil, float(1.0), bite)).toVar();
  return { d: s.d, n, dens };
}

/* Tau and lit edge from one field evaluation, the globule pattern */
export function shapeTauAndRim(sky, U, map, { glow = false, rimHalo = false } = {}) {
  /* Both texture fetches stay outside the guard below: sampling under
     non-uniform control flow has undefined derivatives. */
  const s = shapeSample(sky, U, map);
  const dp = U.uShpIonSrc.sub(sky).toVar();
  const r2 = dot(dp, dp).toVar();
  const toSrc = dp.div(r2.max(1e-8).sqrt()).toVar();
  /* Facing from the distance field itself. A traced polygon's baked normal is
     constant along each edge and steps at every vertex, which tiled the rim
     into slabs; two taps of a bilinear field read smooth instead. */
  const e = U.uShpRimEps;
  const slope = shapeDistAt(sky.add(toSrc.mul(e)), U, map).sub(s.d).div(e).toVar();

  const tau = float(0).toVar();
  const rim = vec3(0.0).toVar();

  /* The shape ends at its frame. Outside it the clamped sampler lies: a
     silhouette crossing the border drags its negative distance outward, and the
     rim traces phantom box-exit iso-lines (the pillars bars). edgeFade feathers
     the approach; past the box there is nothing honest left to draw. */
  If(s.outer.lessThan(1e-5), () => {
    const f = shapeField(sky, U, s);
    /* Optical depth tracks the baked column, so thin mane edges and the bank
       transmit the wall behind them while the skull core stays opaque. */
    tau.assign(f.dens.mul(U.uShpTau));

    const G = float(1).div(r2.div(U.uShpIonR2).add(1.0)).toVar();
    const facing = smoothstep(float(0), U.uShpRimFacing, slope).toVar();

    /* The band rides the distance, not the column: a column band would leak a
       wide haze across the bank, where the distance is unambiguously far.
       Jittering by the same noise that carved the edge keeps the two in step. */
    const dR = f.d.add(f.n.sub(0.5).mul(2.0).mul(U.uShpRimJit)).toVar();
    const b = dR.sub(U.uShpRimAt).div(U.uShpRimW).toVar();
    const b2 = b.mul(b).negate().toVar();
    /* The halo is a second, much wider exp; with it off the tight core is the
       whole band and the chain is not worth emitting. */
    const band = rimHalo ? exp(b2).add(exp(b2.mul(0.11)).mul(U.uShpRimHalo)) : exp(b2);

    /* A uniform band reads as an outline; real fronts bead into knots */
    const nk = fbm3o2(vec3(sky.mul(U.uShpRimKnotFreq), U.uTev.mul(U.uShpMorph))
      .add(U.uShpOff.mul(3.0)));
    const bead = mix(float(1).sub(U.uShpRimKnot), float(1), nk);
    /* The front is only as bright as the material it is eating, so the band
       fades wherever the column has thinned. Without this the rim draws a clean
       outline of the traced polygon straight across empty cloud. */
    const feed = mix(float(1).sub(U.uShpRimDens), float(1), f.dens);
    const edge = band.mul(facing).mul(G).mul(bead).mul(feed).mul(U.uShpRimGain).toVar();

    /* Interior emission decays exponentially inward from the boundary, so a
       bright-polarity shape gets a lit skin and a dark core with no ring. */
    const body = glow
      ? f.dens.mul(exp(max(f.d.negate(), float(0)).div(U.uShpGlowFall).negate()))
        .mul(U.uShpGlow).toVar()
      : null;

    /* OIII confined to the hottest zone, as nebula.js and globules.js */
    const hot = smoothstep(U.uShpHotLo, U.uShpHotHi, G).toVar();
    let ha = edge;
    let oiii = edge.mul(hot.mul(U.uShpRimOiii));
    let sii = edge.mul(U.uShpRimSii);
    if (body) {
      ha = ha.add(body);
      oiii = oiii.add(body.mul(U.uShpOiii));
      sii = sii.add(body.mul(U.uShpSii));
    }
    /* fade rides the whole rim too, or the feed step (×0.3 at zero column)
       draws the frame as a ghost rectangle through border-crossing bakes. */
    rim.assign(vec3(ha, oiii, sii).mul(U.uShpGain).mul(s.fade));
  });

  return { tau, rim };
}

/* Param block in the host's units (vectors as arrays). Keys map to the uShp
   uniform suffixes; `asset` is the only build-time entry. Distances (feather,
   rimAt, rimW, rimJit, rimEps, glowFall) are in sky units; `edgeFade` is in
   frame UV, so it stays put when the entity is rescaled. */
export const SHAPE_DEFAULTS = {
  asset: 'assets/shapes/test-blob.json',
  center: [0.5, 0.5], scale: 0.62, rot: 0.0,
  feather: 0.04, edgeFade: 0.07,
  density: 1.0, core: 0.25, veil: 0.55,
  freq: 8.0, morphRate: 0.06,
  eroFreq: 18.0, eroFall: 0.6, erode: 0.3,
  threshold: 0.3, softness: 0.1,
  tau: 3.4,
  ionSrc: [1.05, 0.2], ionRadius: 0.9, hotLo: 0.5, hotHi: 0.85,
  rimFacing: 0.5, rimEps: 0.006, rimDens: 0.7,
  rimAt: 0.004, rimW: 0.012, rimJit: 0.008, rimHalo: 0.25,
  rimKnotFreq: 12.0, rimKnot: 0.6, rimGain: 2.4, rimOiii: 0.5, rimSii: 0.15,
  glow: 0.0, glowFall: 0.06, oiii: 0.35, sii: 0.1,
  gain: 1.0,
};
