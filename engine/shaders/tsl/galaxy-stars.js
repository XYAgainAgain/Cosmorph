/* Resolved stars over the showpiece galaxy: instanced Moffat quads placed by
   the Lin-Shu density-wave model. The glow layer still owns the unresolved
   light; this tier is only the grain the references string along the arms. */

import {
  Fn, float, vec2, vec3, vec4, cos, dot, exp, floor, length, mix, pow,
  sign, sin, smoothstep, sqrt, step, attribute, positionLocal, varyingProperty,
} from 'three/tsl';
import { rot2 } from './sdf.js';
import { hash1 } from './noise.js';
import { armHarmonic, extentCut } from './galaxy-showpiece.js';
import { spinAngle } from './spin.js';
import { twinkleMod } from './twinkle.js';

/* Moffat beta 2 wings sit at 0.35% of peak by 4 alpha, under the dither floor
   at default gain; 5 bought nothing but ~56% more additive fill per sprite. */
const QUAD_K = 4.0;

/* Pitch calibration for linked mode, applied to the analytic mid-disk match
   of ellipse-crowding pitch against the glow's log spiral. */
const LINK_PITCH = 1.0;

export function buildGalaxyStarNodes(U, { linked = true, preShift = true } = {}) {
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
        .sub(U.uGxPhase.div(U.uGxArmCount.max(1.0)))
      : semi.mul(U.uGxsWind).mul(sign(U.uGxWind))
    ).toVar();
    const core = U.uGxBulgeR.max(0.09).toVar();
    const psi = iA.y.toVar();
    const ex = semi.mul(cos(psi)).toVar();
    /* Axis ratio eases to round at both ends: a real bulge is a spheroid, and
       the outskirts relax into halo instead of ending on an elliptical edge. */
    const qw = smoothstep(core.mul(0.5), core.mul(1.5), semi)
      .mul(float(1).sub(smoothstep(U.uGxCutIn, U.uGxCutOut.max(U.uGxCutIn.add(1e-3)), semi)))
      .toVar();
    const ey = semi.mul(mix(float(1.0), U.uGxsAxis, qw)).mul(sin(psi)).toVar();
    const ct = cos(tilt).toVar();
    const st = sin(tilt).toVar();
    const pn = vec2(ct.mul(ex).sub(st.mul(ey)), st.mul(ex).add(ct.mul(ey))).toVar();

    const height = iA.z.mul(mix(U.uGxsZH.max(1e-4), U.uGxBulgeR, iA.w)).toVar();
    const sinI = sqrt(float(1).sub(U.uGxCosI.mul(U.uGxCosI)).max(0.0)).toVar();
    /* Compose can only recover apparent disc position, so bake the orbit in
       that same deprojected frame, including the star's projected height. */
    const disc = vec2(pn.x, pn.y.add(height.mul(sinI).div(U.uGxCosI))).toVar();
    const rad = length(disc).toVar();
    const spun = rot2(disc, spinAngle(U, rad)).toVar();
    const app = vec2(spun.x, spun.y.mul(U.uGxCosI)).toVar();
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
    /* The lane stays in the pre-spin disc frame, matching the glow before its
       sky projection turns the complete pattern. */
    const A = rad.max(1e-3).log().mul(U.uGxWind).sub(U.uGxPhase).toVar();
    const dir = disc.div(rad.max(1e-4)).toVar();
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

    /* Live-path twinkle, shared law with both other star tiers. Per instance
       rather than per texel: uGxsTwinkle is 0 in a bake, where the Astar stamp
       below carries this sprite's scintillation through compose instead. */
    const point = U.uGxsDpr.mul(0.7).div(aC).clamp(0.0, 1.0).toVar();
    /* Instance data floored onto a lattice first, so the hash stays integer-based
       and lands identically on WebGPU, WebGL2, and GLES. */
    const twPh = hash1(floor(vec3(
      iA.x.mul(4096.0), iA.y.mul(651.0), iB.w.mul(997.0),
    ))).toVar();
    flux.mulAssign(twinkleMod(
      U.uTwinklePhase, twPh, U.uTwinkleFieldDepth.mul(point).mul(U.uGxsTwinkle),
    ));

    vLit.assign(vec4(iB.xyz, flux));
    vAlpha.assign(aC);

    /* Invert the continuum pass's uv-to-sky chain, parallax pre-shift included;
       the margin divide is what the 1:1-sampled bright tier does not need. */
    const skyUv = vec2(sky.x.sub(U.uCamera.x).div(U.uAspect), sky.y.sub(U.uCamera.y));
    /* A bake must be valid at any parallax, so the baked sprite drops the
       pre-shift; freezing one sample into the RT shears the field on rebake. */
    const uvE = preShift
      ? skyUv.add(U.uParallax.mul(vec2(1.0, -1.0))
        .mul(U.uDepthGx.sub(U.uDepthCont)).div(U.uResolution))
      : skyUv;
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

    /* Extended sources do not scintillate. Alpha is the twinkle amplitude, cut
       by apparent size, so sprites at the sub-pixel floor shimmer and the
       resolved ones read steady. Zeroed on the live path, which twinkles this
       sprite in the vertex stage and would otherwise modulate it twice. */
    const point = U.uGxsDpr.mul(0.7).div(aC).clamp(0.0, 1.0).toVar();
    return vec4(tint.mul(lit), lit.mul(point).mul(U.uGxsTwinkle.oneMinus()));
  })();

  return { positionNode, fragmentNode };
}
