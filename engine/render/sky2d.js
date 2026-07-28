/* 2D render spine: three half-float accumulation targets (line, continuum,
   bright stars) composed through the grading chain to the canvas. Walks an
   entity-array scene config; layer shaders never output RGB directly. */

import * as THREE from 'three/webgpu';
import { uniform, uv, vec2, vec4 } from 'three/tsl';
import { createRng, deriveSeed } from '../core/rng.js';
import { generateBrightStars } from '../entities/stars.js';
import { buildBrightStarNodes } from '../shaders/tsl/stars.js';
import { buildEmissionNodes } from '../shaders/tsl/nebula.js';
import { buildContinuumNodes } from '../shaders/tsl/dust.js';
import { buildReflectionNodes, REFLECTION_DEFAULTS } from '../shaders/tsl/reflection.js';
import { buildFilamentNodes, FILAMENT_DEFAULTS } from '../shaders/tsl/filaments.js';
import { buildEchoNodes, ECHO_DEFAULTS } from '../shaders/tsl/echo.js';
import { buildShadowFanNodes, SHADOWFAN_DEFAULTS } from '../shaders/tsl/shadowfan.js';
import { buildSearchlightNodes, SEARCHLIGHT_DEFAULTS } from '../shaders/tsl/searchlight.js';
import { buildPlanetaryNodes, PLANETARY_DEFAULTS } from '../shaders/tsl/planetary.js';
import { buildJetNodes, JET_DEFAULTS } from '../shaders/tsl/jets.js';
import { buildWrBubbleNodes, WRBUBBLE_DEFAULTS } from '../shaders/tsl/wrbubble.js';
import { buildComposeNodes } from '../shaders/tsl/compose.js';

/* Narrowband palettes as mat3 rows R/G/B over vec3(Hα, OIII, SII).
   Community default is natural HOO; SHO reads dated to many eyes now. */
export const PALETTES = {
  hooNatural: [1, 0, 0, 0.15, 0.85, 0, 0, 1, 0],
  hooBold: [1, 0, 0, 0.35, 0.65, 0, 0, 1, 0],
  sho: [0, 0, 1, 1, 0, 0, 0, 1, 0],
  cfht: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

const DEFAULTS = {
  emission: {
    freq: 1.35, warp: 1.3, mottle: 1.3, stria: 0.35,
    ionSrc: [1.05, 0.8], ionRadius: 0.75, hotLo: 0.55, hotHi: 0.9,
    oiii: 0.55, sii: 0.12, morphRate: 0.35,
    covLo: 0.3, covHi: 0.48, contrast: 1.2, gain: 1.2,
  },
  ifn: { freq: 1.3, amp: 0.16, morphRate: 0.08 },
  stars: {
    density: 0.75, bandY: 0.32, bandTilt: -0.28, bandGain: 0.45, bandWidth: 0.55,
    count: 84, twinkleDepth: 0.3, twinkleRate: 1800, spikeAngle: 0.35,
    spikeThreshold: 0.5, gain: 1.0,
  },
  darkDust: { freq: 3.2, threshold: 0.55, softness: 0.12, tau: 2.8, morphRate: 0.18 },
  globules: {
    freq: 3.2, radius: 0.34, fill: 0.6, core: 0.45, elong: 2.4, taper: 0.9,
    cometary: true, detail: 2.4, morphRate: 0.1,
    eroFreq: 5.0, eroFall: 0.6, erode: 0.3,
    threshold: 0.28, softness: 0.1, tau: 3.2,
    ionSrc: [1.05, 0.8], ionRadius: 0.9, hotLo: 0.5, hotHi: 0.85,
    rimEps: 0.006, rimFacing: 6.0, rimAt: 0.35, rimW: 0.22, rimHalo: 0.25,
    rimKnotFreq: 12.0, rimKnot: 0.6, rimGain: 1.2, rimOiii: 0.5, rimSii: 0.15,
  },
  /* Tighter than the module's own defaults: a shallow falloff over a 0.26 sky
     unit radius washes the whole frame instead of lighting one cloud. */
  reflection: {
    ...REFLECTION_DEFAULTS,
    radius: [0.14, 0.17, 0.22], falloff: [2.6, 2.3, 1.9],
    filFreq: 14.0, filAniso: 2.5, filAmp: 0.35,
  },
  filaments: { ...FILAMENT_DEFAULTS },
  echo: { ...ECHO_DEFAULTS },
  shadowFan: { ...SHADOWFAN_DEFAULTS },
  searchlight: { ...SEARCHLIGHT_DEFAULTS },
  planetary: { ...PLANETARY_DEFAULTS },
  jets: { ...JET_DEFAULTS },
  wrbubble: { ...WRBUBBLE_DEFAULTS },
};

/* Must match the overscan default in entities/stars.js: the bright tier tiles
   at exactly the generation span, so a mismatch would show a seam under pan. */
const BRIGHT_OVERSCAN = 0.06;

/* WebGPU aligns every readback row to 256 bytes, so any width whose stride
   misses that alignment comes back padded and has to be repacked. WebGL2
   returns tight rows and falls through. */
function repackRows(raw, width, height) {
  const tight = width * 4;
  if (raw.byteLength === tight * height) {
    return new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  /* The trailing row carries no padding, so the buffer is one stride short of
     stride × height and the length alone cannot tell you the stride. */
  const stride = Math.ceil(tight / 256) * 256;
  if (raw.byteLength < (height - 1) * stride + tight) {
    throw new Error(`readback returned ${raw.byteLength} bytes for ${width}×${height}.`);
  }
  const src = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Uint8ClampedArray(tight * height);
  for (let y = 0; y < height; y++) {
    out.set(src.subarray(y * stride, y * stride + tight), y * tight);
  }
  return out;
}

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

function offsetFrom(seed, salt) {
  const rng = createRng(deriveSeed(seed, salt));
  return new THREE.Vector3(
    Math.floor(rng.next() * 256), Math.floor(rng.next() * 256), Math.floor(rng.next() * 256),
  );
}

export async function createSky2D({ canvas, config, forceWebGL = false, maxParallaxPx = 14 }) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 1);
  await renderer.init();

  /* Base layers write fixed shader slots, so they stay one-per-type. Feature
     entities may repeat: each instance gets its own uniform bag, and its nodes
     sum into the shared RTs like any other member of its cost class. */
  const byType = {};
  const featureEnts = {
    globules: [], reflection: [], filaments: [],
    echo: [], shadowFan: [], searchlight: [], planetary: [], jets: [], wrbubble: [],
  };
  for (const e of config.entities) {
    if (featureEnts[e.type]) {
      featureEnts[e.type].push(e);
      continue;
    }
    if (byType[e.type]) {
      console.warn(`Cosmorph: sky2d takes one "${e.type}" entity; the duplicate was dropped.`);
      continue;
    }
    byType[e.type] = e;
  }

  const P = {
    emission: { ...DEFAULTS.emission, ...byType.emission?.params },
    ifn: { ...DEFAULTS.ifn, ...byType.ifn?.params },
    stars: { ...DEFAULTS.stars, ...byType.stars?.params },
    darkDust: { ...DEFAULTS.darkDust, ...byType.darkDust?.params },
  };

  /* An unseeded duplicate still needs its own field, so instance 0 keeps the
     scene seed (bit-parity with the singleton era) and later ones derive. */
  function instanceSeed(e, salt, k) {
    return e.seed ?? (k === 0 ? config.seed : deriveSeed(config.seed, salt * 1000 + k));
  }

  /* Camera pan in sky units, folded into every field coordinate. Exactly zero
     is the untouched state and must stay arithmetically inert. */
  let camX = config.camera?.x ?? 0;
  let camY = config.camera?.y ?? 0;

  const paletteRows = PALETTES[config.palette] ?? PALETTES.hooNatural;
  const scnrDefault = config.palette === 'sho' ? 0.7 : (config.scnr ?? 0);
  const stretchK = config.stretchK ?? 14;

  const U = {
    uResolution: uniform(new THREE.Vector2(1, 1)),
    uAspect: uniform(1),
    uMarginScale: uniform(new THREE.Vector2(1, 1)),
    uPxPerUnit: uniform(1),
    uParallax: uniform(new THREE.Vector2(0, 0)),
    uCamera: uniform(new THREE.Vector2(camX, camY)),
    uTev: uniform(0),

    uNebFreq: uniform(P.emission.freq),
    uWarp: uniform(P.emission.warp),
    uMottle: uniform(P.emission.mottle),
    uStria: uniform(P.emission.stria),
    uIonSrc: uniform(new THREE.Vector2(0, 0)),
    uIonR2: uniform(Math.max(P.emission.ionRadius ** 2, 1e-4)),
    uHotLo: uniform(P.emission.hotLo),
    uHotHi: uniform(Math.max(P.emission.hotHi, P.emission.hotLo + 0.001)),
    uOiii: uniform(P.emission.oiii),
    uSii: uniform(P.emission.sii),
    uMorphRate: uniform(P.emission.morphRate),
    uCovLo: uniform(P.emission.covLo),
    uCovHi: uniform(Math.max(P.emission.covHi, P.emission.covLo + 0.001)),
    uNebContrast: uniform(P.emission.contrast),
    uNebGain: uniform(P.emission.gain),
    uNebOff: uniform(offsetFrom(byType.emission?.seed ?? config.seed, 11)),

    uIfnFreq: uniform(P.ifn.freq),
    uIfnAmp: uniform(P.ifn.amp),
    uIfnMorph: uniform(P.ifn.morphRate),
    uIfnOff: uniform(offsetFrom(byType.ifn?.seed ?? config.seed, 23)),

    uStarDensity: uniform(P.stars.density),
    uBandY: uniform(P.stars.bandY),
    uBandTilt: uniform(P.stars.bandTilt),
    uBandGain: uniform(P.stars.bandGain),
    uBandWidth: uniform(P.stars.bandWidth),
    uClumpOff: uniform(offsetFrom(byType.stars?.seed ?? config.seed, 31)),
    uStarOffA: uniform(offsetFrom(byType.stars?.seed ?? config.seed, 37)),
    uStarOffB: uniform(offsetFrom(byType.stars?.seed ?? config.seed, 41)),
    uTwinkleDepth: uniform(P.stars.twinkleDepth),
    uTwinklePhase: uniform(0),
    uSpikeAngle: uniform(P.stars.spikeAngle),
    uSpikeThreshold: uniform(P.stars.spikeThreshold),
    uStarGain: uniform(P.stars.gain),
    uWispFreq: uniform(P.darkDust.freq),
    uWispTh: uniform(P.darkDust.threshold),
    uWispSoft: uniform(Math.max(P.darkDust.softness, 0.001)),
    uWispTau: uniform(P.darkDust.tau),
    uWispMorph: uniform(P.darkDust.morphRate),
    uWispOff: uniform(offsetFrom(byType.darkDust?.seed ?? config.seed, 43)),

    uPalette: uniform(new THREE.Matrix3().set(...paletteRows)),
    uScnr: uniform(scnrDefault),
    uExposure: uniform(config.exposure ?? 1.1),
    uStretchK: uniform(stretchK),
    uStretchNorm: uniform(1 / Math.asinh(stretchK)),
    uBlack: uniform(0.015),
    uDither: uniform(1.5 / 255),
    uDepthLine: uniform(byType.emission?.depth ?? 0.3),
    uDepthCont: uniform(byType.ifn?.depth ?? 0.12),
    uDepthWisp: uniform(byType.darkDust?.depth ?? 0.55),
  };

  /* Per-instance uniform factories. Instance 0 assigns onto U itself, so a
     one-per-type scene builds the exact graph and editor uniform names it
     always did; later instances shadow through an Object.create(U) bag. */
  const reseats = [];

  function makeBag(k, uniforms, reseat) {
    const bag = k === 0 ? U : Object.create(U);
    Object.assign(bag, uniforms);
    if (reseat) reseats.push((aspect) => reseat(bag, aspect));
    return bag;
  }

  function globulesBag(e, k) {
    const g = { ...DEFAULTS.globules, ...e.params };
    const bag = makeBag(k, {
      uGlobFreq: uniform(g.freq),
      uGlobOff: uniform(offsetFrom(instanceSeed(e, 47, k), 47)),
      uGlobRadius: uniform(Math.min(g.radius, 0.6)),
      uGlobFill: uniform(g.fill),
      uGlobCore: uniform(g.core),
      /* radius × elong above 1 pushes the tail outside the 3×3 cell search and
         truncates it; per-clump jitter reaches 1.45× radius, hence the factor */
      uGlobElong: uniform(Math.min(g.elong, 1 / Math.max(g.radius * 1.45, 1e-3))),
      uGlobTaper: uniform(g.taper),
      uGlobDetail: uniform(g.detail),
      uGlobMorph: uniform(g.morphRate),
      uGlobEroFreq: uniform(g.eroFreq),
      uGlobEroFall: uniform(Math.max(g.eroFall, 1e-3)),
      uGlobErode: uniform(g.erode),
      uGlobTh: uniform(g.threshold),
      uGlobSoft: uniform(Math.max(g.softness, 0.001)),
      uGlobTau: uniform(g.tau),
      uGlobIonSrc: uniform(new THREE.Vector2(0, 0)),
      uGlobIonR2: uniform(Math.max(g.ionRadius ** 2, 1e-4)),
      uGlobHotLo: uniform(g.hotLo),
      uGlobHotHi: uniform(Math.max(g.hotHi, g.hotLo + 0.001)),
      uRimEps: uniform(Math.max(g.rimEps, 1e-4)),
      uRimFacing: uniform(Math.max(g.rimFacing, 0.001)),
      uRimAt: uniform(g.rimAt),
      uRimW: uniform(Math.max(g.rimW, 0.001)),
      uRimHalo: uniform(g.rimHalo),
      uRimKnotFreq: uniform(g.rimKnotFreq),
      uRimKnot: uniform(g.rimKnot),
      uRimGain: uniform(g.rimGain),
      uRimOiii: uniform(g.rimOiii),
      uRimSii: uniform(g.rimSii),
      uDepthGlob: uniform(e.depth ?? 0.6),
    }, (b, aspect) => b.uGlobIonSrc.value.set(g.ionSrc[0] * aspect, g.ionSrc[1]));
    /* Build-time flag rides the bag so every layers.* entry is one shape */
    bag.cometary = g.cometary !== false;
    return bag;
  }

  function reflectionBag(e, k) {
    const r = { ...DEFAULTS.reflection, ...e.params };
    return makeBag(k, {
      uReflStar: uniform(new THREE.Vector2(0, 0)),
      uReflLum: uniform(r.lum),
      uReflRadius: uniform(new THREE.Vector3(...r.radius)),
      uReflFalloff: uniform(new THREE.Vector3(...r.falloff)),
      uReflTint: uniform(new THREE.Vector3(...r.tint)),
      uReflWarm: uniform(new THREE.Vector3(...r.warm)),
      uReflWarmR: uniform(Math.max(r.warmR, 0.001)),
      uReflWarmAmt: uniform(r.warmAmt),
      uReflFreq: uniform(r.freq),
      uReflMorph: uniform(r.morph),
      uReflDustLo: uniform(r.dustLo),
      uReflDustHi: uniform(Math.max(r.dustHi, r.dustLo + 0.001)),
      uReflCarve: uniform(r.carve),
      uReflFloor: uniform(r.floor),
      uReflFilFreq: uniform(r.filFreq),
      uReflFilAniso: uniform(r.filAniso),
      uReflFilIn: uniform(Math.max(r.filIn, 0.001)),
      uReflFilOut: uniform(Math.max(r.filOut, Math.max(r.filIn, 0.001) + 0.001)),
      uReflFilSharp: uniform(Math.max(r.filSharp, 0)),
      uReflFilAmp: uniform(r.filAmp),
      uReflFilHa: uniform(r.filHa),
      uReflTau: uniform(r.tau),
      uReflTauSpread: uniform(Math.max(r.tauSpread, 1e-3)),
      uReflOff: uniform(offsetFrom(instanceSeed(e, 53, k), 53)),
      uDepthRefl: uniform(e.depth ?? 0.35),
    }, (b, aspect) => b.uReflStar.value.set(r.star[0] * aspect, r.star[1]));
  }

  function filamentsBag(e, k) {
    const f = { ...DEFAULTS.filaments, ...e.params };
    return makeBag(k, {
      uArcCenter: uniform(new THREE.Vector2(0, 0)),
      uArcRot: uniform(f.rot),
      uArcSquash: uniform(Math.max(f.squash, 0.05)),
      uArcRadius: uniform(Math.max(f.radius, 1e-3)),
      uArcExpand: uniform(f.expand),
      uArcThick: uniform(Math.max(f.thick, 1e-4)),
      uArcPhase: uniform(f.phase),
      uArcHalf: uniform(Math.min(Math.max(f.half, 0), Math.PI)),
      uArcSoft: uniform(Math.max(f.soft, 0.001)),
      uFilFreq: uniform(f.freq),
      uFilAniso: uniform(f.aniso),
      uFilWarp: uniform(f.warp),
      uFilKink: uniform(f.kink),
      uFilSep: uniform(f.sep),
      uFilSharp: uniform(Math.max(f.sharp, 0)),
      uFilBraid: uniform(Math.min(Math.max(f.braid, 0), 1)),
      uFilTh: uniform(f.threshold),
      uFilSoft: uniform(Math.max(f.softness, 0.001)),
      uFilPatch: uniform(Math.min(Math.max(f.patch, 0), 1)),
      uFilHaze: uniform(Math.max(f.haze, 0)),
      uFilHazeW: uniform(Math.max(f.hazeW, 1)),
      uFilLace: uniform(f.lace),
      uFilGain: uniform(f.gain),
      uFilHa: uniform(f.ha),
      uFilOiii: uniform(f.oiii),
      uFilSii: uniform(f.sii),
      uFilMorph: uniform(f.morphRate),
      uFilOff: uniform(offsetFrom(instanceSeed(e, 59, k), 59)),
      uDepthFil: uniform(e.depth ?? 0.25),
    }, (b, aspect) => b.uArcCenter.value.set(f.center[0] * aspect, f.center[1]));
  }

  /* Build gates ride the bag under a per-type key (echoOpts, fanOpts, ...):
     instance 0's bag IS the shared U, so one common name would collide across types. */

  /* The globule rim skips ALL summed tau, correct only while globules (0.6)
     stay the nearest tau layer; a nearer tau entity silently breaks that. */
  function warnTauDepth(type, depth) {
    if (depth >= 0.6) {
      console.warn(`Cosmorph: "${type}" tau at depth ${depth} sits in front of globules; the rim exemption breaks.`);
    }
  }

  function echoBag(e, k) {
    const c = { ...DEFAULTS.echo, ...e.params };
    const bag = makeBag(k, {
      uEchoSrc: uniform(new THREE.Vector2(0, 0)),
      uEchoRate: uniform(c.rate),
      uEchoSpan: uniform(c.span),
      /* z runs as rho²/2ct, so below ~0.02 the sliced noise aliases; the
         module's 1e-3 floor only keeps it finite, not sampleable. */
      uEchoStart: uniform(Math.max(c.start, 0.02)),
      uEchoPhase: uniform(c.phase),
      uEchoFadeIn: uniform(c.fadeIn),
      uEchoFadeOut: uniform(c.fadeOut),
      uEchoShellR: uniform(Math.max(c.shellR, 0)),
      uEchoShellW: uniform(c.shellW),
      /* Relative to the source, so aspect-scaling it would shear the ring
         asymmetry as the canvas widens */
      uEchoDustXY: uniform(new THREE.Vector2(...c.dustXY)),
      uEchoDustZ: uniform(c.dustZ),
      /* This cutoff is what bounds the sampled z domain; a large one un-bounds it */
      uEchoOuter: uniform(Math.min(c.outer, 1.5)),
      uEchoHalo: uniform(clamp01(c.halo)),
      uEchoFreq: uniform(c.freq),
      uEchoZSquash: uniform(c.zSquash),
      uEchoCarve: uniform(c.carve),
      uEchoTh: uniform(c.th),
      uEchoSoft: uniform(c.soft),
      uEchoRefR: uniform(c.refR),
      uEchoFall: uniform(c.fall),
      uEchoAttenMax: uniform(c.attenMax),
      uEchoSlab: uniform(clamp01(c.slab)),
      uEchoSlabMax: uniform(c.slabMax),
      uEchoLum: uniform(Math.max(c.lum, 0)),
      uEchoCool: uniform(new THREE.Vector3(...c.cool)),
      uEchoWarm: uniform(new THREE.Vector3(...c.warm)),
      uEchoRose: uniform(new THREE.Vector3(...c.rose)),
      uEchoRoseAmt: uniform(clamp01(c.roseAmt)),
      uEchoHueLo: uniform(c.hueLo),
      uEchoHueHi: uniform(c.hueHi),
      uEchoHa: uniform(Math.max(c.ha, 0)),
      uEchoTau: uniform(c.tau),
      uEchoTauTh: uniform(c.tauTh),
      uEchoTauZ: uniform(c.tauZ),
      uEchoOff: uniform(offsetFrom(instanceSeed(e, 83, k), 83)),
      uDepthEcho: uniform(e.depth ?? 0.4),
    }, (b, aspect) => b.uEchoSrc.value.set(c.src[0] * aspect, c.src[1]));
    bag.echoOpts = { ha: c.haOn === true };
    warnTauDepth('echo', e.depth ?? 0.4);
    return bag;
  }

  function shadowFanBag(e, k) {
    const f = { ...DEFAULTS.shadowFan, ...e.params };
    const bag = makeBag(k, {
      uFanApex: uniform(new THREE.Vector2(0, 0)),
      uFanAngle: uniform(f.angle),
      uFanHalf: uniform(Math.max(f.half, 0.02)),
      uFanEdge: uniform(f.edge),
      uFanLen: uniform(f.len),
      uFanFade: uniform(f.fade),
      uFanLitR: uniform(f.litR),
      uFanFalloff: uniform(f.falloff),
      uFanLum: uniform(Math.max(f.lum, 0)),
      uFanTint: uniform(new THREE.Vector3(...f.tint)),
      uFanWarm: uniform(new THREE.Vector3(...f.warm)),
      uFanWarmR: uniform(f.warmR),
      uFanWarmAmt: uniform(f.warmAmt),
      uFanLimb: uniform(f.limb),
      uFanFreq: uniform(f.freq),
      uFanAniso: uniform(f.aniso),
      uFanTh: uniform(f.threshold),
      uFanSoft: uniform(f.softness),
      uFanFloor: uniform(f.floor),
      uFanMottle: uniform(Math.max(f.mottle, 0)),
      uFanMotFreq: uniform(f.motFreq),
      uFanMorph: uniform(f.morphRate),
      uFanShadow: uniform(f.shadow),
      /* One blocker past ~0.6 rad swallows the whole cone */
      uFanShadowW: uniform(Math.min(f.shadowW, 0.6)),
      uFanShadowIn: uniform(f.shadowIn),
      uFanPen: uniform(f.pen),
      uFanPenGrow: uniform(f.penGrow),
      uFanSpread: uniform(f.spread),
      uFanRot: uniform(f.rotRate),
      uFanTau: uniform(f.tau),
      uFanOff: uniform(offsetFrom(instanceSeed(e, 89, k), 89)),
      uDepthFan: uniform(e.depth ?? 0.42),
    }, (b, aspect) => b.uFanApex.value.set(f.apex[0] * aspect, f.apex[1]));
    bag.fanOpts = { shadowCount: f.shadowCount, mottle: f.mottleOn !== false };
    warnTauDepth('shadowFan', e.depth ?? 0.42);
    return bag;
  }

  function searchlightBag(e, k) {
    const s = { ...DEFAULTS.searchlight, ...e.params };
    const bag = makeBag(k, {
      uBeamCenter: uniform(new THREE.Vector2(0, 0)),
      uBeamAxis: uniform(s.axis),
      /* The seamless fold multiplies the rate by 4096, so an unbounded one
         pushes the cos argument out of highp comfort */
      uBeamSpin: uniform(Math.min(Math.max(s.spin, 0), 0.05)),
      uBeamHalf: uniform(Math.min(Math.max(s.half, 0.02), 1.45)),
      /* This uniform IS the sharpness; a large one erases the searchlight read */
      uBeamSoft: uniform(Math.min(Math.max(s.soft, 0.001), 0.15)),
      uBeamThroat: uniform(s.throat),
      uBeamLen: uniform(s.len),
      uBeamTaper: uniform(Math.max(s.taper, 0)),
      uBeamCore: uniform(s.core),
      uBeamFall: uniform(s.fall),
      uBeamAsym: uniform(s.asym),
      uBeamWall: uniform(s.wall),
      uBeamWallK: uniform(s.wallK),
      uBeamRayFreq: uniform(s.rayFreq),
      uBeamRayAniso: uniform(s.rayAniso),
      uBeamTh: uniform(s.threshold),
      uBeamRaySoft: uniform(s.raySoft),
      uBeamStruct: uniform(Math.max(s.struct, 0)),
      uBeamGlow: uniform(Math.max(s.glow, 0)),
      uBeamLum: uniform(Math.max(s.lum, 0)),
      uBeamTint: uniform(new THREE.Vector3(...s.tint)),
      uBeamWarm: uniform(new THREE.Vector3(...s.warm)),
      uBeamWarmR: uniform(s.warmR),
      uBeamWarmAmt: uniform(s.warmAmt),
      uBeamArcFreq: uniform(s.arcFreq),
      uBeamArcSharp: uniform(s.arcSharp),
      uBeamArcAmp: uniform(Math.max(s.arcAmp, 0)),
      uBeamArcR: uniform(s.arcR),
      uBeamArcIn: uniform(s.arcIn),
      uBeamArcDrift: uniform(Math.min(Math.max(s.arcDrift, 0), 0.05)),
      uBeamArcAzimFreq: uniform(s.arcAzimFreq),
      uBeamRungFreq: uniform(s.rungFreq),
      uBeamRungSharp: uniform(s.rungSharp),
      uBeamRungAmt: uniform(s.rungAmt),
      uBeamTorusR: uniform(s.torusR),
      uBeamTorusT: uniform(s.torusT),
      uBeamTorusFlare: uniform(s.torusFlare),
      uBeamAnsae: uniform(s.ansae),
      uBeamTorusFreq: uniform(s.torusFreq),
      uBeamTorusTh: uniform(s.torusTh),
      uBeamTorusSoft: uniform(s.torusSoft),
      uBeamTorusFloor: uniform(s.torusFloor),
      uBeamTau: uniform(s.tau),
      uBeamMorph: uniform(s.morphRate),
      uBeamOff: uniform(offsetFrom(instanceSeed(e, 97, k), 97)),
      uDepthBeam: uniform(e.depth ?? 0.4),
    }, (b, aspect) => b.uBeamCenter.value.set(s.center[0] * aspect, s.center[1]));
    bag.beamOpts = { arcs: s.arcs !== false, rungs: s.rungs === true };
    warnTauDepth('searchlight', e.depth ?? 0.4);
    return bag;
  }

  function planetaryBag(e, k) {
    const p = { ...DEFAULTS.planetary, ...e.params };
    const bag = makeBag(k, {
      uPnCenter: uniform(new THREE.Vector2(0, 0)),
      uPnRot: uniform(p.rot),
      uPnAspect: uniform(p.aspect),
      uPnWaist: uniform(Math.min(Math.max(p.waist, 0), 0.95)),
      uPnPinch: uniform(p.pinch),
      uPnRadius: uniform(p.radius),
      uPnExpand: uniform(p.expand),
      uPnThick: uniform(p.thick),
      /* A negative separation silently swaps the OIII/Hα stratification */
      uPnSep: uniform(Math.max(p.sep, 0)),
      uPnTorus: uniform(p.torus),
      uPnWobble: uniform(p.wobble),
      uPnMotFreq: uniform(p.motFreq),
      uPnMottle: uniform(p.mottle),
      uPnRing: uniform(p.ring),
      uPnRingFreq: uniform(p.ringFreq),
      uPnRingPhase: uniform(p.ringPhase),
      uPnRingFade: uniform(p.ringFade),
      uPnStriaFreq: uniform(p.striaFreq),
      uPnStriaAniso: uniform(p.striaAniso),
      uPnStriaSharp: uniform(p.striaSharp),
      uPnStriaEro: uniform(clamp01(p.striaEro)),
      /* remapCombine caps coverage at 1; a zero floor blanks the shell instead */
      uPnCov: uniform(Math.max(p.cov, 0.05)),
      uPnBreakup: uniform(p.breakup),
      uPnHaloR: uniform(p.haloR),
      uPnHalo: uniform(Math.max(p.halo, 0)),
      uPnHaloOiii: uniform(Math.max(p.haloOiii, 0)),
      uPnFlier: uniform(Math.max(p.flier, 0)),
      uPnFlierR: uniform(p.flierR),
      uPnFlierSize: uniform(p.flierSize),
      uPnFlierHa: uniform(Math.max(p.flierHa, 0)),
      uPnStarTint: uniform(new THREE.Vector3(...p.starTint)),
      uPnStarLum: uniform(Math.max(p.starLum, 0)),
      uPnStarSize: uniform(p.starSize),
      uPnStarHalo: uniform(Math.max(p.starHalo, 0)),
      /* Negative gains would subtract light from the shared additive RTs */
      uPnGain: uniform(Math.max(p.gain, 0)),
      uPnHa: uniform(Math.max(p.ha, 0)),
      uPnOiii: uniform(Math.max(p.oiii, 0)),
      uPnSii: uniform(Math.max(p.sii, 0)),
      uPnMorph: uniform(p.morphRate),
      uPnOff: uniform(offsetFrom(instanceSeed(e, 101, k), 101)),
      uDepthPn: uniform(e.depth ?? 0.45),
    }, (b, aspect) => b.uPnCenter.value.set(p.center[0] * aspect, p.center[1]));
    bag.pnOpts = { fliers: p.fliers !== false };
    return bag;
  }

  function jetsBag(e, k) {
    const j = { ...DEFAULTS.jets, ...e.params };
    const bag = makeBag(k, {
      uJetSrc: uniform(new THREE.Vector2(0, 0)),
      uJetAngle: uniform(j.angle),
      uJetLen: uniform(j.len),
      uJetAsym: uniform(j.asym),
      uJetWidth: uniform(j.width),
      uJetFlare: uniform(j.flare),
      uJetTaper: uniform(j.taper),
      uJetGap: uniform(j.gap),
      uJetPrecess: uniform(j.precess),
      uJetPrecFreq: uniform(j.precFreq),
      uJetPrecRate: uniform(j.precRate),
      uJetKnotFreq: uniform(j.knotFreq),
      uJetKnotSharp: uniform(j.knotSharp),
      uJetKnotJit: uniform(j.knotJit),
      uJetKnotFloor: uniform(j.knotFloor),
      uJetKnotFade: uniform(j.knotFade),
      uJetDrift: uniform(j.drift),
      uJetTexFreq: uniform(j.texFreq),
      uJetTexAniso: uniform(j.texAniso),
      uJetTh: uniform(j.threshold),
      uJetSoft: uniform(j.softness),
      uJetBeamGain: uniform(Math.max(j.beamGain, 0)),
      uJetBeamSii: uniform(Math.max(j.beamSii, 0)),
      uJetShockFreq: uniform(j.shockFreq),
      uJetBowStand: uniform(j.bowStand),
      uJetBowCurv: uniform(j.bowCurv),
      uJetBowThick: uniform(j.bowThick),
      uJetBowSep: uniform(j.bowSep),
      uJetBowSpan: uniform(j.bowSpan),
      uJetBowFace: uniform(j.bowFace),
      uJetBowTh: uniform(j.bowTh),
      uJetBowGain: uniform(Math.max(j.bowGain, 0)),
      uJetLeadOiii: uniform(Math.max(j.leadOiii, 0)),
      uJetTrailHa: uniform(Math.max(j.trailHa, 0)),
      uJetWakeGain: uniform(Math.max(j.wakeGain, 0)),
      uJetWakeLen: uniform(j.wakeLen),
      uJetWakeW: uniform(j.wakeW),
      uJetWakeFlare: uniform(j.wakeFlare),
      uJetHa: uniform(Math.max(j.ha, 0)),
      uJetOiii: uniform(Math.max(j.oiii, 0)),
      uJetSii: uniform(Math.max(j.sii, 0)),
      uJetMorph: uniform(j.morphRate),
      uJetOff: uniform(offsetFrom(instanceSeed(e, 103, k), 103)),
      uDepthJet: uniform(e.depth ?? 0.42),
    }, (b, aspect) => b.uJetSrc.value.set(j.src[0] * aspect, j.src[1]));
    bag.jetOpts = { ...j.look };
    return bag;
  }

  function wrbubbleBag(e, k) {
    const w = { ...DEFAULTS.wrbubble, ...e.params };
    const bag = makeBag(k, {
      uWrbCenter: uniform(new THREE.Vector2(0, 0)),
      uWrbRadius: uniform(w.radius),
      uWrbExpand: uniform(Math.max(w.expand, 0)),
      uWrbAxis: uniform(w.axis),
      uWrbBow: uniform(Math.min(Math.max(w.bow, 0), 1.5)),
      uWrbWing: uniform(Math.min(Math.max(w.wing, 0), 0.8)),
      uWrbRatio: uniform(w.ratio),
      uWrbThick: uniform(w.thick),
      uWrbThickO: uniform(w.thickO),
      uWrbComp: uniform(w.comp),
      uWrbCompSoft: uniform(w.compSoft),
      uWrbGapPhase: uniform(w.gapPhase),
      uWrbCompO: uniform(clamp01(w.compO)),
      /* Past ~60 the fibres alias against the foreshortened limb */
      uWrbFibFreq: uniform(Math.min(Math.max(w.fibFreq, 0), 60)),
      uWrbFibAniso: uniform(w.fibAniso),
      uWrbFibSharp: uniform(w.fibSharp),
      uWrbWarp: uniform(w.warp),
      uWrbWarp2: uniform(w.warp2),
      uWrbTh: uniform(w.threshold),
      uWrbSoft: uniform(w.softness),
      uWrbPatch: uniform(clamp01(w.patch)),
      uWrbBleed: uniform(Math.max(w.bleed, 0)),
      uWrbGain: uniform(Math.max(w.gain, 0)),
      uWrbHa: uniform(Math.max(w.ha, 0)),
      uWrbOiii: uniform(Math.max(w.oiii, 0)),
      uWrbSii: uniform(Math.max(w.sii, 0)),
      uWrbMorph: uniform(w.morphRate),
      uWrbHornPhi: uniform(w.hornPhi),
      uWrbHornTilt: uniform(w.hornTilt),
      uWrbHornLen: uniform(Math.max(w.hornLen, 0)),
      uWrbHornW: uniform(Math.max(w.hornW, 1e-3)),
      uWrbHornFeather: uniform(w.hornFeather),
      uWrbHornAmt: uniform(w.hornAmt),
      /* An offset in units of R, so the aspect scale must not reach it */
      uWrbStarAt: uniform(new THREE.Vector2(...w.starAt)),
      uWrbStarLum: uniform(Math.max(w.starLum, 0)),
      uWrbStarCore: uniform(Math.max(w.starCore, 1e-4)),
      uWrbStarBeta: uniform(w.starBeta),
      uWrbStarHalo: uniform(Math.max(w.starHalo, 0)),
      uWrbStarHaloR: uniform(Math.max(w.starHaloR, 1e-3)),
      uWrbStarTint: uniform(new THREE.Vector3(...w.starTint)),
      uWrbOff: uniform(offsetFrom(instanceSeed(e, 107, k), 107)),
      uDepthWrb: uniform(e.depth ?? 0.42),
    }, (b, aspect) => b.uWrbCenter.value.set(w.center[0] * aspect, w.center[1]));
    bag.wrbOpts = { horns: w.horns === true };
    return bag;
  }

  const globInst = featureEnts.globules.map((e, k) => globulesBag(e, k));
  const reflInst = featureEnts.reflection.map((e, k) => reflectionBag(e, k));
  const filInst = featureEnts.filaments.map((e, k) => filamentsBag(e, k));
  const echoInst = featureEnts.echo.map((e, k) => echoBag(e, k));
  const fanInst = featureEnts.shadowFan.map((e, k) => shadowFanBag(e, k));
  const beamInst = featureEnts.searchlight.map((e, k) => searchlightBag(e, k));
  const pnInst = featureEnts.planetary.map((e, k) => planetaryBag(e, k));
  const jetInst = featureEnts.jets.map((e, k) => jetsBag(e, k));
  const wrbInst = featureEnts.wrbubble.map((e, k) => wrbubbleBag(e, k));

  /* Layer passes render an overscanned domain so compose can offset without
     sampling past an RT edge */
  const uvE = uv().sub(0.5).mul(U.uMarginScale).add(0.5);
  const skyU = uvE.mul(vec2(U.uAspect, 1.0)).add(U.uCamera);

  /* An entity riding a shared RT still parallaxes at its own depth: pre-shift
     its domain by the difference, which the overscan margin already covers. */
  function skyAtDepth(depthU, rtDepthU) {
    const par = U.uParallax.mul(vec2(1.0, -1.0)).mul(depthU.sub(rtDepthU));
    return uvE.sub(par.div(U.uResolution)).mul(vec2(U.uAspect, 1.0)).add(U.uCamera);
  }

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;

  function fullscreenPass(fragmentNode) {
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.fragmentNode = fragmentNode;
    mat.depthTest = false;
    mat.depthWrite = false;
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    return scene;
  }

  const rtOpts = {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  };
  const lineRT = new THREE.RenderTarget(2, 2, rtOpts);
  const contRT = new THREE.RenderTarget(2, 2, rtOpts);
  const brightRT = new THREE.RenderTarget(2, 2, rtOpts);

  /* The glow and its shock filaments are one object in two RTs, so each half
     pre-shifts to its own RT depth in order to land together on screen. */
  let lineNode = buildEmissionNodes(skyU, U);
  for (const bag of reflInst) {
    lineNode = lineNode.add(vec4(buildReflectionNodes(skyAtDepth(bag.uDepthRefl, U.uDepthLine), bag).line, 0.0));
  }
  for (const bag of filInst) {
    lineNode = lineNode.add(vec4(buildFilamentNodes(skyAtDepth(bag.uDepthFil, U.uDepthLine), bag).line, 0.0));
  }
  for (const bag of pnInst) {
    lineNode = lineNode.add(vec4(buildPlanetaryNodes(skyAtDepth(bag.uDepthPn, U.uDepthLine), bag, bag.pnOpts).line, 0.0));
  }
  for (const bag of jetInst) {
    lineNode = lineNode.add(vec4(buildJetNodes(skyAtDepth(bag.uDepthJet, U.uDepthLine), bag, bag.jetOpts).line, 0.0));
  }
  for (const bag of wrbInst) {
    lineNode = lineNode.add(vec4(buildWrBubbleNodes(skyAtDepth(bag.uDepthWrb, U.uDepthLine), bag, bag.wrbOpts).line, 0.0));
  }
  /* Scattered starlight has no line signature, so echo only reaches the line RT
     when the host opts into the Hα whisper; the module builds no `line` otherwise. */
  for (const bag of echoInst) {
    if (!bag.echoOpts.ha) continue;
    lineNode = lineNode.add(vec4(buildEchoNodes(skyAtDepth(bag.uDepthEcho, U.uDepthLine), bag, bag.echoOpts).line, 0.0));
  }

  let contNode = buildContinuumNodes(skyU, U.uPxPerUnit, U);
  for (const bag of reflInst) {
    contNode = contNode.add(vec4(buildReflectionNodes(skyAtDepth(bag.uDepthRefl, U.uDepthCont), bag).continuum, 0.0));
  }
  for (const bag of echoInst) {
    contNode = contNode.add(vec4(buildEchoNodes(skyAtDepth(bag.uDepthEcho, U.uDepthCont), bag, bag.echoOpts).continuum, 0.0));
  }
  for (const bag of fanInst) {
    contNode = contNode.add(vec4(buildShadowFanNodes(skyAtDepth(bag.uDepthFan, U.uDepthCont), bag, bag.fanOpts).continuum, 0.0));
  }
  for (const bag of beamInst) {
    contNode = contNode.add(vec4(buildSearchlightNodes(skyAtDepth(bag.uDepthBeam, U.uDepthCont), bag, bag.beamOpts).continuum, 0.0));
  }
  for (const bag of pnInst) {
    contNode = contNode.add(vec4(buildPlanetaryNodes(skyAtDepth(bag.uDepthPn, U.uDepthCont), bag, bag.pnOpts).continuum, 0.0));
  }
  for (const bag of wrbInst) {
    contNode = contNode.add(vec4(buildWrBubbleNodes(skyAtDepth(bag.uDepthWrb, U.uDepthCont), bag, bag.wrbOpts).continuum, 0.0));
  }

  const lineScene = fullscreenPass(lineNode);
  const contScene = fullscreenPass(contNode);
  const composeScene = fullscreenPass(buildComposeNodes({
    lineTex: lineRT.texture, contTex: contRT.texture, brightTex: brightRT.texture, U,
    layers: {
      globules: globInst,
      reflection: reflInst,
      echo: echoInst,
      shadowFan: fanInst,
      searchlight: beamInst,
    },
  }));

  /* Bright tier: instanced quads, rebuilt on resize because sizes are in
     device pixels and positions span the current aspect */
  const brightScene = new THREE.Scene();
  const brightNodes = buildBrightStarNodes(U);
  const brightMat = new THREE.MeshBasicNodeMaterial();
  brightMat.positionNode = brightNodes.positionNode;
  brightMat.fragmentNode = brightNodes.fragmentNode;
  brightMat.transparent = true;
  brightMat.blending = THREE.AdditiveBlending;
  brightMat.depthTest = false;
  brightMat.depthWrite = false;
  let brightMesh = null;
  let dpr = 1;

  const starSeed = byType.stars?.seed ?? config.seed;

  /* Tile (0,0) reuses the base seed, so a centred camera renders exactly the
     field this engine produced before panning existed. */
  function tileSeedFor(i, j) {
    if (i === 0 && j === 0) return starSeed;
    return deriveSeed(starSeed, 71 + (i + 512) * 1031 + (j + 512));
  }

  /* Centring the 3×3 block on the frame rather than the camera origin keeps
     half a tile of slack past every edge, which is more than the widest quad. */
  function brightTiles(aspect) {
    if (camX === 0 && camY === 0) return [[0, 0]];
    const ci = Math.round(camX / (aspect + BRIGHT_OVERSCAN * 2));
    const cj = Math.round(camY / (1 + BRIGHT_OVERSCAN * 2));
    const out = [];
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) out.push([i, j]);
    }
    return out;
  }

  function tileKey(x, y, aspect) {
    if (x === 0 && y === 0) return 'origin';
    const ci = Math.round(x / (aspect + BRIGHT_OVERSCAN * 2));
    const cj = Math.round(y / (1 + BRIGHT_OVERSCAN * 2));
    return `${ci},${cj}`;
  }

  function buildBrightGeometry(aspect, pixelRatio) {
    const tiles = brightTiles(aspect);
    const spanX = aspect + BRIGHT_OVERSCAN * 2;
    const spanY = 1 + BRIGHT_OVERSCAN * 2;
    const per = Math.max(0, Math.round(P.stars.count));
    const total = per * tiles.length;
    const iA = new Float32Array(total * 4);
    const iB = new Float32Array(total * 4);
    const iC = new Float32Array(total * 4);

    let n = 0;
    for (const [i, j] of tiles) {
      const data = generateBrightStars(tileSeedFor(i, j), { count: per, aspect });
      for (let k = 0; k < per; k++) {
        const s = k * 4;
        const d = (n + k) * 4;
        iA[d] = data.iA[s] + i * spanX;
        iA[d + 1] = data.iA[s + 1] + j * spanY;
        iA[d + 2] = data.iA[s + 2];
        iA[d + 3] = data.iA[s + 3];
        iB[d] = data.iB[s];
        iB[d + 1] = data.iB[s + 1];
        iB[d + 2] = data.iB[s + 2];
        iB[d + 3] = data.iB[s + 3];
        iC[d] = data.iC[s] * pixelRatio;
        iC[d + 1] = data.iC[s + 1] * pixelRatio;
        iC[d + 2] = data.iC[s + 2] * pixelRatio;
        iC[d + 3] = data.iC[s + 3];
      }
      n += per;
    }

    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4));
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4));
    geo.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 4));
    geo.instanceCount = total;
    return geo;
  }

  function rebuildBright() {
    if (brightMesh) {
      brightMesh.geometry.dispose();
      brightScene.remove(brightMesh);
    }
    brightMesh = new THREE.Mesh(buildBrightGeometry(U.uAspect.value, dpr), brightMat);
    brightMesh.frustumCulled = false;
    brightScene.add(brightMesh);
  }

  /* Only a tile crossing costs a geometry rebuild; a drag inside one tile is
     a uniform poke. Leaving or returning to dead centre counts as a crossing. */
  function setCamera(x, y) {
    const moved = tileKey(x, y, U.uAspect.value) !== tileKey(camX, camY, U.uAspect.value);
    camX = x;
    camY = y;
    U.uCamera.value.set(x, y);
    if (moved) rebuildBright();
  }

  let lastSize = { w: 2, h: 2, r: 1 };

  function resize(cssW, cssH, pixelRatio) {
    lastSize = { w: cssW, h: cssH, r: pixelRatio };
    dpr = Math.min(pixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(cssW, cssH, false);

    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    const margin = Math.ceil(maxParallaxPx * 1.5 * dpr) + 2;

    lineRT.setSize(w, h);
    contRT.setSize(w, h);
    brightRT.setSize(w, h);

    const aspect = cssW / cssH;
    U.uResolution.value.set(w, h);
    U.uAspect.value = aspect;
    U.uMarginScale.value.set(1 + (2 * margin) / w, 1 + (2 * margin) / h);
    U.uPxPerUnit.value = h / U.uMarginScale.value.y;
    U.uIonSrc.value.set(P.emission.ionSrc[0] * aspect, P.emission.ionSrc[1]);
    /* Sky x spans [0, aspect], so framed positions scale or they slide toward
       the left edge as the canvas widens */
    for (const reseat of reseats) reseat(aspect);

    rebuildBright();
  }

  function renderTo(target, tevHours, parallaxCssX, parallaxCssY) {
    U.uTev.value = tevHours;
    /* Wrapped CPU-side so the shader's sin argument stays small forever */
    U.uTwinklePhase.value = (tevHours * P.stars.twinkleRate) % 1;
    U.uParallax.value.set(parallaxCssX * dpr, parallaxCssY * dpr);

    renderer.setRenderTarget(lineRT);
    renderer.render(lineScene, camera);
    renderer.setRenderTarget(contRT);
    renderer.render(contScene, camera);
    renderer.setRenderTarget(brightRT);
    renderer.render(brightScene, camera);
    renderer.setRenderTarget(target);
    renderer.render(composeScene, camera);
    if (target) renderer.setRenderTarget(null);
  }

  function render(tevHours, parallaxCssX, parallaxCssY) {
    renderTo(null, tevHours, parallaxCssX, parallaxCssY);
  }

  /* Export path: one frame at an exact pixel count with parallax neutralised,
     read back off-screen so the live canvas never shows the export framing.
     `onResize` re-seats whatever the host poked, which resize() resets. */
  async function capture({ width, height, tev = 0, onResize = null }) {
    const prev = lastSize;
    const rt = new THREE.RenderTarget(width, height, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    try {
      resize(width, height, 1);
      onResize?.();
      renderTo(rt, tev, 0, 0);
      const pixels = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height);
      return repackRows(pixels, width, height);
    } finally {
      rt.dispose();
      resize(prev.w, prev.h, prev.r);
      onResize?.();
    }
  }

  function dispose() {
    lineRT.dispose();
    contRT.dispose();
    brightRT.dispose();
    renderer.dispose();
  }

  const backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
  /* `uniforms` is the editor hook: Firmament pokes values live instead of
     rebuilding the graph for every slider drag. resize() re-seats the framed
     positions from the build-time params, so a live editor re-applies after it. */
  /* `instances` exposes every duplicate's own bag; `uniforms` stays the
     instance-0 view Firmament already binds to. */
  return {
    render, resize, dispose, backend, capture, setCamera, uniforms: U,
    instances: {
      globules: globInst.slice(),
      reflection: reflInst.slice(),
      filaments: filInst.slice(),
      echo: echoInst.slice(),
      shadowFan: fanInst.slice(),
      searchlight: beamInst.slice(),
      planetary: pnInst.slice(),
      jets: jetInst.slice(),
      wrbubble: wrbInst.slice(),
    },
  };
}
