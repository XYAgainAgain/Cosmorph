/* Volumetric dust march: a 2.5D slab per entity, one shared depth schedule for
   the whole batch. Outputs line channels, continuum, and tau — never RGB. */

import {
  Break, Fn, If, Loop, float, vec2, vec3, vec4, clamp, dot, exp, mix,
  smoothstep, struct,
} from 'three/tsl';
import {
  ign, makeFbm3, makeRidged, fbm3o2, fbm3o4, fbm3o5, ridged2, ridged4,
} from './noise.js';
import { remapCombine, rot2, sdEllipse, sdfEnvelope } from './sdf.js';

/* Compile-time ceiling; the live count is the uDmSteps uniform (ladder dial) */
const DM_MAX_STEPS = 64;

/* Own slice of the hash domain, so the erosion field and the base field never
   correlate into visible plaid. */
const ERO_DOMAIN = /*@__PURE__*/ vec3(23.0, 5.0, 61.0);

/* Forward scattering off the illuminated skin: hot and desaturated, which is
   how real ionization fronts read once the sensor clips. */
const SCATTER_TINT = /*@__PURE__*/ vec3(1.0, 0.86, 0.72);

/* The flat passes ride a raw 4-octave fbm, so `norm` rescales any octave count
   onto that range: dropping octaves then costs detail, not density. */
const FBM4_SUM = 0.9375;

const SHARED_FBM = { 2: fbm3o2, 4: fbm3o4, 5: fbm3o5 };
const SHARED_RIDGE = { 2: ridged2, 4: ridged4 };
const fbmCache = new Map();
function fbmFor(octaves) {
  const n = Math.max(1, Math.min(Math.round(octaves), 5));
  if (!fbmCache.has(n)) {
    let sum = 0;
    for (let k = 1; k <= n; k++) sum += 0.5 ** k;
    fbmCache.set(n, {
      fn: SHARED_FBM[n] ?? makeFbm3(n),
      ridge: SHARED_RIDGE[n] ?? makeRidged(n),
      norm: FBM4_SUM / sum,
    });
  }
  return fbmCache.get(n);
}

/* One struct out, so the MRT members share a single march call */
const DustOut = /*@__PURE__*/ struct({ lineTau: 'vec4', cont: 'vec4' }, 'DustOut');

/* Scaffold column source: an analytic Bok-globule blob. The envelope IS the
   areal column; texture-backed sources slot in here later, and any texture
   fetch they add must sit under textureLod (non-uniform control flow). */
function blobColumn(p, U) {
  const q = rot2(p.sub(U.uDmCenter), U.uDmRot);
  const d = sdEllipse(q, vec2(0.0), U.uDmRadius);
  return clamp(sdfEnvelope(d, U.uDmFeather).mul(U.uDmDens), 0.0, 1.0);
}

/* Smooth thickness profile, normalized so its integral over z is exactly the
   areal column. That is what makes the no-noise march match the flat pass. */
const zProfile = /*@__PURE__*/ Fn(([z, hz]) => {
  /* `half` would be the natural name and is a GLSL ES reserved word */
  const h = hz.max(1e-5).toVar();
  const t = z.div(h).toVar();
  const w = float(1).sub(t.mul(t)).max(0.0).toVar();
  return w.mul(w).mul(0.9375).div(h);
});

/* Local half-thickness: the cloud thins toward its edges in z as well as
   fading in x and y, or the silhouette reads as a cardboard cutout. */
function halfThickAt(col, U) {
  return U.uDmThick.mul(clamp(col.mul(U.uDmBias), 0.0, 1.0).sqrt())
    .max(U.uDmThick.mul(U.uDmThickMin));
}

/* The whole batch in one Fn: entities JS-unrolled inside the step body, one
   depth schedule, one running front transmittance driven by the summed dtau.
   ents: [{ sky, U, opts: { octaves, eroOctaves, shadow } }]; U carries the
   pass-level uniforms (uDmSteps, uDmDu, uDmTauCut, uDmFrontK, uDmSkip, uTev). */
export function buildDustMarchNodes(ents, U, px) {
  return Fn(() => {
    const tau = float(0).toVar();
    const line = vec3(0.0).toVar();
    const cont = vec3(0.0).toVar();

    const per = ents.map(({ sky, U: B, opts }) => {
      const skyV = sky.toVar();
      const entry = blobColumn(skyV, B).toVar();
      const h0 = halfThickAt(entry, B).toVar();
      const dp = B.uDmIonSrc.sub(skyV).toVar();
      const r2 = dot(dp, dp).toVar();
      const G = float(1).div(r2.div(B.uDmIonR2).add(1.0)).toVar();
      /* A distant source, so one direction serves the whole march */
      const L = dp.div(r2.max(1e-8).sqrt()).toVar();
      /* Lateral drift per unit depth: the eye fan is what turns the slab into
         real intra-layer parallax rather than a shifted flat image. */
      const fan = skyV.sub(B.uDmEye).div(B.uDmEyeZ).toVar();
      const sec = float(1).add(dot(fan, fan)).sqrt().toVar();
      const dl = h0.mul(U.uDmDu).mul(sec).toVar();
      const emit = float(0).toVar();
      return {
        skyV, entry, h0, G, L, fan, dl, emit, B, opts,
        base: fbmFor(opts.octaves), ero: fbmFor(opts.eroOctaves),
      };
    });

    /* Nothing to march where no entity's column arrives. This guard is the
       single biggest saving in the pass: most pixels are empty sky, and every
       one of them skips the whole fbm chain. Entry columns evaluate above it. */
    let any = per[0].entry;
    for (let i = 1; i < per.length; i++) any = any.max(per[i].entry);

    If(any.greaterThan(U.uDmSkip), () => {
      /* IGN start offset kills concentric shell banding. Spatial only: a
         temporal offset crawls visibly at wallpaper frame rates. */
      const u = float(-1).add(U.uDmDu.mul(ign(px))).toVar();
      /* Running front transmittance, scalar: it orders the skin emission. The
         vec3 extinction that leaves this pass is one exp over the summed tau. */
      const tf = float(1).toVar();

      Loop(DM_MAX_STEPS, ({ i }) => {
        If(i.greaterThanEqual(U.uDmSteps), () => { Break(); });
        const dstep = float(0).toVar();
        for (const p of per) {
          const B = p.B;
          If(p.entry.greaterThan(U.uDmSkip), () => {
            const z = p.h0.mul(u).toVar();
            const sp = p.skyV.add(p.fan.mul(z)).toVar();
            const cov = blobColumn(sp, B).toVar();
            /* Fixed-step marching has no Lipschitz requirement, so the noise-
               carved field below is deliberately not a valid SDF. Don't "fix" it. */
            const nB = p.base.fn(vec3(sp.mul(B.uDmFreq),
              z.mul(B.uDmZFreq).add(U.uTev.mul(B.uDmMorph))).add(B.uDmOff))
              .mul(p.base.norm).toVar();
            /* Ridged, not inverted Voronoi: Worley is nine integer hashes per
               evaluation, which no march can afford. The sharpen pulls its mean
               back down to Worley's. */
            const nE = p.ero.ridge(vec3(sp.mul(B.uDmEroFreq), z.mul(B.uDmZFreq))
              .add(B.uDmOff).add(ERO_DOMAIN), B.uDmEroSharp).toVar();
            /* Remap, never multiply: multiplying fades the whole cloud out
               under the noise instead of letting the noise carve its boundary. */
            const carve = remapCombine(nB, nE, cov, B.uDmErode).toVar();
            const bite = smoothstep(B.uDmTh, B.uDmTh.add(B.uDmSoft), carve).toVar();
            /* Erosion scales the column, never zeroes it: a hard chew breaks
               the continuous cloud into disconnected blotches. */
            const areal = cov.mul(mix(B.uDmVeil, float(1.0), bite)).toVar();
            const rho = areal.mul(zProfile(z, halfThickAt(cov, B))).toVar();
            const dtau = rho.mul(p.dl).mul(B.uDmTau).toVar();

            /* Brightness rides the directional column DROP toward the source,
               never an isotropic gradient: |∇fbm| draws the maze artifact. Two
               taps toward the star are both the shadow and the front gate. */
            let skin = rho;
            if (p.opts.shadow) {
              const near = blobColumn(sp.add(p.L.mul(B.uDmReach.mul(0.35))), B).toVar();
              const far = blobColumn(sp.add(p.L.mul(B.uDmReach)), B).toVar();
              const shade = exp(cov.mul(B.uDmShadowSelf).add(near).add(far.mul(0.6))
                .mul(B.uDmShadowK).negate()).toVar();
              /* A front is an interface, not merely lit material: the column
                 has to DROP toward the star, or diffuse dust glows like a rim. */
              const front = smoothstep(float(0), B.uDmFrontW, cov.sub(far)).toVar();
              skin = rho.mul(shade).mul(front);
            }
            p.emit.addAssign(skin.mul(tf).mul(p.dl));
            dstep.addAssign(dtau);
          });
        }
        tau.addAssign(dstep);
        /* Ordering only: emission is not order-independent, so tf runs off the
           TOTAL summed dtau per step. Extinction is, so tau just sums. */
        tf.mulAssign(exp(dstep.mul(U.uDmFrontK).negate()));
        u.addAssign(U.uDmDu);
        /* Early-out: transmittance is already under 0.3% at the default cutoff */
        If(tau.greaterThan(U.uDmTauCut), () => { Break(); });
      });
    });

    for (const p of per) {
      const B = p.B;
      const hot = smoothstep(B.uDmHotLo, B.uDmHotHi, p.G).toVar();
      /* A uniform front reads as an outline; real fronts bead into knots. One
         2D field outside the loop. */
      const nk = fbmFor(2).fn(vec3(p.skyV.mul(B.uDmKnotFreq),
        U.uTev.mul(B.uDmMorph)).add(B.uDmOff.mul(3.0)));
      const bead = mix(float(1).sub(B.uDmKnot), float(1), nk).toVar();
      /* The march emits a volume integral where the flat passes emit a band
         peak, so skinGain is its own dial rather than a rimGain re-tune. */
      const edge = p.emit.mul(p.G).mul(bead).mul(B.uDmRimGain).mul(B.uDmSkinGain).toVar();
      line.addAssign(vec3(edge, edge.mul(hot).mul(B.uDmRimOiii),
        edge.mul(B.uDmRimSii)).mul(B.uDmGain));
      /* Scattered starlight off the lit skin: continuum, so it skips the
         palette and pushes the brightest knots toward white, not deeper red. */
      cont.addAssign(SCATTER_TINT.mul(edge).mul(B.uDmScatter));
    }

    return DustOut(vec4(line, tau), vec4(cont, 0.0));
  })();
}

/* Marched darkDust defaults, in the host's units. Rung 0 of the degradation
   ladder: 32 steps, 4+2 octaves, shadow on. `march: true` is what routes a
   darkDust entity here instead of the flat wisp slot. */
export const DUST_MARCH_DEFAULTS = {
  center: [0.5, 0.5], radius: 0.16, squash: 1.0, rot: 0.0, feather: 0.1,
  density: 1.0, veil: 0.55,
  freq: 8.0, zDetail: 1.6, morphRate: 0.06,
  eroFreq: 18.0, erode: 0.35, eroSharp: 2.5,
  threshold: 0.3, softness: 0.1,
  tau: 4.0,
  thickness: 0.12, thickFloor: 0.18, thickBias: 1.4,
  ionSrc: [1.05, 0.2], ionRadius: 0.9, hotLo: 0.5, hotHi: 0.85,
  shadowReach: 0.26, shadowK: 2.2, shadowSelf: 0.3, frontWidth: 0.45,
  skinGain: 1.5, rimGain: 2.4, rimOiii: 0.5, rimSii: 0.15,
  knotFreq: 12.0, knot: 0.6, scatter: 0.35, gain: 1.0,
  eye: [0.5, 0.5], eyeDepth: 2.2,
  /* Build-time gates */
  octaves: 4, eroOctaves: 2, shadow: true,
  /* Pass-level (first marched entity wins) */
  steps: 32, tauCutoff: 6.0, frontK: 1.35, skipEps: 0.004,
};
