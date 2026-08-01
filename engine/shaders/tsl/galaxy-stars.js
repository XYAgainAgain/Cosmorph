/* Resolved stars over the showpiece galaxy: instanced Moffat quads placed by
   the Lin-Shu density-wave model. The glow layer still owns the unresolved
   light; this tier is only the grain the references string along the arms. */

import {
  Fn, float, vec2, vec3, vec4, cos, dot, exp, length, mix, pow,
  sin, smoothstep, sqrt, step, attribute, positionLocal, varyingProperty,
} from 'three/tsl';
import { rot2 } from './sdf.js';
import { armHarmonic, extentCut } from './galaxy-showpiece.js';

/* Moffat beta 2 wings sit at 0.35% of peak by 4 alpha, under the dither floor
   at default gain; 5 bought nothing but ~56% more additive fill per sprite. */
const QUAD_K = 4.0;

/* Pitch calibration for linked mode, applied to the analytic mid-disk match
   of ellipse-crowding pitch against the glow's log spiral. */
const LINK_PITCH = 1.0;

export function buildGalaxyStarNodes(U, { linked = true } = {}) {
  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');

  const vCorner = varyingProperty('vec2', 'vGxsCorner');
  const vLit = varyingProperty('vec4', 'vGxsLit'); // rgb, flux
  const vAlpha = varyingProperty('float', 'vGxsAlpha');

  const positionNode = Fn(() => {
    const corner = positionLocal.xy;
    vCorner.assign(corner);

    /* Both component scales ride the glow's own dials, so moving the bulge
       radius or the disk falloff carries the sprites with the light. */
    const diskR = float(1).div(U.uGxDiskFall.max(0.05)).toVar();
    const semi = iA.x.mul(mix(diskR, U.uGxBulgeR, iA.w)).toVar();

    /* The spiral IS this: nested ellipses tilted progressively with radius, so
       the arms are wherever they crowd. Nothing assigns a star to an arm. */
    const tilt = (linked
      /* Linked: pitch from the glow's winding (mid-disk match, m-arm scaled),
         and the crowding pattern co-rotates with the glow's phase and spin. */
      ? semi.mul(U.uGxWind.mul(2.0 * LINK_PITCH).div(U.uGxArmCount.max(1.0)))
        .sub(U.uGxPhase.add(U.uTev.mul(U.uGxSpin)).div(U.uGxArmCount.max(1.0)))
      : semi.mul(U.uGxsWind)
    ).toVar();
    /* Solid-body inside the bulge, like a real inner rotation curve — and the
       floor keeps unbounded uTev from running sin's argument past float32. */
    const core = U.uGxBulgeR.max(0.09).toVar();
    const psi = iA.y.sub(
      U.uGxsSpin.mul(U.uTev).div(pow(semi.max(core), U.uGxsRotExp)),
    ).toVar();
    const ex = semi.mul(cos(psi)).toVar();
    const ey = semi.mul(U.uGxsAxis).mul(sin(psi)).toVar();
    const ct = cos(tilt).toVar();
    const st = sin(tilt).toVar();
    const pn = vec2(ct.mul(ex).sub(st.mul(ey)), st.mul(ex).add(ct.mul(ey))).toVar();
    const rad = length(pn).toVar();

    const height = iA.z.mul(mix(U.uGxsZH.max(1e-4), U.uGxBulgeR, iA.w)).toVar();
    const sinI = sqrt(float(1).sub(U.uGxCosI.mul(U.uGxCosI)).max(0.0)).toVar();
    /* A proper rotation about the major axis: the in-plane minor axis shortens
       by cos i while height leans along it by sin i. */
    const app = vec2(pn.x, pn.y.mul(U.uGxCosI).add(height.mul(sinI))).toVar();
    const sky = rot2(app.mul(U.uGxSize), U.uGxPa).add(U.uGxCenter).toVar();

    /* PSF width rides luminosity — the photographic magnitude ladder is
       footprint as much as peak; the 0.7 px floor trades size for flux so slow
       parallax cannot make the faint tail shimmer and pop. */
    const aTrue = U.uGxsSize.mul(U.uGxsDpr)
      .mul(float(0.5).add(pow(iB.w, 0.4).mul(0.9))).toVar();
    const aC = aTrue.max(U.uGxsDpr.mul(0.7)).toVar();
    const energy = aTrue.mul(aTrue).div(aC.mul(aC)).toVar();
    const flux = iB.w.mul(U.uGxsGain).mul(energy).mul(extentCut(U, rad)).toVar();

    /* The showpiece's lane phase recomputed per star: it is closed form, so
       this is four trig calls instead of a texture read in the vertex stage. */
    const A = rad.max(1e-3).log().mul(U.uGxWind)
      .sub(U.uGxPhase).sub(U.uTev.mul(U.uGxSpin)).toVar();
    const dir = pn.div(rad.max(1e-4)).toVar();
    const m = mix(armHarmonic(dir, U.uGxArmCount), dir, U.uGxArmAsym).toVar();
    const ca = cos(A).toVar();
    const sa = sin(A).toVar();
    const armCos = m.x.mul(ca).add(m.y.mul(sa)).toVar();
    const armSin = m.y.mul(ca).sub(m.x.mul(sa)).toVar();
    const laneCos = armCos.mul(cos(U.uGxLanePhase)).add(armSin.mul(sin(U.uGxLanePhase)));
    const soft = U.uGxNearSoft.max(1e-3).toVar();
    const near = smoothstep(soft.negate(), soft, dir.y.mul(U.uGxNearSide)).toVar();
    const dust = pow(laneCos.mul(0.5).add(0.5).max(1e-4), U.uGxLaneSharp.max(0.0))
      .mul(near).mul(U.uGxLaneDepth).toVar();
    /* Behind is h < 0 on either lane half: the viewer side of the midplane
       never flips with tilt, and a midplane star gets half its column. */
    const hz = U.uGxsZH.max(1e-4).mul(0.5).toVar();
    const behind = float(1).sub(smoothstep(hz.negate(), hz, height)).toVar();
    flux.mulAssign(exp(dust.mul(behind).mul(U.uGxsLaneTau).negate()));

    vLit.assign(vec4(iB.xyz, flux));
    vAlpha.assign(aC);

    /* Invert the continuum pass's uv-to-sky chain, parallax pre-shift included;
       the margin divide is what the 1:1-sampled bright tier does not need. */
    const shift = U.uParallax.mul(vec2(1.0, -1.0))
      .mul(U.uDepthGx.sub(U.uDepthCont)).div(U.uResolution);
    const uvE = vec2(sky.x.sub(U.uCamera.x).div(U.uAspect), sky.y.sub(U.uCamera.y)).add(shift);
    const clip = uvE.sub(0.5).mul(2.0).div(U.uMarginScale);
    /* A faded or fully extinguished star collapses its quad to a point rather
       than rasterizing transparent fill across the frame. */
    const half = aC.mul(QUAD_K).mul(step(float(1e-5), flux)).toVar();
    const cornerClip = corner.mul(half).mul(2.0).div(U.uResolution.mul(U.uMarginScale));
    return vec3(clip.add(cornerClip), 0.0);
  })();

  const fragmentNode = Fn(() => {
    const aC = vAlpha.toVar();
    const q = vCorner.mul(aC.mul(QUAD_K)).toVar();
    const x = float(1).div(dot(q, q).div(aC.mul(aC)).add(1.0)).toVar();
    /* Moffat beta 2 minus its own value at the inscribed radius, so the wing
       lands on zero on a circle: a truncated pedestal survives the compose
       stretch as a visible grey square. */
    const EDGE2 = 1 / ((1 + QUAD_K * QUAD_K) ** 2);
    const lit = vLit.w.mul(x.mul(x).sub(EDGE2).max(0.0).mul(1 / (1 - EDGE2))).toVar();

    /* Clipped-core read: the few standouts saturate white while everything
       below keeps its blackbody color, the way a real exposure records it. */
    const tint = mix(vLit.xyz, vec3(1.0), smoothstep(0.55, 1.6, lit)).toVar();
    return vec4(tint.mul(lit), 1.0);
  })();

  return { positionNode, fragmentNode };
}
