/* Planetary nebula: a limb-brightened AGB shell with onion-skin thermal-pulse
   rings. Round, elliptical, and bipolar are one parameter space (aspect ×
   waist pinch). Line channels only; the central star is the continuum half. */

import {
  Fn, float, vec2, vec3, cos, dot, exp, length, mix, smoothstep,
} from 'three/tsl';
import { fbm3o2, ridged2, FBM2_NORM } from './noise.js';
import { rot2, remapCombine, shellChord } from './sdf.js';

/* Keeps the striation field off the same lattice cells as the shell's own */
const STRIA_DOMAIN = /*@__PURE__*/ vec3(19.7, 3.1, 8.3);

/* (R, T) view of the shared chord. The rim clamp matters at a deep waist pinch,
   where thick > 2R; shellChord's own normalizer keeps the peak at 1 there. */
function shellColumn(b, R, T) {
  const t = T.max(1e-4).toVar();
  return shellChord(b, R.add(t.mul(0.5)), R.sub(t.mul(0.5)).max(0.0));
}

/* fliers: false drops the ansae math from the graph entirely */
export function buildPlanetaryNodes(skyU, U, { fliers = true } = {}) {
  const line = Fn(() => {
    const zEvo = U.uTev.mul(U.uPnMorph).toVar();

    /* Polar axis is local +Y, so dividing y stretches the shell along it:
       aspect alone sweeps round → elliptical without the noise domain knowing. */
    const q = rot2(skyU.sub(U.uPnCenter), U.uPnRot.negate()).toVar();
    const e = vec2(q.x, q.y.div(U.uPnAspect.max(0.05))).toVar();
    const b = length(e).max(1e-4).toVar();
    const dirHat = e.div(b).toVar();
    /* |cos(polar angle)|, so bilateral symmetry about the equator is free */
    const mu = e.y.abs().div(b).min(1.0).toVar();

    /* uTev's 4096 h wrap bounds expansion but also resets it: one shell snap
       every ~170 days, accepted. The cap keeps the shell inside the halo. */
    const R0 = U.uPnRadius.add(U.uTev.mul(U.uPnExpand))
      .min(U.uPnRadius.mul(2.0)).max(1e-3).toVar();

    /* Field sampled on the shell's own direction circle: seamless all the way
       around, and constant along a ray, so it displaces rather than shears. */
    const ang = fbm3o2(vec3(dirHat.mul(R0.mul(U.uPnMotFreq)), zEvo.mul(0.25)).add(U.uPnOff))
      .mul(FBM2_NORM).toVar();

    /* 0 at the poles, 1 at the equator. Waist past ~0.6 walks the shell
       continuously from ellipsoid to pinched hourglass, no branch anywhere. */
    const pinch = float(1).sub(mu).max(1e-4).pow(U.uPnPinch.max(0.05)).toVar();
    /* Real bipolar lobes are open flared cones, not two closed spheres kissing:
       the polar radius has to diverge. Cubed rather than pow, it is cheaper and
       the exponent never needs to be dialed. */
    const flare = U.uPnFlare.max(0.0).mul(mu.mul(mu).mul(mu)).add(1.0).toVar();
    /* Rs is the smooth radius; the wobble is applied only to the shell, because
       ang is constant along a ray and the filled cavity would print it as spokes. */
    const Rs = R0.mul(flare).mul(float(1).sub(U.uPnWaist.mul(pinch))).max(1e-3).toVar();
    const R = Rs.mul(ang.sub(0.5).mul(U.uPnWobble).add(1.0)).max(1e-3).toVar();

    /* Cuts the polar caps so the flared walls stay open and dissolve; without it
       the flare just draws bigger closed circles. */
    const tipR = R0.mul(U.uPnTip.max(0.05)).toVar();
    const tip = float(1).sub(smoothstep(tipR, tipR.mul(U.uPnTipW.max(1.01)), b)).toVar();

    /* Species ride offset shells, OIII inside the Hα skin, which is the real
       ionization stratification and costs one add per channel. */
    const colO = shellColumn(b, R.sub(U.uPnSep).max(1e-3), U.uPnThick).mul(tip).toVar();
    const colH = shellColumn(b, R.add(U.uPnSep), U.uPnThick).mul(tip).toVar();

    /* Unit direction on xy, compressed radius on z: crests elongate outward
       into cometary knots instead of tiling the frame. */
    const stria = ridged2(
      vec3(dirHat.mul(U.uPnStriaFreq), b.mul(U.uPnStriaFreq).mul(U.uPnStriaAniso).add(zEvo))
        .add(U.uPnOff).add(STRIA_DOMAIN),
      U.uPnStriaSharp,
    ).toVar();

    /* The chord itself is the envelope, so the remap lowers the threshold most
       where the sheet folds edge-on: the ring survives, the faint disk erodes. */
    const envC = colO.max(colH).min(1.0).toVar();
    const cov = remapCombine(envC, stria, U.uPnCov, U.uPnStriaEro).toVar();
    /* Depth params clamp at the use site: past 1 these mixes go negative and
       subtract light from the shared additive line RT. */
    const breakW = mix(float(1).sub(U.uPnBreakup.clamp(0.0, 1.0)), float(1.0), cov).toVar();

    /* Thermal-pulse onion skins, gated outside the bright shell: on the shell
       they read as moiré, in the faint halo as ejected shells (A3). Darken only. */
    const ringZone = smoothstep(R0.mul(0.9), R0.mul(U.uPnRingR.max(1.0)), b)
      .mul(exp(b.div(U.uPnRingFade.max(1e-3)).negate()))
      .mul(U.uPnRing.clamp(0.0, 1.0)).toVar();
    const ringC = cos(b.mul(U.uPnRingFreq).add(U.uPnRingPhase)).mul(0.5).add(0.5);
    const rings = float(1).sub(
      float(1).sub(ringC.max(1e-4).pow(U.uPnRingSharp.max(0.0))).mul(ringZone),
    ).toVar();

    /* Denser equatorial torus (reuses the pinch curve), plus a slow wander in
       which side of the ring leads. Both are gas density, hence multiplied. */
    const torus = U.uPnTorus.max(0.0).mul(pinch).add(1.0);
    const mottle = mix(float(1).sub(U.uPnMottle.clamp(0.0, 1.0)), float(1.0),
      smoothstep(0.3, 0.7, ang)).toVar();
    const dens = breakW.mul(torus).mul(mottle).toVar();

    /* The ionized cavity: A3 calls this the brightest OIII in the sky, and a
       thin-shell chord leaves it black. Full-sphere column, so it fills. */
    const cr = b.div(Rs.sub(U.uPnSep).max(1e-3)).toVar();
    const cavE = float(1).sub(cr.mul(cr)).max(0.0).sqrt().mul(tip).toVar();
    /* Cometary knots: the erosion bites only where the column is already thin,
       which is the cavity rim and the dissolving lobe tips. Cubed, or the
       striation field prints spokes across the whole bright interior. */
    const kw = float(1).sub(cavE).toVar();
    const knots = float(1).sub(stria.mul(U.uPnStriaEro).mul(kw).mul(kw).mul(kw)).max(0.0);
    const cav = cavE.mul(knots).mul(mottle).mul(U.uPnCavity).toVar();

    /* AGB halo: much larger, much fainter, textured by the same striations,
       which is exactly where a real halo's radial combing shows up. */
    const hx = b.div(R0.mul(U.uPnHaloR).max(1e-3)).toVar();
    /* Gated inward as well as out: the envelope peaks at the center, and an
       ungated halo prints its radial combing straight across the bright lobes. */
    const he = float(1).sub(smoothstep(0.0, 1.0, hx))
      .mul(smoothstep(R0.mul(0.6), R0.mul(1.3), b)).toVar();
    /* The halo is the only place the rings apply, which is where a real AGB
       halo shows them; ringZone already fades them out with radius. */
    const halo = he.mul(he).mul(mix(float(0.3), float(1.0), stria)).mul(rings)
      .mul(U.uPnHalo).toVar();

    const ha = colH.mul(dens).mul(U.uPnHa).add(halo).toVar();
    const oiii = colO.mul(dens).mul(U.uPnOiii).add(cav).add(halo.mul(U.uPnHaloOiii)).toVar();
    const sii = colH.mul(dens).mul(U.uPnSii).toVar();

    if (fliers) {
      /* Folding y evaluates both ansae at once; the aspect divide leaves them
         stretched along the axis, which is how ansae actually present. */
      const kd = vec2(e.x, e.y.abs().sub(R0.mul(U.uPnFlierR))).toVar();
      const ks = U.uPnFlierSize.max(1e-3).toVar();
      const kx = float(1).div(dot(kd, kd).div(ks.mul(ks)).add(1.0)).toVar();
      const knot = kx.mul(kx).mul(U.uPnFlier).toVar();
      sii.addAssign(knot);
      ha.addAssign(knot.mul(U.uPnFlierHa));
    }

    return vec3(ha, oiii, sii).mul(U.uPnGain);
  })();

  /* The central white dwarf is photospheric light, so it belongs on the
     continuum path even though everything else here is line emission. */
  const continuum = Fn(() => {
    const d = skyU.sub(U.uPnCenter).toVar();
    const s = U.uPnStarSize.max(1e-4).toVar();
    const x = float(1).div(dot(d, d).div(s.mul(s)).add(1.0)).toVar();
    /* x² is the Moffat-ish core; the bare x term is the wide r^-2 skirt */
    return U.uPnStarTint.mul(x.mul(x).add(x.mul(U.uPnStarHalo)).mul(U.uPnStarLum));
  })();

  return { line, continuum };
}

/* Spread by the render spine, like FILAMENT_DEFAULTS. `fliers` is a build-time
   gate, not a uniform: the host passes it to buildPlanetaryNodes. */
export const PLANETARY_DEFAULTS = {
  center: [0.62, 0.52], rot: 0.55, aspect: 1.35, waist: 0.6, pinch: 1.7,
  flare: 1.4, tip: 0.95, tipW: 2.6, cavity: 0.55,
  radius: 0.155, expand: 0.000006, thick: 0.05, sep: 0.007, torus: 0.5,
  wobble: 0.14, motFreq: 7.0, mottle: 0.6,
  ring: 0.8, ringFreq: 150.0, ringPhase: 1.7, ringFade: 0.45,
  ringSharp: 2.4, ringR: 1.7,
  striaFreq: 11.0, striaAniso: 0.32, striaSharp: 1.4, striaEro: 0.8,
  cov: 0.8, breakup: 0.8,
  haloR: 4.0, halo: 0.35, haloOiii: 0.35,
  fliers: true, flier: 0.8, flierR: 2.2, flierSize: 0.016, flierHa: 0.9,
  starTint: [0.86, 0.9, 1.0], starLum: 1.4, starSize: 0.0045, starHalo: 0.07,
  gain: 0.22, ha: 0.85, oiii: 1.0, sii: 0.14, morphRate: 0.04,
};
