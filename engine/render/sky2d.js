/* 2D render spine: three half-float accumulation targets (line, continuum,
   bright stars) composed through the grading chain to the canvas. Walks an
   entity-array scene config; layer shaders never output RGB directly. */

import * as THREE from 'three/webgpu';
import { uniform, uv, vec2 } from 'three/tsl';
import { createRng, deriveSeed } from '../core/rng.js';
import { generateBrightStars } from '../entities/stars.js';
import { buildBrightStarNodes } from '../shaders/tsl/stars.js';
import { buildEmissionNodes } from '../shaders/tsl/nebula.js';
import { buildContinuumNodes } from '../shaders/tsl/dust.js';
import { buildComposeNodes } from '../shaders/tsl/compose.js';

/* Narrowband palettes as mat3 rows R/G/B over vec3(Hα, OIII, SII).
   Community default is natural HOO; SHO reads dated to many eyes now. */
const PALETTES = {
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
};

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

  const byType = Object.fromEntries(config.entities.map((e) => [e.type, e]));
  const P = {
    emission: { ...DEFAULTS.emission, ...byType.emission?.params },
    ifn: { ...DEFAULTS.ifn, ...byType.ifn?.params },
    stars: { ...DEFAULTS.stars, ...byType.stars?.params },
    darkDust: { ...DEFAULTS.darkDust, ...byType.darkDust?.params },
  };

  const paletteRows = PALETTES[config.palette] ?? PALETTES.hooNatural;
  const scnrDefault = config.palette === 'sho' ? 0.7 : (config.scnr ?? 0);
  const stretchK = config.stretchK ?? 14;

  const U = {
    uResolution: uniform(new THREE.Vector2(1, 1)),
    uAspect: uniform(1),
    uMarginScale: uniform(new THREE.Vector2(1, 1)),
    uPxPerUnit: uniform(1),
    uParallax: uniform(new THREE.Vector2(0, 0)),
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
  /* Layer passes render an overscanned domain so compose can offset without
     sampling past an RT edge */
  const uvE = uv().sub(0.5).mul(U.uMarginScale).add(0.5);
  const skyU = uvE.mul(vec2(U.uAspect, 1.0));

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

  const lineScene = fullscreenPass(buildEmissionNodes(skyU, U));
  const contScene = fullscreenPass(buildContinuumNodes(skyU, U.uPxPerUnit, U));
  const composeScene = fullscreenPass(buildComposeNodes({
    lineTex: lineRT.texture, contTex: contRT.texture, brightTex: brightRT.texture, U,
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

  function buildBrightGeometry(aspect, dpr) {
    const seed = byType.stars?.seed ?? config.seed;
    const data = generateBrightStars(seed, { count: P.stars.count, aspect });
    const iC = data.iC.slice();
    for (let i = 0; i < data.count; i++) {
      iC[i * 4 + 0] *= dpr;
      iC[i * 4 + 1] *= dpr;
      iC[i * 4 + 2] *= dpr;
    }
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(data.iA, 4));
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(data.iB, 4));
    geo.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 4));
    geo.instanceCount = data.count;
    return geo;
  }

  let dpr = 1;

  function resize(cssW, cssH, pixelRatio) {
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

    if (brightMesh) {
      brightMesh.geometry.dispose();
      brightScene.remove(brightMesh);
    }
    brightMesh = new THREE.Mesh(buildBrightGeometry(aspect, dpr), brightMat);
    brightMesh.frustumCulled = false;
    brightScene.add(brightMesh);
  }

  function render(tevHours, parallaxCssX, parallaxCssY) {
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
    renderer.setRenderTarget(null);
    renderer.render(composeScene, camera);
  }

  function dispose() {
    lineRT.dispose();
    contRT.dispose();
    brightRT.dispose();
    renderer.dispose();
  }

  const backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
  return { render, resize, dispose, backend };
}
