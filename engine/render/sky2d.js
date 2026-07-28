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

  /* One entity per type in v1; Firmament's renderer is what batches by cost
     class, so a duplicate is dropped loudly rather than half-rendered. */
  const byType = {};
  for (const e of config.entities) {
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
    globules: { ...DEFAULTS.globules, ...byType.globules?.params },
    reflection: { ...DEFAULTS.reflection, ...byType.reflection?.params },
    filaments: { ...DEFAULTS.filaments, ...byType.filaments?.params },
  };

  /* Absent types contribute no uniforms, nodes, or passes, so a scene without
     them generates the shader it generated before they existed. */
  const has = {
    globules: !!byType.globules,
    reflection: !!byType.reflection,
    filaments: !!byType.filaments,
  };

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

  if (has.globules) {
    const g = P.globules;
    Object.assign(U, {
      uGlobFreq: uniform(g.freq),
      uGlobOff: uniform(offsetFrom(byType.globules.seed ?? config.seed, 47)),
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
      uDepthGlob: uniform(byType.globules.depth ?? 0.6),
    });
  }

  if (has.reflection) {
    const r = P.reflection;
    Object.assign(U, {
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
      uReflOff: uniform(offsetFrom(byType.reflection.seed ?? config.seed, 53)),
      uDepthRefl: uniform(byType.reflection.depth ?? 0.35),
    });
  }

  if (has.filaments) {
    const f = P.filaments;
    Object.assign(U, {
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
      uFilOff: uniform(offsetFrom(byType.filaments.seed ?? config.seed, 59)),
      uDepthFil: uniform(byType.filaments.depth ?? 0.25),
    });
  }

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
  const reflLine = has.reflection
    ? buildReflectionNodes(skyAtDepth(U.uDepthRefl, U.uDepthLine), U).line : null;
  const reflCont = has.reflection
    ? buildReflectionNodes(skyAtDepth(U.uDepthRefl, U.uDepthCont), U).continuum : null;
  const filLine = has.filaments
    ? buildFilamentNodes(skyAtDepth(U.uDepthFil, U.uDepthLine), U).line : null;

  let lineNode = buildEmissionNodes(skyU, U);
  if (reflLine) lineNode = lineNode.add(vec4(reflLine, 0.0));
  if (filLine) lineNode = lineNode.add(vec4(filLine, 0.0));

  let contNode = buildContinuumNodes(skyU, U.uPxPerUnit, U);
  if (reflCont) contNode = contNode.add(vec4(reflCont, 0.0));

  const lineScene = fullscreenPass(lineNode);
  const contScene = fullscreenPass(contNode);
  const composeScene = fullscreenPass(buildComposeNodes({
    lineTex: lineRT.texture, contTex: contRT.texture, brightTex: brightRT.texture, U,
    layers: {
      globules: has.globules ? { cometary: P.globules.cometary !== false } : null,
      reflection: has.reflection,
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
    U.uGlobIonSrc?.value.set(P.globules.ionSrc[0] * aspect, P.globules.ionSrc[1]);
    U.uReflStar?.value.set(P.reflection.star[0] * aspect, P.reflection.star[1]);
    U.uArcCenter?.value.set(P.filaments.center[0] * aspect, P.filaments.center[1]);

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
  return { render, resize, dispose, backend, capture, setCamera, uniforms: U };
}
