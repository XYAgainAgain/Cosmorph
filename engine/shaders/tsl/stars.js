/* Star tiers: hash-grid faint field (constant cost) + instanced bright quads.
   Moffat PSF, not Gaussian: the wide wings are what reads photographic. */

import {
  Fn, If, float, vec2, vec3, vec4, floor, dot, mix, pow, exp, abs, cos, sin,
  smoothstep, max, clamp, attribute, positionLocal, varyingProperty,
} from 'three/tsl';
import { hash3, eachNeighbor } from './noise.js';
import { twinkleMod } from './twinkle.js';

/* One faint-field grid scale. Caller folds gradient and clumping into
   `density`; 3×3 neighbor search lets wings cross cell borders cleanly.
   rgb is the star light, alpha its raw luminance for compose's twinkle. */
export const faintStarLayer = /*@__PURE__*/ Fn(([skyU, pxPerUnit, cells, density, brightScale, off]) => {
  const g = skyU.mul(cells);
  const base = floor(g);
  const acc = vec4(0.0).toVar();
  const pxScale = pxPerUnit.div(cells);

  eachNeighbor((o) => {
    const c = base.add(o);
    const h1 = hash3(vec3(c, 7.0).add(off)).toVar();

    /* An empty cell contributes exactly zero, so the branch skips its second
       hash, three pows, and the PSF. */
    If(h1.z.lessThanEqual(density), () => {
      const h2 = hash3(vec3(c, 91.0).add(off));

      const starG = c.add(h1.xy);
      const dPx = g.sub(starG).mul(pxScale);

      /* Steep magnitude power law: a uniform brightness roll is the single
         most obvious tell of a fake field */
      const rel = pow(h2.x, 3.0);
      const L = pow(h2.x, 6.0).mul(brightScale);

      /* Flux-preserving sub-pixel clamp: shrink no further than ~0.7 px,
         dim instead, or slow parallax makes stars shimmer and pop */
      const aTrue = mix(0.45, 1.25, rel);
      const aC = max(aTrue, 0.7);
      const energy = aTrue.mul(aTrue).div(aC.mul(aC));

      const r2 = dot(dPx, dPx).div(aC.mul(aC));
      const x = float(1).div(r2.add(1));
      const psf = x.mul(x); // Moffat β=2 fast path

      const t = pow(h2.y, 0.45);
      const col = mix(
        mix(vec3(1.0, 0.76, 0.5), vec3(1.0, 1.0, 1.0), smoothstep(0.0, 0.55, t)),
        vec3(0.72, 0.79, 1.0),
        smoothstep(0.55, 1.0, t),
      );
      /* Dim stars sit near the noise floor and read colorless */
      const colS = mix(vec3(1.0), col, smoothstep(0.0, 0.12, rel));

      /* Amplitude, never phase: a baked phase would snap the whole field on
         every rebake, so compose owns the modulation. */
      const amp = L.mul(energy).mul(psf);
      acc.addAssign(vec4(colS.mul(amp), amp));
    });
  });
  return acc;
}).setLayout({
  name: 'faintStarLayer',
  type: 'vec4',
  inputs: [
    { name: 'skyU', type: 'vec2' }, { name: 'pxPerUnit', type: 'float' },
    { name: 'cells', type: 'float' }, { name: 'density', type: 'float' },
    { name: 'brightScale', type: 'float' }, { name: 'off', type: 'vec3' },
  ],
});

/* Bright tier. iA = sky xy, brightness, depth; iB = rgb, twinkle phase;
   iC = alpha px, spike len px, quad half px, beta; iD = spike angle jitter,
   arm ratio, halo amp, halo radius. `occlude` maps a star's sky position to a
   dust transmittance — an opt-in, deliberate break with additive-last. */
export function buildBrightStarNodes(U, { occlude = null } = {}) {
  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const iC = attribute('iC', 'vec4');
  const iD = attribute('iD', 'vec4');

  const vLocal = varyingProperty('vec2', 'vLocal');
  const vCorner = varyingProperty('vec2', 'vCorner');
  const vColor = varyingProperty('vec3', 'vColor');
  const vMisc = varyingProperty('vec3', 'vMisc'); // L, alphaPx, beta
  const vSpike = varyingProperty('vec3', 'vSpike'); // len px, arm ratio, halo amp
  const vHalo = varyingProperty('vec2', 'vHalo'); // halo radius, wide-halo gate
  /* Per-star terms resolved once per vertex: twinkle, spike cos and sin, spike amp */
  const vStar = varyingProperty('vec4', 'vStar');
  /* Only declared when the gate is on, so an unoccluded build carries no extra varying */
  const vTrans = occlude ? varyingProperty('vec3', 'vTrans') : null;

  const positionNode = Fn(() => {
    const corner = positionLocal.xy;
    vCorner.assign(corner);
    vLocal.assign(corner.mul(iC.z));
    vColor.assign(iB.xyz);
    vMisc.assign(vec3(iA.z, iC.x, iC.w));
    const spikeAt = U.uSpikeAngle.add(iD.x.mul(U.uSpikeJitter)).toVar();
    vSpike.assign(vec3(iC.y, iD.y, iD.z));
    vHalo.assign(vec2(iD.w, smoothstep(0.10, 0.42, iA.z)));
    /* The same law compose runs over the baked field, so the two tiers scintillate
       as one sky. Phases arrive pre-wrapped to [0,1) so sin stays small. */
    vStar.assign(vec4(
      twinkleMod(U.uTwinklePhase, iB.w, U.uTwinkleDepth),
      cos(spikeAt), sin(spikeAt),
      /* Diffraction redistributes light; only saturated cores show spikes, and
         the steep gate is what keeps that to the top of the flux distribution */
      clamp(iA.z.sub(U.uSpikeThreshold).mul(4.5), 0.0, 1.0),
    ));
    /* Per star, not per fragment: a lane is far wider than one PSF, and the
       vertex path costs four samples instead of a hundred thousand. */
    if (vTrans) vTrans.assign(occlude(iA.xy));

    /* Instance positions are absolute sky coords; the camera subtracts here so
       a pan needs no buffer rewrite until the tile block itself moves. */
    const uvStar = vec2(iA.x.sub(U.uCamera.x).div(U.uAspect), iA.y.sub(U.uCamera.y));
    const clip = uvStar.mul(2.0).sub(1.0);
    const cornerClip = corner.mul(iC.z).mul(2.0).div(U.uResolution);
    const parallaxClip = U.uParallax.mul(iA.w).mul(2.0).div(U.uResolution);
    return vec3(clip.add(cornerClip).add(parallaxClip), 0.0);
  })();

  const fragmentNode = Fn(() => {
    const q = vLocal;
    const L0 = vMisc.x;
    const alphaPx = vMisc.y;
    const beta = vMisc.z;
    const L = L0.mul(vStar.x);

    const a2 = alphaPx.mul(alphaPx);
    const r2 = dot(q, q);
    const core = pow(r2.div(a2).add(1.0), beta.negate());
    /* Two taps at geometric scales, not one: a single Moffat visibly terminates,
       and the sum approximates the power-law scatter tail that reads as glow. */
    const halo = pow(r2.div(a2.mul(22.0)).add(1.0), -2.2).mul(0.1);
    /* Both gates are constant across a star, so each branch is coherent per
       quad: the faint majority skips the wide pow and the whole spike block. */
    const wide = float(0.0).toVar();
    If(vHalo.y.greaterThan(0.0), () => {
      wide.assign(pow(r2.div(a2.mul(vHalo.x).mul(140.0)).add(1.0), -1.35)
        .mul(vSpike.z).mul(0.06).mul(vHalo.y));
    });
    const coreI = L.mul(core.add(halo).add(wide));

    const spikeRGB = vec3(0.0).toVar();
    If(vStar.w.greaterThan(0.0), () => {
      /* Angle, arm ratio, and beta are all per-star: one shared cross stamped on
         every star is the tell the eye catches once a dozen are on screen. */
      const ca = vStar.y;
      const sa = vStar.z;
      const qr = vec2(ca.mul(q.x).sub(sa.mul(q.y)), sa.mul(q.x).add(ca.mul(q.y)));
      const len = vSpike.x.mul(0.30);
      const lenA = len.mul(vSpike.y);
      const lenB = len.div(vSpike.y);
      const w2 = float(2.4);

      const spikeCh = (scale) => {
        const qc = qr.mul(scale);
        const bar1 = exp(abs(qc.x).negate().div(lenA)).mul(exp(qc.y.mul(qc.y).negate().div(w2)));
        const bar2 = exp(abs(qc.y).negate().div(lenB)).mul(exp(qc.x.mul(qc.x).negate().div(w2)));
        const bead = cos(abs(qc.x).add(abs(qc.y)).mul(0.22)).mul(0.22).add(0.78);
        return bar1.add(bar2).mul(bead);
      };
      const spike = vec3(spikeCh(1.0), spikeCh(1.08), spikeCh(1.15));
      const spikeTint = mix(vColor, vec3(0.88, 0.92, 1.0), 0.6);
      spikeRGB.assign(spike.mul(spikeTint).mul(vStar.w).mul(L).mul(0.85));
    });

    /* Clipped-core effect: white center, spectral color in the wings */
    const colC = mix(vColor, vec3(1.0), smoothstep(0.16, 0.62, coreI));

    /* Soft window, no Discard: discard defeats tile-GPU optimization.
       Edges ascend; reversed smoothstep edges are undefined per spec. */
    const edge = float(1).sub(smoothstep(0.86, 1.0, max(abs(vCorner.x), abs(vCorner.y))));

    const lit = colC.mul(coreI).add(spikeRGB).mul(edge).mul(U.uStarGain);
    return vec4(vTrans ? lit.mul(vTrans) : lit, 1.0);
  })();

  return { positionNode, fragmentNode };
}
