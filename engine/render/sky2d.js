/* 2D render spine: three half-float accumulation targets (line, continuum,
   bright stars) composed through the grading chain to the canvas. Walks an
   entity-array scene config; layer shaders never output RGB directly. */

import * as THREE from 'three/webgpu';
import { uniform, uv, vec2, vec4 } from 'three/tsl';
import { createRng, deriveSeed } from '../core/rng.js';
import { generateBrightStars } from '../entities/stars.js';
import { buildBrightStarNodes } from '../shaders/tsl/stars.js';
import { buildEmissionNodes } from '../shaders/tsl/nebula.js';
import { buildContinuumNodes, wispTransmittance } from '../shaders/tsl/dust.js';
import { buildReflectionNodes, REFLECTION_DEFAULTS } from '../shaders/tsl/reflection.js';
import { buildFilamentNodes, FILAMENT_DEFAULTS } from '../shaders/tsl/filaments.js';
import { buildEchoNodes, ECHO_DEFAULTS } from '../shaders/tsl/echo.js';
import { buildShadowFanNodes, SHADOWFAN_DEFAULTS } from '../shaders/tsl/shadowfan.js';
import { buildSearchlightNodes, SEARCHLIGHT_DEFAULTS } from '../shaders/tsl/searchlight.js';
import { buildPlanetaryNodes, PLANETARY_DEFAULTS } from '../shaders/tsl/planetary.js';
import { buildJetNodes, JET_DEFAULTS } from '../shaders/tsl/jets.js';
import { buildWrBubbleNodes, WRBUBBLE_DEFAULTS } from '../shaders/tsl/wrbubble.js';
import { buildClusterNodes, GLOBULAR_DEFAULTS } from '../shaders/tsl/clusters.js';
import { buildStarcloudNodes, STARCLOUD_DEFAULTS } from '../shaders/tsl/starcloud.js';
import {
  buildGalaxyNodes, GALAXY_DEFAULTS, devNormFor, GX_FAMILIES, ARM_COUNT_TABLE,
} from '../shaders/tsl/galaxies.js';
import { ARM_MAX } from '../shaders/tsl/galaxy-showpiece.js';
import { generateGalaxyStars } from '../entities/galaxy-stars.js';
import { buildGalaxyStarNodes } from '../shaders/tsl/galaxy-stars.js';
import { buildIonCloudNodes, ION_CLOUD_DEFAULTS } from '../shaders/tsl/ionization-cloud.js';
import { SHAPE_DEFAULTS } from '../shaders/tsl/shape.js';
import { loadShapeAsset } from '../entities/shape.js';
import { LENS_DEFAULTS, LENS_MAX_HALOS } from '../shaders/tsl/lensing.js';
import { DUST_MARCH_DEFAULTS } from '../shaders/tsl/dustmarch.js';
import { buildDustPass } from './dustpass.js';
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
    freq: 1.35, warp: 1.3, mottle: 1.3,
    stria: 0.22, striaFreq: 34.0, striaAniso: 30.0, striaAngle: 0.6,
    ionSrc: [0.74, 0.66], ionRadius: 0.62, hotLo: 0.66, hotHi: 0.98,
    frontAt: 0.3, frontWidth: 0.012, frontGain: 1.1, frontWobble: 5.0, frontOiii: 0.35,
    limb: 8.0, limbK: 1.6,
    oiii: 0.9, sii: 0.12, hotHaCut: 0.45, morphRate: 0.35,
    covLo: 0.3, covHi: 0.48, covIon: 0.35, contrast: 1.2, gain: 0.42,
  },
  /* swirl, feather, grain, and soft are neutral at 0 by construction: the hero
     sky is signed off on this field and must render byte-identical without them. */
  ifn: {
    freq: 5.0, amp: 0.62, aniso: 2.0, rot: 0.7, gamma: 1.9, warp: 2.4,
    swirl: 0, feather: 0, grain: 0, soft: 0,
    morphRate: 0.08,
  },
  stars: {
    density: 0.75, bandY: 0.32, bandTilt: -0.28, bandGain: 0.45, bandWidth: 0.55,
    count: 84, twinkleDepth: 0.3, twinkleRate: 1800, spikeAngle: 0.35,
    spikeJitter: 0.6, spikeThreshold: 0.82, gain: 1.0,
  },
  darkDust: {
    freq: 4.6, angle: 0.62, aniso: 6.0, warp: 0.3, detail: 0.45,
    threshold: 0.62, softness: 0.22, fringe: 0.16, skirt: 0.3,
    tau: 3.6, morphRate: 0.18, occlude: false,
  },
  /* The band rides the same galactic-plane line as the star gradient, so its
     tilt and offset are the stars entity's uBandTilt/uBandY, not its own. */
  starcloud: { ...STARCLOUD_DEFAULTS },
  globules: {
    freq: 2.0, radius: 0.3, fill: 0.62, core: 0.24, elong: 3.4, taper: 0.45,
    prof: 1.3, cluster: 0.55, clustFreq: 0.34, tailOp: 0.7,
    cometary: true, detail: 2.4, morphRate: 0.1,
    eroFreq: 5.0, eroFall: 0.6, erode: 0.3,
    threshold: 0.16, softness: 0.42, tau: 3.2,
    ionSrc: [1.05, 0.2], ionRadius: 0.9, hotLo: 0.5, hotHi: 0.85,
    rimEps: 0.006, rimFacing: 6.0, rimAt: 0.35, rimW: 0.22, rimHalo: 0.25,
    rimKnotFreq: 12.0, rimKnot: 0.6, rimGain: 1.2, rimOiii: 0.5, rimSii: 0.15,
  },
  /* Tighter than the module's own defaults: a shallow falloff over a 0.26 sky
     unit radius washes the whole frame instead of lighting one cloud. */
  reflection: {
    ...REFLECTION_DEFAULTS,
    radius: [0.14, 0.17, 0.22], falloff: [2.6, 2.3, 1.9],
  },
  filaments: { ...FILAMENT_DEFAULTS },
  echo: { ...ECHO_DEFAULTS },
  shadowFan: { ...SHADOWFAN_DEFAULTS },
  searchlight: { ...SEARCHLIGHT_DEFAULTS },
  planetary: { ...PLANETARY_DEFAULTS },
  jets: { ...JET_DEFAULTS },
  wrbubble: { ...WRBUBBLE_DEFAULTS },
  /* Globular is the shipped default; the open cluster is the same code under
     OPEN_CLUSTER_DEFAULTS, which scenes spread in themselves. */
  clusters: { ...GLOBULAR_DEFAULTS },
  galaxies: { ...GALAXY_DEFAULTS },
  ionCloud: { ...ION_CLOUD_DEFAULTS },
  shape: { ...SHAPE_DEFAULTS },
};

/* Must match the overscan default in entities/stars.js: the bright tier tiles
   at exactly the generation span, so a mismatch would show a seam under pan. */
const BRIGHT_OVERSCAN = 0.06;

/* Normalizes a readback to tight, top-down rows, which is what ImageData and
   every encoder expect. WebGPU pads each row to 256 bytes; WebGL2 hands back
   tight rows bottom-up, so an unflipped capture saves upside down. */
function normalizeRows(raw, width, height, flipY) {
  const tight = width * 4;
  const padded = raw.byteLength !== tight * height;
  if (!padded && !flipY) {
    return new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  /* The trailing row carries no padding, so the buffer is one stride short of
     stride × height and the length alone cannot tell you the stride. */
  const stride = padded ? Math.ceil(tight / 256) * 256 : tight;
  if (padded && raw.byteLength < (height - 1) * stride + tight) {
    throw new Error(`readback returned ${raw.byteLength} bytes for ${width}×${height}.`);
  }
  const src = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Uint8ClampedArray(tight * height);
  for (let y = 0; y < height; y++) {
    const row = flipY ? height - 1 - y : y;
    out.set(src.subarray(row * stride, row * stride + tight), y * tight);
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
  const isWebGPU = renderer.backend?.isWebGPUBackend === true;

  /* Base layers write fixed shader slots, so they stay one-per-type. Feature
     entities may repeat: each instance gets its own uniform bag, and its nodes
     sum into the shared RTs like any other member of its cost class. */
  const byType = {};
  const featureEnts = {
    globules: [], reflection: [], filaments: [],
    echo: [], shadowFan: [], searchlight: [], planetary: [], jets: [], wrbubble: [],
    clusters: [], galaxies: [], ionCloud: [], shape: [],
  };
  /* `march: true` routes a darkDust entity to the volumetric dust pass;
     without it the type keeps its one flat-wisp slot, untouched. */
  const dustEnts = [];
  for (const e of config.entities) {
    if (e.type === 'darkDust' && e.params?.march === true) {
      dustEnts.push(e);
      continue;
    }
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

  /* Baked shape fields have to be on the GPU before the graph is built, so the
     fetch is awaited here; an asset that fails drops only its own entities. */
  const shapeUrl = (e) => e.params?.asset ?? DEFAULTS.shape.asset;
  const shapeAssets = new Map();
  /* Instance index captured before the drop: it feeds instanceSeed, so closing
     the gap left by a failed asset would re-roll every survivor's noise. */
  let shapeIdx = featureEnts.shape.map((_, k) => k);
  if (featureEnts.shape.length > 0) {
    const urls = [...new Set(featureEnts.shape.map(shapeUrl))];
    const loaded = await Promise.all(urls.map((u) => loadShapeAsset(u).catch((err) => {
      console.warn(`Cosmorph: shape asset "${u}" failed to load; its entities were dropped.`, err);
      return null;
    })));
    urls.forEach((u, i) => { if (loaded[i]) shapeAssets.set(u, loaded[i]); });
    const keep = featureEnts.shape.map((e) => shapeAssets.has(shapeUrl(e)));
    shapeIdx = shapeIdx.filter((_, i) => keep[i]);
    featureEnts.shape = featureEnts.shape.filter((_, i) => keep[i]);
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

  /* Divided host-side: 9/30 lands on the same float32 as the old literal 0.3,
     where dividing in the shader costs an extra ulp and moves render hashes. */
  const striaFx = Math.max(P.emission.striaFreq, 1e-3);
  const striaFy = striaFx / Math.max(P.emission.striaAniso, 1);

  const paletteRows = PALETTES[config.palette] ?? PALETTES.hooNatural;
  const scnrDefault = config.palette === 'sho' ? 0.7 : (config.scnr ?? 0);
  const stretchK = config.stretchK ?? 14;

  /* Scene-level compose warp, not an entity: it displaces where the line and
     continuum RTs are read, so it can only live where those are sampled. */
  const L = { ...LENS_DEFAULTS, ...config.lensing };
  const lensOn = L.on === true || L.on === 1;
  const lensHalos = Math.min(Math.max(Math.round(L.halos) || 0, 0), LENS_MAX_HALOS);

  /* Sub-halo layout is seeded rather than dialed: a point on the unit disc and
     a strength jitter each, so a reroll relumps the cluster and its arcs. */
  const lensRng = createRng(deriveSeed(config.seed, 140));
  const lensHaloAt = Array.from({ length: LENS_MAX_HALOS }, () => {
    const theta = lensRng.next() * Math.PI * 2;
    const rad = Math.sqrt(lensRng.next());
    return new THREE.Vector3(Math.cos(theta) * rad, Math.sin(theta) * rad, 0.5 + lensRng.next());
  });

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
    uStriaFreq: uniform(striaFx),
    uStriaFreqY: uniform(striaFy),
    uStriaAngle: uniform(P.emission.striaAngle),
    uNebIonSrc: uniform(new THREE.Vector2(0, 0)),
    uNebIonR2: uniform(Math.max(P.emission.ionRadius ** 2, 1e-4)),
    uHotLo: uniform(P.emission.hotLo),
    uHotHi: uniform(Math.max(P.emission.hotHi, P.emission.hotLo + 0.001)),
    uFrontAt: uniform(P.emission.frontAt),
    /* This is the front's half-width and the ridge's Gaussian sigma at once;
       at zero the smoothstep collapses and the exp divides by zero. */
    uFrontW: uniform(Math.max(P.emission.frontWidth, 1e-3)),
    uFrontGain: uniform(Math.max(P.emission.frontGain, 0)),
    uFrontWob: uniform(P.emission.frontWobble),
    uFrontOiii: uniform(Math.max(P.emission.frontOiii, 0)),
    uLimb: uniform(Math.max(P.emission.limb, 0)),
    uLimbK: uniform(Math.max(P.emission.limbK, 0.01)),
    uOiii: uniform(P.emission.oiii),
    uHotHaCut: uniform(clamp01(P.emission.hotHaCut)),
    uSii: uniform(P.emission.sii),
    uMorphRate: uniform(P.emission.morphRate),
    uCovLo: uniform(P.emission.covLo),
    uCovHi: uniform(Math.max(P.emission.covHi, P.emission.covLo + 0.001)),
    uCovIon: uniform(P.emission.covIon),
    uNebContrast: uniform(P.emission.contrast),
    uNebGain: uniform(P.emission.gain),
    uNebOff: uniform(offsetFrom(byType.emission?.seed ?? config.seed, 11)),

    uIfnFreq: uniform(P.ifn.freq),
    uIfnAmp: uniform(P.ifn.amp),
    /* At 1 the domain is isotropic again, so the combing has an honest off */
    uIfnAniso: uniform(Math.max(P.ifn.aniso, 1)),
    uIfnRot: uniform(P.ifn.rot),
    uIfnGamma: uniform(Math.max(P.ifn.gamma, 0.05)),
    uIfnWarp: uniform(Math.max(P.ifn.warp, 0)),
    uIfnSwirl: uniform(Math.max(P.ifn.swirl, 0)),
    uIfnFeather: uniform(Math.max(P.ifn.feather, 0)),
    uIfnGrain: uniform(Math.max(P.ifn.grain, 0)),
    uIfnSoft: uniform(clamp01(P.ifn.soft)),
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
    uSpikeJitter: uniform(P.stars.spikeJitter),
    uSpikeThreshold: uniform(P.stars.spikeThreshold),
    uStarGain: uniform(P.stars.gain),
    uWispFreq: uniform(P.darkDust.freq),
    uWispAngle: uniform(P.darkDust.angle),
    /* Below 1 the lane axis flips from x to y mid-slider; the stretch is
       one-directional by construction. */
    uWispAniso: uniform(Math.max(P.darkDust.aniso, 1)),
    uWispWarp: uniform(P.darkDust.warp),
    uWispDetail: uniform(P.darkDust.detail),
    uWispTh: uniform(P.darkDust.threshold),
    uWispSoft: uniform(Math.max(P.darkDust.softness, 0.001)),
    uWispFringe: uniform(Math.max(P.darkDust.fringe, 0)),
    uWispSkirt: uniform(clamp01(P.darkDust.skirt)),
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

    /* TSL emits a uniform only once the graph reaches it, so create them all */
    uLensAt: uniform(new THREE.Vector2(0, 0)),
    uLensThetaE: uniform(Math.max(L.thetaE, 0)),
    /* The softened profile's only division guard: at zero it is a point mass
       with a real singularity at r = 0. */
    uLensCore: uniform(Math.max(L.core, 1e-3)),
    /* Past ±1 an axis weight goes negative and the elliptical radius turns
       imaginary inside the sqrt */
    uLensEllip: uniform(Math.min(Math.max(L.ellip, -0.8), 0.8)),
    uLensRot: uniform(L.angle),
    uLensPoint: uniform(clamp01(L.point)),
    uLensShear: uniform(new THREE.Vector2(L.shear1, L.shear2)),
    uLensHaloStr: uniform(Math.max(L.haloStrength, 0)),
    uLensHaloSpread: uniform(Math.max(L.haloSpread, 0)),
    uLensMag: uniform(clamp01(L.magBoost)),
    uLensSmear: uniform(clamp01(L.smear)),
    uLensRingGain: uniform(Math.max(L.ringGain, 0)),
    /* Zero width collapses the ring band's smoothstep onto equal edges */
    uLensRingW: uniform(Math.max(L.ringWidth, 1e-4)),
    uLensChroma: uniform(clamp01(L.chroma)),
    uLensH0: uniform(lensHaloAt[0]),
    uLensH1: uniform(lensHaloAt[1]),
    uLensH2: uniform(lensHaloAt[2]),
  };

  /* Per-instance uniform factories. Instance 0 assigns onto U itself, so a
     one-per-type scene builds the exact graph and editor uniform names it
     always did; later instances shadow through an Object.create(U) bag. */
  const reseats = [];
  reseats.push((aspect) => {
    U.uLensAt.value.set((L.center?.[0] ?? 0.5) * aspect, L.center?.[1] ?? 0.5);
  });

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
      uGlobProf: uniform(Math.max(g.prof, 0.05)),
      uGlobCluster: uniform(clamp01(g.cluster)),
      uGlobClustFreq: uniform(Math.max(g.clustFreq, 1e-3)),
      uGlobTailOp: uniform(clamp01(g.tailOp)),
      /* radius × elong past ~1.5 cells pushes the tail outside the 3×3 search and
         truncates it; jitter reaches 1.45× radius and clustering another 1+cluster */
      uGlobElong: uniform(Math.min(
        g.elong, 1.5 / Math.max(g.radius * 1.45 * (1 + clamp01(g.cluster)), 1e-3),
      )),
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
      uReflAmbient: uniform(Math.max(r.ambient, 0)),
      uReflFreq: uniform(r.freq),
      uReflMorph: uniform(r.morph),
      uReflDustLo: uniform(r.dustLo),
      uReflDustHi: uniform(Math.max(r.dustHi, r.dustLo + 0.001)),
      uReflCarve: uniform(r.carve),
      uReflFloor: uniform(r.floor),
      uReflAsym: uniform(Math.min(Math.max(r.asym, 0), 1)),
      uReflAsymFreq: uniform(r.asymFreq),
      uReflAsymAngle: uniform(r.asymAngle),
      uReflAsymBite: uniform(Math.max(r.asymBite, 0)),
      uReflLane: uniform(Math.max(r.lane, 0)),
      uReflLaneFreq: uniform(r.laneFreq),
      uReflLaneAngle: uniform(r.laneAngle),
      uReflLaneTh: uniform(Math.min(r.laneTh, 0.999)),
      uReflLaneSharp: uniform(Math.max(r.laneSharp, 0)),
      uReflStriae: uniform(Math.max(r.striae, 0)),
      uReflFilFreq: uniform(r.filFreq),
      uReflFilAniso: uniform(Math.max(r.filAniso, 1e-3)),
      uReflFilAngle: uniform(r.filAngle),
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
      uFilFray: uniform(Math.max(f.fray, 0)),
      uFilFrayF: uniform(Math.max(f.frayF, 0.01)),
      uFilPatch: uniform(Math.min(Math.max(f.patch, 0), 1)),
      uFilHaze: uniform(Math.max(f.haze, 0)),
      uFilHazeW: uniform(Math.max(f.hazeW, 1)),
      uFilLace: uniform(f.lace),
      uFilLaceF: uniform(Math.max(f.laceF, 0.01)),
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
      uEchoShell2: uniform(clamp01(c.shell2)),
      uEchoShell2Off: uniform(Math.max(c.shell2Off, 0)),
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
      uEchoFil: uniform(Math.max(c.fil, 0)),
      uEchoFilFreq: uniform(Math.max(c.filFreq, 0.1)),
      uEchoFilSharp: uniform(Math.max(c.filSharp, 0)),
      uEchoTh: uniform(c.th),
      uEchoSoft: uniform(c.soft),
      uEchoRefR: uniform(c.refR),
      uEchoFall: uniform(c.fall),
      uEchoAttenMax: uniform(c.attenMax),
      uEchoSlab: uniform(clamp01(c.slab)),
      uEchoSlabMax: uniform(c.slabMax),
      uEchoSweep: uniform(clamp01(c.sweep)),
      uEchoSweepW: uniform(Math.max(c.sweepW, 1e-3)),
      uEchoLum: uniform(Math.max(c.lum, 0)),
      uEchoStarLum: uniform(Math.max(c.starLum, 0)),
      uEchoStarR: uniform(Math.max(c.starR, 1e-4)),
      uEchoStarHalo: uniform(Math.max(c.starHalo, 0)),
      uEchoStarCol: uniform(new THREE.Vector3(...c.starCol)),
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
      uFanCurl: uniform(f.curl),
      uFanBulge: uniform(Math.max(f.bulge, 0)),
      uFanWobble: uniform(Math.max(f.wobble, 0)),
      uFanWobFreq: uniform(Math.max(f.wobFreq, 0.1)),
      uFanLum: uniform(Math.max(f.lum, 0)),
      uFanTint: uniform(new THREE.Vector3(...f.tint)),
      uFanWarm: uniform(new THREE.Vector3(...f.warm)),
      uFanWarmR: uniform(f.warmR),
      uFanWarmAmt: uniform(f.warmAmt),
      uFanLimb: uniform(f.limb),
      uFanLobe: uniform(Math.max(f.lobe, 0)),
      uFanLobeAt: uniform(Math.max(f.lobeAt, 0)),
      uFanLobeW: uniform(Math.max(f.lobeW, 1e-3)),
      uFanStarLum: uniform(Math.max(f.starLum, 0)),
      uFanStarR: uniform(Math.max(f.starR, 1e-4)),
      uFanStarHalo: uniform(Math.max(f.starHalo, 0)),
      uFanStarCol: uniform(new THREE.Vector3(...f.starCol)),
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
      uFanBandCurl: uniform(f.bandCurl),
      uFanBandWob: uniform(f.bandWob),
      uFanBandWobFreq: uniform(f.bandWobFreq),
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
    const inclC = Math.min(Math.max(s.incl, 0), Math.PI / 2);
    const bag = makeBag(k, {
      uBeamCenter: uniform(new THREE.Vector2(0, 0)),
      uBeamAxis: uniform(s.axis),
      /* Stored as the two projection factors rather than the angle: the shader
         only ever divides by them, so the trig belongs on the host. */
      uBeamSinI: uniform(Math.sin(inclC)),
      uBeamCosI: uniform(Math.cos(inclC)),
      uBeamArcTilt: uniform(clamp01(s.arcTilt)),
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
      uPnFlare: uniform(Math.max(p.flare, 0)),
      uPnTip: uniform(Math.max(p.tip, 0.05)),
      /* A multiplier on the tip radius, so it must clear 1 or the fade inverts */
      uPnTipW: uniform(Math.max(p.tipW, 1.01)),
      uPnCavity: uniform(Math.max(p.cavity, 0)),
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
      uPnRingSharp: uniform(Math.max(p.ringSharp, 0)),
      uPnRingR: uniform(Math.max(p.ringR, 1)),
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
      uJetTexAmt: uniform(clamp01(j.texAmt)),
      uJetBeamGain: uniform(Math.max(j.beamGain, 0)),
      uJetBeamOiii: uniform(Math.max(j.beamOiii, 0)),
      uJetBeamSii: uniform(Math.max(j.beamSii, 0)),
      uJetStarLum: uniform(Math.max(j.starLum, 0)),
      uJetStarR: uniform(Math.max(j.starR, 1e-4)),
      uJetStarHalo: uniform(Math.max(j.starHalo, 0)),
      uJetStarCol: uniform(new THREE.Vector3(...j.starCol)),
      uJetShockFreq: uniform(j.shockFreq),
      uJetStreak: uniform(clamp01(j.streak)),
      uJetStreakFreq: uniform(j.streakFreq),
      uJetStreakAniso: uniform(Math.max(j.streakAniso, 1e-3)),
      uJetStreakSharp: uniform(Math.max(j.streakSharp, 0)),
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
      /* Past ~1 the lobes pinch off into separate bubbles; 2 would fold the shell. */
      uWrbLump: uniform(Math.min(Math.max(w.lump, 0), 1)),
      uWrbLumpFreq: uniform(Math.max(w.lumpFreq, 0)),
      uWrbLimbK: uniform(Math.max(w.limbK, 1)),
      uWrbBow: uniform(Math.min(Math.max(w.bow, 0), 1.5)),
      uWrbWing: uniform(Math.min(Math.max(w.wing, 0), 0.8)),
      uWrbRatio: uniform(w.ratio),
      uWrbThick: uniform(w.thick),
      uWrbThickO: uniform(w.thickO),
      uWrbComp: uniform(w.comp),
      uWrbCompSoft: uniform(w.compSoft),
      uWrbGapPhase: uniform(w.gapPhase),
      uWrbCompO: uniform(clamp01(w.compO)),
      /* Past ~60 the fibers alias against the foreshortened limb */
      uWrbFibFreq: uniform(Math.min(Math.max(w.fibFreq, 0), 60)),
      uWrbFibAniso: uniform(w.fibAniso),
      uWrbFibSharp: uniform(w.fibSharp),
      uWrbWarp: uniform(w.warp),
      uWrbWarp2: uniform(w.warp2),
      uWrbTh: uniform(w.threshold),
      uWrbSoft: uniform(w.softness),
      uWrbPatch: uniform(clamp01(w.patch)),
      uWrbBleed: uniform(Math.max(w.bleed, 0)),
      uWrbShell: uniform(Math.max(w.shell, 0)),
      uWrbGrain: uniform(clamp01(w.grain)),
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

  function clustersBag(e, k) {
    const c = { ...DEFAULTS.clusters, ...e.params };
    /* Member sprites peak at 1.25 × memSize device px, clamped up to 0.7, and the
       loop searches 3×3 cells, so a cell holds ~4 sprite radii or wings truncate. */
    const memSize = Math.max(c.memSize, 0.05);
    const cells = Math.max(c.cells, 1e-3);
    const bag = makeBag(k, {
      uCluCenter: uniform(new THREE.Vector2(0, 0)),
      uCluCore: uniform(c.core),
      uCluTidal: uniform(c.tidal),
      uCluSquash: uniform(c.squash),
      uCluRot: uniform(c.rot),
      /* Negative luminosities would subtract light from the shared continuum RT */
      uCluLum: uniform(Math.max(c.lum, 0)),
      uCluTint: uniform(new THREE.Vector3(...c.tint)),
      uCluHalo: uniform(Math.max(c.halo, 0)),
      uCluHaloR: uniform(c.haloR),
      uCluCells: uniform(cells),
      uCluRich: uniform(Math.max(c.rich, 0)),
      uCluMemGain: uniform(Math.max(c.memGain, 0)),
      uCluMemFall: uniform(c.memFall),
      uCluMemSize: uniform(memSize),
      uCluResolve: uniform(Math.max(c.resolve, 0)),
      uCluMemTint: uniform(new THREE.Vector3(...c.memTint)),
      uCluMemTint2: uniform(new THREE.Vector3(...c.memTint2)),
      uCluMemMix: uniform(clamp01(c.memMix)),
      /* Outside [0,1] the clump mix extrapolates past the density rescale */
      uCluClump: uniform(clamp01(c.clump)),
      uCluClumpFreq: uniform(c.clumpFreq),
      uCluOff: uniform(offsetFrom(instanceSeed(e, 61, k), 61)),
      uDepthClu: uniform(e.depth ?? 0.2),
    }, (b, aspect) => {
      b.uCluCenter.value.set(c.center[0] * aspect, c.center[1]);
      /* pxPerUnit is only known once the canvas has a size, so the cell cap
         re-seats on every resize rather than at build time. */
      b.uCluCells.value = Math.min(cells, U.uPxPerUnit.value / Math.max(5 * memSize, 2.8));
    });
    bag.cluOpts = { clumped: c.clump > 0 };
    return bag;
  }

  /* One per scene: the band is the galactic plane. It still gates like a feature
     type, so a scene without it compiles with no uSC uniforms and no rift tau. */
  function starcloudBag(e) {
    const s = { ...DEFAULTS.starcloud, ...e.params };
    const seed = e.seed ?? config.seed;
    const bag = makeBag(0, {
      uSCWidth: uniform(s.width),
      uSCFalloff: uniform(s.falloff),
      uSCWing: uniform(s.wing),
      uSCWingScale: uniform(s.wingScale),
      uSCGain: uniform(Math.max(s.gain, 0)),
      uSCTint: uniform(new THREE.Vector3(...s.tint)),
      uSCGrainFreq: uniform(s.grainFreq),
      uSCGrain: uniform(Math.max(s.grain, 0)),
      uSCPatchFreq: uniform(s.patchFreq),
      uSCPatchTh: uniform(s.patchTh),
      uSCPatchSoft: uniform(s.patchSoft),
      uSCPatch: uniform(Math.max(s.patch, 0)),
      uSCMorph: uniform(s.morphRate),
      uSCOff: uniform(offsetFrom(seed, 71)),
      uRiftCenter: uniform(s.riftCenter),
      uRiftW: uniform(s.riftW),
      uRiftWander: uniform(s.riftWander),
      uRiftWanderFreq: uniform(s.riftWanderFreq),
      uRiftFreq: uniform(s.riftFreq),
      uRiftAniso: uniform(s.riftAniso),
      uRiftTh: uniform(s.riftTh),
      uRiftSoft: uniform(s.riftSoft),
      /* A negative tau would amplify light through the exp instead of dimming it */
      uRiftTau: uniform(Math.max(s.riftTau, 0)),
      uRiftMorph: uniform(s.riftMorph),
      uRiftOff: uniform(offsetFrom(seed, 79)),
      /* The glow and the rift MUST read this same depth: two would parallax the
         lane off the band it is cutting. */
      uDepthSC: uniform(e.depth ?? 0.1),
    });
    /* The rift gate reaches compose, not this pass: its eight octaves are the
       most expensive thing in the layer and a rift-less band must not pay them. */
    bag.scOpts = { grain: s.grain > 0, patch: s.patch > 0, rift: s.riftTau > 0 };
    warnTauDepth('starcloud', e.depth ?? 0.1);
    return bag;
  }

  /* Every uniform is created whether or not its tier is in the build: the
     studio's `set` callbacks poke slots directly and would throw on a gap. */
  function galaxiesBag(e, k) {
    const g = { ...DEFAULTS.galaxies, ...e.params };
    /* Nine flat stops, not three triples, so the studio can address them as
       ramp.0–8; a short array would NaN the whole continuum target. */
    const ramp = Array.isArray(g.ramp) && g.ramp.length === 9 ? g.ramp : GALAXY_DEFAULTS.ramp;

    /* Per-instance character, but only for keys the scene left alone. Firmament
       writes every param explicitly, so the studio never sees these rolls. */
    const set = e.params ?? {};
    const look = { ...GALAXY_DEFAULTS.look, ...g.look };
    const roll = createRng(deriveSeed(instanceSeed(e, 120, k), 122));
    const family = GX_FAMILIES[Math.floor(roll.next() * GX_FAMILIES.length) % GX_FAMILIES.length];
    /* The table is a disk-galaxy palette. A shell elliptical and a ring galaxy
       color off uGxShellTint and uGxRing, so a family would only fight them. */
    const hued = !look.shell && !look.ring;
    const bulge = set.bulge ?? (hued ? family.bulge : g.bulge);
    const disk = set.disk ?? (hued ? family.disk : g.disk);
    const flowerTint = set.flowerTint ?? (hued ? family.flowerLines : g.flowerTint);
    /* Every branch below keys off earlier roll values only, never off a scene
       param, so an explicitly set param can never shift the rolls that follow. */
    const armPick = ARM_COUNT_TABLE[
      Math.floor(roll.next() * ARM_COUNT_TABLE.length) % ARM_COUNT_TABLE.length];
    const armFrac = roll.next() < 0.35 ? roll.next() * 0.6 : 0;
    const asymPick = roll.next() * 0.3;
    /* armBlend was the old 2-to-3 dial; its whole range is armCount's [2, 3] */
    const legacy = set.armBlend !== undefined ? 2 + clamp01(set.armBlend) : null;
    const armCount = set.armCount ?? legacy ?? armPick + armFrac;
    const armAsym = set.armAsym ?? asymPick;
    const bag = makeBag(k, {
      uGxfCells: uniform(Math.max(g.fieldCells, 0.1)),
      uGxfDensity: uniform(g.fieldDensity),
      uGxfRadius: uniform(g.fieldRadius),
      uGxfFlat: uniform(g.fieldFlat),
      uGxfFeather: uniform(Math.max(g.fieldFeather, 1e-3)),
      uGxfCoreFall: uniform(g.fieldCoreFall),
      uGxfDiskFall: uniform(g.fieldDiskFall),
      uGxfCoreAmt: uniform(g.fieldCoreAmt),
      uGxfCoreR: uniform(g.fieldCoreR),
      uGxfCore: uniform(new THREE.Vector3(...g.fieldCore)),
      uGxfDisk: uniform(new THREE.Vector3(...g.fieldDisk)),
      uGxfLaneAt: uniform(g.fieldLaneAt),
      uGxfLaneW: uniform(g.fieldLaneW),
      uGxfLaneDepth: uniform(g.fieldLaneDepth),
      uGxfLum: uniform(Math.max(g.fieldLum, 0)),
      uGxfCluster: uniform(clamp01(g.cluster)),
      uGxfClusterPeak: uniform(Math.max(g.clusterPeak, 0)),
      uGxfClusterR: uniform(Math.max(g.clusterR, 1e-3)),
      uGxfAt: uniform(new THREE.Vector2(0, 0)),
      uGxfZLo: uniform(g.zLo),
      uGxfZHi: uniform(g.zHi),
      uGxfZSize: uniform(Math.max(g.zSize, 0)),
      uGxfZDim: uniform(Math.max(g.zDim, 0)),
      uGxfZTint: uniform(clamp01(g.zTint)),
      uGxfZNear: uniform(new THREE.Vector3(ramp[0], ramp[1], ramp[2])),
      uGxfZMid: uniform(new THREE.Vector3(ramp[3], ramp[4], ramp[5])),
      uGxfZFar: uniform(new THREE.Vector3(ramp[6], ramp[7], ramp[8])),
      uGxfOff: uniform(offsetFrom(instanceSeed(e, 120, k), 120)),

      uGxCenter: uniform(new THREE.Vector2(0, 0)),
      uGxSize: uniform(Math.max(g.size, 1e-4)),
      uGxCosI: uniform(Math.max(g.cosI, 0.06)),
      uGxPa: uniform(g.pa),
      uGxWind: uniform(g.wind),
      uGxPhase: uniform(g.phase),
      uGxSpin: uniform(g.spin),
      uGxArmCount: uniform(Math.min(Math.max(armCount, 1), ARM_MAX)),
      uGxArmAsym: uniform(clamp01(armAsym)),
      uGxArmAmt: uniform(clamp01(g.armAmt)),
      uGxArmSharp: uniform(Math.max(g.armSharp, 0)),
      uGxBarAmt: uniform(Math.max(g.barAmt, 0)),
      uGxBarLen: uniform(Math.max(g.barLen, 1e-3)),
      uGxBarSharp: uniform(Math.max(g.barSharp, 0)),
      uGxGranFreq: uniform(Math.max(g.granFreq, 0)),
      uGxGranBright: uniform(Math.max(g.granBright, 0)),
      uGxGranDark: uniform(clamp01(g.granDark)),
      uGxGranTh: uniform(clamp01(g.granTh)),
      uGxMotFreq: uniform(g.motFreq),
      uGxMotAmt: uniform(g.motAmt),
      uGxMorph: uniform(g.morphRate),
      uGxBulgeR: uniform(Math.max(g.bulgeR, 1e-3)),
      uGxBulgeBeta: uniform(Math.max(g.bulgeBeta, 0.5)),
      uGxBulgeAmt: uniform(Math.max(g.bulgeAmt, 0)),
      uGxDiskFall: uniform(g.diskFall),
      uGxLanePhase: uniform(g.lanePhase),
      uGxLaneSharp: uniform(Math.max(g.laneSharp, 0)),
      uGxLaneDepth: uniform(g.laneDepth),
      uGxNearSide: uniform(g.nearSide),
      uGxNearSoft: uniform(Math.max(g.nearSoft, 1e-3)),
      uGxCutIn: uniform(g.cutIn),
      uGxCutOut: uniform(Math.max(g.cutOut, g.cutIn + 1e-3)),
      uGxBulge: uniform(new THREE.Vector3(...bulge)),
      uGxDisk: uniform(new THREE.Vector3(...disk)),
      uGxTintLo: uniform(g.tintLo),
      uGxTintHi: uniform(Math.max(g.tintHi, g.tintLo + 1e-3)),
      uGxGain: uniform(Math.max(g.gain, 0)),

      uGxHii: uniform(Math.max(g.hii, 0)),
      uGxHiiFreq: uniform(g.hiiFreq),
      uGxHiiTh: uniform(g.hiiTh),
      uGxHiiOiii: uniform(Math.max(g.hiiOiii, 0)),
      uGxHiiSii: uniform(Math.max(g.hiiSii, 0)),

      uGxFlowerGain: uniform(Math.max(g.flowerGain, 0)),
      uGxFlowerTh: uniform(clamp01(g.flowerTh)),
      uGxFlowerSoft: uniform(Math.max(g.flowerSoft, 1e-3)),
      uGxFlowerLo: uniform(Math.max(g.flowerLo, 0)),
      uGxFlowerHi: uniform(Math.max(g.flowerHi, g.flowerLo + 1e-3)),
      uGxFlowerTint: uniform(new THREE.Vector3(...flowerTint)),

      uGxDevRe: uniform(Math.max(g.devRe, 1e-3)),
      uGxDevFloor: uniform(Math.max(g.devFloor, 1e-4)),
      uGxDevNorm: uniform(devNormFor(g.devFloor)),
      uGxShellAmt: uniform(Math.max(g.shellAmt, 0)),
      uGxShellFreq: uniform(g.shellFreq),
      uGxShellPhase: uniform(g.shellPhase),
      uGxShellSharp: uniform(Math.max(g.shellSharp, 0)),
      uGxShellIn: uniform(Math.max(g.shellIn, 1e-3)),
      uGxShellFall: uniform(g.shellFall),
      /* This is the half-width of the alternation edge; at 0 the smoothstep
         collapses and every shell snaps to a hard diameter. */
      uGxShellCut: uniform(Math.max(g.shellCut, 1e-3)),
      uGxShellRot: uniform(g.shellRot),
      uGxShellTint: uniform(new THREE.Vector3(...g.shellTint)),

      uGxRingR: uniform(g.ringR),
      uGxRingW: uniform(Math.max(g.ringW, 1e-4)),
      uGxRingAmt: uniform(Math.max(g.ringAmt, 0)),
      uGxRing: uniform(new THREE.Vector3(...g.ring)),
      uGxKnotFreq: uniform(g.knotFreq),
      uGxKnotAmt: uniform(clamp01(g.knotAmt)),
      uGxSpokeAmt: uniform(Math.max(g.spokeAmt, 0)),
      uGxSpokeFreq: uniform(g.spokeFreq),
      uGxSpokeAniso: uniform(g.spokeAniso),
      uGxSpokeTh: uniform(g.spokeTh),
      uGxSpokeIn: uniform(g.spokeIn),
      uGxPolarAmt: uniform(Math.max(g.polarAmt, 0)),
      uGxPolarPa: uniform(g.polarPa),
      uGxPolarCosI: uniform(Math.max(g.polarCosI, 0.06)),
      uGxPolarR: uniform(g.polarR),
      uGxPolarW: uniform(Math.max(g.polarW, 1e-4)),
      uGxOff: uniform(offsetFrom(instanceSeed(e, 120, k), 121)),
      uDepthGx: uniform(e.depth ?? 0.13),

      uGxsWind: uniform(g.starsWind),
      /* A circular orbit set has no arms to crowd into; 1 is the honest off */
      uGxsAxis: uniform(Math.min(Math.max(g.starsAxis, 0.05), 1)),
      uGxsSpin: uniform(g.starsSpin),
      /* Negative would speed the outside up and unwind the pattern backwards */
      uGxsRotExp: uniform(Math.max(g.starsRotExp, 0)),
      uGxsZH: uniform(Math.max(g.starsZH, 1e-4)),
      uGxsSize: uniform(Math.max(g.starsSize, 0.05)),
      uGxsGain: uniform(Math.max(g.starsGain, 0)),
      uGxsLaneTau: uniform(Math.max(g.starsLaneTau, 0)),
      /* Sprite sizes are device pixels, so this is what resize pokes instead of
         rebuilding every instance buffer the way the bright tier has to. */
      uGxsDpr: uniform(1),
    }, (b, aspect) => {
      b.uGxCenter.value.set(g.center[0] * aspect, g.center[1]);
      b.uGxfAt.value.set(g.clusterAt[0] * aspect, g.clusterAt[1]);
    });
    /* look.bar is derived, not stored: the bar chain is a build gate, so a scene
       at the barAmt=0 default compiles a graph with no bar math in it at all. */
    bag.gxOpts = {
      field: g.field !== false,
      showpiece: g.showpiece !== false,
      look: { ...look, bar: g.barAmt > 0 },
    };
    /* Sprite tier follows the spiral gates: nested ellipses describe a disk,
       not a shell or a detached ring. */
    const spiral = bag.gxOpts.showpiece && !look.ring && !look.shell;
    bag.gxsCount = spiral ? Math.max(0, Math.round(g.starsN) || 0) : 0;
    /* Linked sprite arms take pitch, phase, and rotation from the glow's
       pattern uniforms; a build gate, since it swaps the tilt chain. */
    bag.gxsOpts = { linked: !(g.starsLink === false || g.starsLink === 0) };
    /* Own-property null, or a k>0 bag would inherit instance 0's star field
       through the Object.create(U) prototype chain. */
    bag.gxsData = bag.gxsCount > 0
      ? generateGalaxyStars(deriveSeed(instanceSeed(e, 120, k), 123), {
        count: bag.gxsCount, bulgeFrac: clamp01(g.starsBulgeFrac),
      })
      : null;
    return bag;
  }

  function ionCloudBag(e, k) {
    const v = { ...DEFAULTS.ionCloud, ...e.params };
    const bag = makeBag(k, {
      uIonCenter: uniform(new THREE.Vector2(0, 0)),
      uIonRot: uniform(v.rot),
      uIonSize: uniform(Math.max(v.size, 1e-3)),
      uIonSquash: uniform(Math.max(v.squash, 0.05)),
      uIonRagged: uniform(Math.max(v.ragged, 0)),
      uIonRagFreq: uniform(v.ragFreq),
      uIonFeather: uniform(Math.max(v.feather, 1e-3)),
      /* In units of the cloud radius, so the aspect scale must not reach it */
      uIonHoleAt: uniform(new THREE.Vector2(...v.holeAt)),
      uIonHoleR: uniform(Math.max(v.holeR, 0)),
      uIonHoleSoft: uniform(Math.max(v.holeSoft, 1e-4)),
      uIonFreq: uniform(v.freq),
      uIonSharp: uniform(Math.max(v.sharp, 0)),
      uIonTh: uniform(v.threshold),
      uIonSoft: uniform(Math.max(v.softness, 1e-3)),
      uIonClump: uniform(clamp01(v.clump)),
      uIonClumpFreq: uniform(v.clumpFreq),
      uIonShade: uniform(clamp01(v.shade)),
      uIonGlow: uniform(Math.max(v.glow, 0)),
      uIonApex: uniform(new THREE.Vector2(0, 0)),
      uIonCone: uniform(v.cone),
      /* Past ~1.5 rad the cone opens past the hemisphere and stops reading as one */
      uIonHalf: uniform(Math.min(Math.max(v.half, 0.02), 1.5)),
      uIonConeSoft: uniform(Math.min(Math.max(v.coneSoft, 0.001), 0.3)),
      uIonLitR: uniform(Math.max(v.litR, 1e-3)),
      uIonFall: uniform(Math.max(v.fall, 0)),
      /* Negative gains would subtract light from the shared additive RT */
      uIonGain: uniform(Math.max(v.gain, 0)),
      uIonHa: uniform(Math.max(v.ha, 0)),
      uIonOiii: uniform(Math.max(v.oiii, 0)),
      uIonSii: uniform(Math.max(v.sii, 0)),
      uIonMorph: uniform(v.morphRate),
      uIonOff: uniform(offsetFrom(instanceSeed(e, 131, k), 131)),
      uDepthIon: uniform(e.depth ?? 0.5),
    }, (b, aspect) => {
      b.uIonCenter.value.set(v.center[0] * aspect, v.center[1]);
      b.uIonApex.value.set(v.apex[0] * aspect, v.apex[1]);
    });
    bag.ionOpts = { blob: v.blob === true };
    return bag;
  }

  function shapeBag(e, k) {
    const asset = shapeAssets.get(shapeUrl(e));
    /* Polarity is the asset's own call, so it seeds the gains before the
       entity's params get the final word. */
    const pol = asset.polarity === 'bright' ? { tau: 0.4, rimGain: 0.5 } : {};
    /* Glow follows what the column measured, but only where the traced shape is
       the bright one: a dark-polarity emission bake lights the whole frame. */
    const lit = asset.densityMode === 'emission' && asset.polarity !== 'dark'
      ? { glow: 0.9 } : {};
    /* The baker's suggestion is 4× its honest measured scale, which alone reads
       ghost-thin, so a bake predating the suggestion needs the same factor. */
    const ds = asset.suggestedTau > 0 ? { tau: asset.suggestedTau }
      : asset.densityScale > 0 ? { tau: asset.densityScale * 4 } : {};
    const s = { ...DEFAULTS.shape, ...ds, ...lit, ...pol, ...e.params };
    const bag = makeBag(k, {
      uShpCenter: uniform(new THREE.Vector2(0, 0)),
      uShpScale: uniform(Math.max(s.scale, 1e-3)),
      uShpRot: uniform(s.rot),
      /* The shader multiplies this back out; it is the only key to the texture */
      uShpSpread: uniform(asset.spread),
      uShpEdge: uniform(Math.max(s.edgeFade, 1e-3)),
      uShpDens: uniform(Math.max(s.density, 0)),
      uShpCore: uniform(clamp01(s.core)),
      uShpVeil: uniform(clamp01(s.veil)),
      uShpFeather: uniform(Math.max(s.feather, 1e-3)),
      uShpFreq: uniform(s.freq),
      uShpMorph: uniform(s.morphRate),
      uShpEroFreq: uniform(s.eroFreq),
      uShpEroFall: uniform(Math.max(s.eroFall, 1e-3)),
      uShpErode: uniform(s.erode),
      uShpTh: uniform(s.threshold),
      uShpSoft: uniform(Math.max(s.softness, 1e-3)),
      uShpTau: uniform(Math.max(s.tau, 0)),
      uShpIonSrc: uniform(new THREE.Vector2(0, 0)),
      uShpIonR2: uniform(Math.max(s.ionRadius ** 2, 1e-4)),
      uShpHotLo: uniform(s.hotLo),
      uShpHotHi: uniform(Math.max(s.hotHi, s.hotLo + 0.001)),
      uShpRimFacing: uniform(Math.max(s.rimFacing, 1e-3)),
      /* Wants to be a texel or two of the baked field wide; a shorter step reads
         the bilinear interpolant's own facets instead of the surface. */
      uShpRimEps: uniform(Math.max(s.rimEps, 1e-3)),
      uShpRimDens: uniform(clamp01(s.rimDens)),
      uShpRimAt: uniform(s.rimAt),
      uShpRimW: uniform(Math.max(s.rimW, 1e-4)),
      uShpRimJit: uniform(Math.max(s.rimJit, 0)),
      uShpRimHalo: uniform(s.rimHalo),
      uShpRimKnotFreq: uniform(s.rimKnotFreq),
      /* Past 1 the bead floor goes negative and the rim subtracts light from
         every other entity in the compose sum */
      uShpRimKnot: uniform(clamp01(s.rimKnot)),
      uShpRimGain: uniform(Math.max(s.rimGain, 0)),
      uShpRimOiii: uniform(Math.max(s.rimOiii, 0)),
      uShpRimSii: uniform(Math.max(s.rimSii, 0)),
      uShpGlow: uniform(Math.max(s.glow, 0)),
      uShpGlowFall: uniform(Math.max(s.glowFall, 1e-4)),
      uShpOiii: uniform(Math.max(s.oiii, 0)),
      uShpSii: uniform(Math.max(s.sii, 0)),
      uShpGain: uniform(Math.max(s.gain, 0)),
      uShpOff: uniform(offsetFrom(instanceSeed(e, 109, k), 109)),
      uDepthShp: uniform(e.depth ?? 0.5),
    }, (b, aspect) => {
      b.uShpCenter.value.set(s.center[0] * aspect, s.center[1]);
      b.uShpIonSrc.value.set(s.ionSrc[0] * aspect, s.ionSrc[1]);
    });
    /* A texture is not a uniform value, so it rides the bag like the other
       build-time entries and reaches compose through layers.shape. The asset
       carries its credit string along for the credits panel to come. */
    bag.shpMap = asset.texture;
    bag.shpAsset = asset;
    /* Both are whole exp chains, and both are off in most scenes */
    bag.shpOpts = { glow: s.glow > 0, rimHalo: s.rimHalo > 0 };
    warnTauDepth('shape', e.depth ?? 0.5);
    return bag;
  }

  function dustBag(e, k) {
    const d = { ...DUST_MARCH_DEFAULTS, ...e.params };
    const bag = makeBag(k, {
      uDmCenter: uniform(new THREE.Vector2(0, 0)),
      uDmRadius: uniform(new THREE.Vector2(
        Math.max(d.radius, 1e-3),
        Math.max(d.radius * Math.max(d.squash, 0.05), 1e-3),
      )),
      uDmRot: uniform(d.rot),
      uDmFeather: uniform(Math.max(d.feather, 1e-3)),
      uDmDens: uniform(Math.max(d.density, 0)),
      uDmVeil: uniform(clamp01(d.veil)),
      uDmFreq: uniform(d.freq),
      uDmZFreq: uniform(Math.max(d.zDetail, 0)),
      uDmMorph: uniform(d.morphRate),
      uDmEroFreq: uniform(d.eroFreq),
      uDmErode: uniform(clamp01(d.erode)),
      uDmEroSharp: uniform(Math.max(d.eroSharp, 0.1)),
      uDmTh: uniform(d.threshold),
      uDmSoft: uniform(Math.max(d.softness, 1e-3)),
      uDmTau: uniform(Math.max(d.tau, 0)),
      uDmThick: uniform(Math.max(d.thickness, 1e-3)),
      uDmThickMin: uniform(clamp01(d.thickFloor)),
      uDmBias: uniform(Math.max(d.thickBias, 0)),
      uDmIonSrc: uniform(new THREE.Vector2(0, 0)),
      uDmIonR2: uniform(Math.max(d.ionRadius ** 2, 1e-4)),
      uDmHotLo: uniform(d.hotLo),
      uDmHotHi: uniform(Math.max(d.hotHi, d.hotLo + 0.001)),
      uDmReach: uniform(Math.max(d.shadowReach, 1e-3)),
      uDmShadowK: uniform(Math.max(d.shadowK, 0)),
      uDmShadowSelf: uniform(Math.max(d.shadowSelf, 0)),
      uDmFrontW: uniform(Math.max(d.frontWidth, 1e-3)),
      uDmSkinGain: uniform(Math.max(d.skinGain, 0)),
      uDmRimGain: uniform(Math.max(d.rimGain, 0)),
      uDmRimOiii: uniform(Math.max(d.rimOiii, 0)),
      uDmRimSii: uniform(Math.max(d.rimSii, 0)),
      uDmKnotFreq: uniform(d.knotFreq),
      uDmKnot: uniform(clamp01(d.knot)),
      uDmScatter: uniform(Math.max(d.scatter, 0)),
      uDmGain: uniform(Math.max(d.gain, 0)),
      uDmEye: uniform(new THREE.Vector2(0, 0)),
      uDmEyeZ: uniform(Math.max(d.eyeDepth, 1e-2)),
      uDmOff: uniform(offsetFrom(instanceSeed(e, 137, k), 137)),
      uDepthDm: uniform(e.depth ?? 0.55),
    }, (b, aspect) => {
      b.uDmCenter.value.set(d.center[0] * aspect, d.center[1]);
      b.uDmIonSrc.value.set(d.ionSrc[0] * aspect, d.ionSrc[1]);
      b.uDmEye.value.set(d.eye[0] * aspect, d.eye[1]);
    });
    /* Build gates ride the bag; octave counts change the emitted shader */
    bag.dustOpts = {
      octaves: d.octaves, eroOctaves: d.eroOctaves, shadow: d.shadow !== false,
    };
    warnTauDepth('darkDust', e.depth ?? 0.55);
    return bag;
  }

  /* Pass-level march dials (one schedule for the whole batch); the first
     marched entity's params win. Created only when the pass exists, so a
     dust-less scene compiles the exact graph it always did. */
  if (dustEnts.length > 0) {
    const d0 = { ...DUST_MARCH_DEFAULTS, ...dustEnts[0].params };
    const steps = Math.min(Math.max(Math.round(d0.steps) || 32, 4), 64);
    Object.assign(U, {
      uDmSteps: uniform(steps, 'int'),
      uDmDu: uniform(2 / steps),
      uDmTauCut: uniform(Math.max(d0.tauCutoff, 0.5)),
      uDmFrontK: uniform(Math.max(d0.frontK, 0)),
      uDmSkip: uniform(Math.max(d0.skipEps, 1e-5)),
      uDepthDust: uniform(dustEnts[0].depth ?? 0.55),
    });
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
  const cluInst = featureEnts.clusters.map((e, k) => clustersBag(e, k));
  const scBag = byType.starcloud ? starcloudBag(byType.starcloud) : null;
  const gxInst = featureEnts.galaxies.map((e, k) => galaxiesBag(e, k));
  const ionInst = featureEnts.ionCloud.map((e, k) => ionCloudBag(e, k));
  const shapeInst = featureEnts.shape.map((e, i) => shapeBag(e, shapeIdx[i]));
  const dustInst = dustEnts.map((e, k) => dustBag(e, k));

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
  /* Galaxy starlight is continuum; only the showpiece's HII knots have a line
     signature, and the shell elliptical has none at all. */
  for (const bag of gxInst) {
    const nodes = buildGalaxyNodes(skyAtDepth(bag.uDepthGx, U.uDepthLine), bag, bag.gxOpts);
    if (nodes.line) lineNode = lineNode.add(vec4(nodes.line, 0.0));
  }
  for (const bag of ionInst) {
    lineNode = lineNode.add(vec4(buildIonCloudNodes(skyAtDepth(bag.uDepthIon, U.uDepthLine), bag, bag.ionOpts).line, 0.0));
  }
  /* Scattered starlight has no line signature, so echo only reaches the line RT
     when the host opts into the Hα whisper; the module builds no `line` otherwise. */
  for (const bag of echoInst) {
    if (!bag.echoOpts.ha) continue;
    lineNode = lineNode.add(vec4(buildEchoNodes(skyAtDepth(bag.uDepthEcho, U.uDepthLine), bag, bag.echoOpts).line, 0.0));
  }

  let contNode = buildContinuumNodes(skyU, U.uPxPerUnit, U,
    { grain: P.ifn.grain > 0, swirl: P.ifn.swirl > 0 });
  for (const bag of reflInst) {
    contNode = contNode.add(vec4(buildReflectionNodes(skyAtDepth(bag.uDepthRefl, U.uDepthCont), bag).continuum, 0.0));
  }
  for (const bag of echoInst) {
    contNode = contNode.add(vec4(buildEchoNodes(skyAtDepth(bag.uDepthEcho, U.uDepthCont), bag, bag.echoOpts).continuum, 0.0));
  }
  /* Only the source star: the shocks themselves are line species */
  for (const bag of jetInst) {
    contNode = contNode.add(vec4(buildJetNodes(skyAtDepth(bag.uDepthJet, U.uDepthCont), bag, bag.jetOpts).continuum, 0.0));
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
  for (const bag of gxInst) {
    contNode = contNode.add(vec4(buildGalaxyNodes(skyAtDepth(bag.uDepthGx, U.uDepthCont), bag, bag.gxOpts).continuum, 0.0));
  }
  /* Starlight, resolved or not, carries no line signature: both of these write
     continuum only, and the band's rift reaches compose as optical depth. */
  for (const bag of cluInst) {
    contNode = contNode.add(vec4(buildClusterNodes(
      skyAtDepth(bag.uDepthClu, U.uDepthCont), U.uPxPerUnit, bag, bag.cluOpts).continuum, 0.0));
  }
  if (scBag) {
    contNode = contNode.add(vec4(buildStarcloudNodes(
      skyAtDepth(scBag.uDepthSC, U.uDepthCont), scBag, scBag.scOpts).continuum, 0.0));
  }

  const lineScene = fullscreenPass(lineNode);
  const contScene = fullscreenPass(contNode);

  /* Resolved galaxy stars: instanced sprites additively into the continuum
     RT, so they parallax and lens with the glow they sit on. */
  const gxStarMeshes = [];
  for (const bag of gxInst) {
    if (!bag.gxsCount) continue;
    const nodes = buildGalaxyStarNodes(bag, bag.gxsOpts);
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.positionNode = nodes.positionNode;
    mat.fragmentNode = nodes.fragmentNode;
    mat.transparent = true;
    mat.blending = THREE.AdditiveBlending;
    mat.depthTest = false;
    mat.depthWrite = false;

    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(bag.gxsData.iA, 4));
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(bag.gxsData.iB, 4));
    geo.instanceCount = bag.gxsData.count;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    contScene.add(mesh);
    gxStarMeshes.push(mesh);
  }
  /* The dust march renders its own MRT before compose; entities pre-shift to
     the pass RT depth exactly the way the other shared-RT layers do. */
  const dust = dustInst.length > 0
    ? buildDustPass({
      instances: dustInst,
      U,
      skyAt: (depthU) => skyAtDepth(depthU, U.uDepthDust),
    })
    : null;

  const composeScene = fullscreenPass(buildComposeNodes({
    lineTex: lineRT.texture, contTex: contRT.texture, brightTex: brightRT.texture, U,
    layers: {
      globules: globInst,
      reflection: reflInst,
      echo: echoInst,
      shadowFan: fanInst,
      searchlight: beamInst,
      shape: shapeInst,
      starcloud: scBag?.scOpts.rift ? [scBag] : [],
    },
    lens: lensOn ? { halos: lensHalos } : null,
    dust: dust ? { lineTex: dust.lineTex, contTex: dust.contTex } : null,
  }));

  /* Bright tier: instanced quads, rebuilt on resize because sizes are in
     device pixels and positions span the current aspect */
  const brightScene = new THREE.Scene();
  /* Doctrine says the star tier composites additively last, over everything.
     This gate is the sanctioned exception: it lets the wisp layer punch a
     Barnard 68 hole in the field, and it is off unless the user asks. */
  const starOcclude = P.darkDust.occlude === true
    ? (skyAt) => wispTransmittance(skyAt, U)
    : null;
  const brightNodes = buildBrightStarNodes(U, { occlude: starOcclude });
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

  /* Tile (0,0) reuses the base seed, so a centered camera renders exactly the
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
    const iD = new Float32Array(total * 4);

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
        /* Unitless PSF jitter, so unlike iC it never scales with the DPR */
        iD[d] = data.iD[s];
        iD[d + 1] = data.iD[s + 1];
        iD[d + 2] = data.iD[s + 2];
        iD[d + 3] = data.iD[s + 3];
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
    geo.setAttribute('iD', new THREE.InstancedBufferAttribute(iD, 4));
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
     a uniform poke. Leaving or returning to dead center counts as a crossing. */
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
    if (dust) dust.setSize(w, h);

    const aspect = cssW / cssH;
    U.uResolution.value.set(w, h);
    U.uAspect.value = aspect;
    U.uMarginScale.value.set(1 + (2 * margin) / w, 1 + (2 * margin) / h);
    U.uPxPerUnit.value = Math.max(h, 1) / U.uMarginScale.value.y;
    U.uNebIonSrc.value.set(P.emission.ionSrc[0] * aspect, P.emission.ionSrc[1]);
    /* Sky x spans [0, aspect], so framed positions scale or they slide toward
       the left edge as the canvas widens */
    for (const reseat of reseats) reseat(aspect);
    for (const bag of gxInst) bag.uGxsDpr.value = dpr;

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
    if (dust) {
      renderer.setRenderTarget(dust.rt);
      renderer.render(dust.scene, camera);
    }
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
      return normalizeRows(pixels, width, height, !isWebGPU);
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
    dust?.dispose();
    /* Per unique asset, not per instance: two entities sharing one shape share
       one texture, and disposing it twice is a use-after-free on reroll. */
    for (const asset of shapeAssets.values()) asset.texture.dispose();
    for (const mesh of gxStarMeshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    renderer.dispose();
  }

  const backend = isWebGPU ? 'webgpu' : 'webgl2';
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
      clusters: cluInst.slice(),
      galaxies: gxInst.slice(),
      ionCloud: ionInst.slice(),
      shape: shapeInst.slice(),
      dustMarch: dustInst.slice(),
    },
  };
}
