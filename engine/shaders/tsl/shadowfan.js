/* Hubble's Variable Nebula: a reflection fan flaring from a star at its apex,
   with dust knots orbiting close in that throw slowly rotating shadow bands
   down the cone. Continuum only, since scattered starlight carries no lines. */

import {
  Fn, float, floor, vec2, vec3, cos, sin, dot, exp, fract, mix, pow, smoothstep,
} from 'three/tsl';
import { fbm3o2, fbm3o4, hash3, FBM2_NORM, FBM2_MID, FBM4_NORM } from './noise.js';

const TURN = Math.PI * 2;
const WRAP_H = 4096.0;

/* Independent slices of the noise domain */
const MOTTLE_DOMAIN = /*@__PURE__*/ vec3(3.9, 12.7, 6.1);
const WOBBLE_DOMAIN = /*@__PURE__*/ vec3(21.3, 7.9, 33.1);

/* Dust column of the fan: direction on two axes, radius on the third. Aniso
   below 1 stretches the cells outward, so streaks run down the cone. */
function dustSheet(dirHat, r, U) {
  /* uTev's 4096 h wrap bounds this drift near 200 domain units, so it needs no
     cap of its own; the wrap costs one dust snap every ~170 days. */
  const along = r.mul(U.uFanFreq).mul(U.uFanAniso).add(U.uTev.mul(U.uFanMorph));
  return fbm3o4(vec3(dirHat.mul(U.uFanFreq), along).add(U.uFanOff)).mul(FBM4_NORM);
}

/* How far the axis has swung by radius r. NGC 2261 curls; a fixed axis can only
   ever draw a wedge. */
function bendAt(r, len, U) {
  return U.uFanCurl.mul(r.div(len).min(1.5));
}

/* Polar frame about the apex plus the dust coverage that both outputs share.
   Unnamed vars throughout: this inlines into whichever stage calls it, and the
   continuum and the tau both calling it in one stage would clash on a name. */
function fanField(sky, U) {
  const d = sky.sub(U.uFanApex).toVar();
  const d2 = dot(d, d).toVar();
  const r = d2.max(1e-12).sqrt().toVar();
  const dirHat = d.div(r).toVar();
  const len = U.uFanLen.max(1e-3).toVar();

  /* Cone extent via the direction dot product, not atan: no branch cut, and
     cos is monotone on [0,PI] so the smoothstep edges stay ascending. */
  const bend = bendAt(r, len, U).toVar();
  const axis = vec2(cos(U.uFanAngle.add(bend)), sin(U.uFanAngle.add(bend)));

  /* Radius-dependent half-angle: a mid-length bulge plus a slow wobble, so the
     silhouette widens and ripples like a comet head instead of ruling an edge. */
  const wob = fbm3o2(vec3(dirHat.mul(U.uFanWobFreq), r.mul(U.uFanWobFreq))
    .add(U.uFanOff).add(WOBBLE_DOMAIN)).sub(FBM2_MID).mul(U.uFanWobble).toVar();
  const bulge = sin(r.div(len).min(1.0).mul(Math.PI)).mul(U.uFanBulge).toVar();
  const half = U.uFanHalf.mul(float(1).add(bulge)).add(wob).max(0.02).toVar();

  const cosIn = cos(half.min(Math.PI)).toVar();
  const cosOut = cos(half.add(U.uFanEdge).min(Math.PI)).min(cosIn.sub(1e-4));
  const ext = smoothstep(cosOut, cosIn, dot(dirHat, axis)).toVar();

  /* Same wobble on the tip boundary, or the fan ends on a clean circular arc */
  const rT = r.add(wob.mul(len)).toVar();
  const tipLo = len.mul(float(1).sub(U.uFanFade.max(0.0).min(0.95))).min(len.sub(1e-4));
  const env = ext.mul(float(1).sub(smoothstep(tipLo, len, rT))).toVar();

  /* Envelope lowers the threshold the dust must clear (remap doctrine, sdf.js).
     The floor only keeps the cone continuous under that structure. */
  const th = mix(float(1.0), U.uFanTh, env).toVar();
  const dens = smoothstep(th, th.add(U.uFanSoft.max(1e-3)), dustSheet(dirHat, r, U));
  const body = dens.max(env.mul(U.uFanFloor.max(0.0).min(1.0))).toVar();

  return { d2, r, len, dirHat, ext, body };
}

/* Transmission past the orbiting knots, purely angular about the apex. Bands
   multiply, so two crossing shadows deepen instead of clipping at one floor. */
function shadowTrans(f, U, count) {
  const r = f.r;
  /* The penumbra widens downstream: a knot's umbra shrinks relative to its
     half-shadow the further the light has traveled from the apex. */
  const pen = U.uFanPen.max(0.0)
    .add(r.div(f.len).mul(U.uFanPenGrow.max(0.0))).toVar();
  /* Direction is meaningless at the star, and a knot cannot shade its own orbit */
  const reach = smoothstep(0.0, U.uFanShadowIn.max(1e-4), r)
    .mul(U.uFanShadow.max(0.0).min(1.0)).toVar();
  /* Bands ride the fan's own bend so they curve with it rather than crossing it */
  const bend = bendAt(r, f.len, U).toVar();
  const trans = float(1.0).toVar();

  for (let k = 0; k < count; k++) {
    const h = hash3(U.uFanOff.add(vec3(k * 3 + 1, k * 7 + 5, k * 13 + 11))).toVar();
    /* Rates differ per knot so the bands drift apart instead of turning as one
       wheel; whole turns per wrap keeps each seamless across the uTev reset. */
    const spin = float(1).add(h.z.sub(0.5).mul(U.uFanSpread));
    const turnsK = floor(U.uFanRot.mul(WRAP_H).mul(spin).add(0.5)).toVar();
    const ang = fract(h.x.add(U.uTev.mul(turnsK).div(WRAP_H))).mul(TURN).toVar();
    /* Per-band curl and a sine wander in r: the real lanes are irregular and
       none of them is straight. */
    const curl = ang.add(bend)
      .add(h.z.sub(0.5).mul(U.uFanBandCurl).mul(r.div(f.len)))
      .add(sin(r.mul(U.uFanBandWobFreq).add(h.y.mul(TURN))).mul(U.uFanBandWob)).toVar();
    const halfW = U.uFanShadowW.max(1e-3).mul(mix(float(0.6), float(1.4), h.y)).toVar();
    const cIn = cos(halfW.min(Math.PI)).toVar();
    const cOut = cos(halfW.add(pen).min(Math.PI)).min(cIn.sub(1e-4));
    const band = smoothstep(cOut, cIn, dot(f.dirHat, vec2(cos(curl), sin(curl))));
    trans.mulAssign(float(1).sub(band.mul(reach)));
  }
  return trans.max(0.0);
}

/* Apex star: same Moffat-plus-clamp shape as echo.js's; R Mon is a bright
   obvious point at the tip in every NGC 2261 reference. */
function apexStar(sky, U) {
  const dPx = sky.sub(U.uFanApex).mul(U.uPxPerUnit).toVar();
  const aTrue = U.uFanStarR.mul(U.uPxPerUnit).toVar();
  const aC = aTrue.max(0.7).toVar();
  const energy = aTrue.mul(aTrue).div(aC.mul(aC)).toVar();
  const x = float(1).div(dot(dPx, dPx).div(aC.mul(aC)).add(1.0)).toVar();
  return x.mul(x).add(x.mul(U.uFanStarHalo)).mul(energy).mul(U.uFanStarLum).toVar();
}

/* `shadowCount` is build time on purpose: at 0 the knots emit no instructions
   at all, rather than a loop multiplying by one. */
export function buildShadowFanNodes(skyU, U, opts = {}) {
  const knots = Math.max(0, Math.round(opts.shadowCount ?? SHADOWFAN_DEFAULTS.shadowCount));
  /* Explicit build gate, not derived from the live mottle value: keying the
     graph off a slider-bound param would leave that slider silently dead. */
  const useMottle = opts.mottle ?? SHADOWFAN_DEFAULTS.mottleOn;

  const continuum = Fn(() => {
    const f = fanField(skyU, U);

    const litR2 = U.uFanLitR.mul(U.uFanLitR).max(1e-4);
    /* base >= 1, so the negative power is always defined */
    const lit = pow(f.d2.div(litR2).add(1.0), U.uFanFalloff.max(0.05).negate()).toVar();

    /* A cone is a sheet, and a sheet is brightest where it folds edge-on, which
       is at its walls: the accent comes from ext's own transition, not noise. */
    const wall = f.ext.mul(float(1).sub(f.ext)).mul(4.0);
    const limb = float(1).add(U.uFanLimb.max(0.0).mul(wall)).toVar();

    /* The dense inner lobe. Every NGC 2261 reference has a distinct bright blob
       sitting just off the apex, which a 1/r² ramp alone never produces. */
    const lb = f.r.sub(U.uFanLobeAt).div(U.uFanLobeW.max(1e-3)).toVar();
    const lobe = exp(lb.mul(lb).negate()).mul(f.ext).mul(U.uFanLobe).toVar();

    const warm = float(1).sub(smoothstep(0.0, U.uFanWarmR.max(1e-3), f.r));
    const tint = mix(U.uFanTint, U.uFanWarm, warm.mul(U.uFanWarmAmt.clamp(0.0, 1.0)));

    let amp = f.body.mul(lit).mul(limb).mul(float(1).add(lobe)).mul(U.uFanLum);
    if (useMottle) {
      /* Amplitude modulation only, at a frequency the coverage field never sees:
         the cone would otherwise read as a smoothly airbrushed wedge. */
      const mot = fbm3o2(vec3(skyU.mul(U.uFanMotFreq), U.uTev.mul(U.uFanMorph))
        .add(U.uFanOff).add(MOTTLE_DOMAIN)).mul(FBM2_NORM);
      amp = amp.mul(mix(float(1).sub(U.uFanMottle).max(0.0), float(1.0), mot));
    }
    if (knots > 0) amp = amp.mul(shadowTrans(f, U, knots));
    return tint.mul(amp).add(U.uFanStarCol.mul(apexStar(skyU, U)));
  })();

  return { continuum, tauAt: (sky) => shadowFanTau(sky, U) };
}

/* Shadows are illumination, not density: knots block light without changing the
   dust column. Module-level like reflectionTau, so compose imports it directly. */
export function shadowFanTau(skyW, U) {
  return fanField(skyW, U).body.mul(U.uFanTau.max(0.0));
}

/* Param block in the host's units (vectors as arrays). Keys map to the uFan
   uniform suffixes; `shadowCount` and `mottleOn` are the build-time entries. */
export const SHADOWFAN_DEFAULTS = {
  mottleOn: true,
  apex: [0.74, 0.78], angle: -2.15, half: 0.34, edge: 0.16,
  len: 0.62, fade: 0.45, litR: 0.14, falloff: 1.0,
  curl: 0.45, bulge: 0.55, wobble: 0.16, wobFreq: 3.2,
  lum: 0.85, tint: [0.62, 0.76, 1.0], warm: [1.0, 0.82, 0.62],
  warmR: 0.05, warmAmt: 0.45, limb: 0.5,
  lobe: 1.5, lobeAt: 0.07, lobeW: 0.06,
  starLum: 1.4, starR: 0.005, starHalo: 0.06, starCol: [1.0, 0.94, 0.86],
  freq: 9.0, aniso: 1.0, threshold: 0.38, softness: 0.3, floor: 0.42,
  mottle: 0.45, motFreq: 9.0, morphRate: 0.05,
  shadowCount: 3, shadow: 0.75, shadowW: 0.2, shadowIn: 0.03,
  pen: 0.045, penGrow: 0.14, spread: 0.5, rotRate: 0.0016,
  bandCurl: 0.6, bandWob: 0.11, bandWobFreq: 9.0,
  tau: 0.18,
};
