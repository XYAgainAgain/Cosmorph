/* Hero sky host: engine on WebGPU, then WebGL2, then the static 2D fallback.
   Owns the frame cap, evolution clock, cursor parallax, reroll, and lifecycle. */

import { heroScene, HERO_SEED } from '/site/hero-scene.js';
import { createEvolutionClock } from '/engine/core/evolution.js';

/* 30 divides evenly into 60/120/240 Hz refreshes; 24 judders against them */
const FRAME_MS = 1000 / 30;
const MAX_THROW = 14; // css px of cursor parallax at full deflection

/* Burst cadence: full rAF while anything is moving, idle ticks once it settles.
   The spec's optional "half refresh" burst rate is deferred to a later chunk. */
const STILL_MS = 1000;
const SETTLE_PX = 0.05;
/* A twinkling star tier is motion, so it floors the idle cadence at 30 FPS and
   prefers half the measured panel refresh; 2 FPS is only for a static sky. */
const IDLE_STATIC_MS = 500;
let idleMs = 1000 / 30;
let refreshHz = 0;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
/* Baked is the default; ?live=1 keeps the old live render at the 30 FPS cap */
const LIVE = params.get('live') === '1';
let bakedOverride = null; // debug hotkey C flips this past the URL flag

let canvasEl = document.getElementById('sky');
let sky = null;
let clock = null;
let evolutionRate = 1;
let rafId = 0;
let lastFrame = 0;
let lastNow = 0;
let lastInput = 0;
let fadesActive = 0;
let rerolling = false;
let drawnFrames = 0; // mode-agnostic counter; the debug HUD derives FPS from it
const lastBoot = { seed: 0, forceGL: false, useAuthored: false };

const target = { x: 0, y: 0 };
const cursor = { x: 0, y: 0 };

/* A canvas can hold only one context type, so every attempt gets a fresh node */
function freshCanvas() {
  const next = canvasEl.cloneNode(false);
  canvasEl.replaceWith(next);
  canvasEl = next;
  return next;
}

async function tryEngine(config, forceGL) {
  const { createSky2D } = await import('/engine/render/sky2d.js');
  const baked = bakedOverride ?? !LIVE;
  if (forceGL) {
    return createSky2D({
      canvas: freshCanvas(), config, forceWebGL: true, maxParallaxPx: MAX_THROW, baked,
    });
  }
  try {
    return await createSky2D({
      canvas: freshCanvas(), config, maxParallaxPx: MAX_THROW, baked,
    });
  } catch (err) {
    console.warn('Cosmorph: WebGPU path failed, retrying on WebGL2.', err);
    return createSky2D({
      canvas: freshCanvas(), config, forceWebGL: true, maxParallaxPx: MAX_THROW, baked,
    });
  }
}

/* One dispatch for both modes, so the reduced-motion single frame and the
   resize repaint go through whichever path the build actually made. */
function draw(px, py) {
  (sky.renderBaked ?? sky.render)(tev(), px, py);
}

const tev = () => (clock.now() / 3600) * evolutionRate;

function computeIdle() {
  const twinkling = sky?.twinkleActive ?? true;
  idleMs = twinkling ? 1000 / Math.max(30, (refreshHz || 60) / 2) : IDLE_STATIC_MS;
}

/* Median of 40 rAF deltas; the panel's true refresh, robust to one-off stalls */
function measureRefresh() {
  const deltas = [];
  let prev = 0;
  const tick = (t) => {
    if (prev > 0) deltas.push(t - prev);
    prev = t;
    if (deltas.length < 40) { requestAnimationFrame(tick); return; }
    deltas.sort((a, b) => a - b);
    refreshHz = Math.min(1000 / deltas[20], 480);
    computeIdle();
  };
  requestAnimationFrame(tick);
}

function resizeNow() {
  if (!sky) return false;
  const rect = canvasEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  sky.resize(rect.width, rect.height, window.devicePixelRatio || 1);
  return true;
}

/* Anything still in motion — recent pointer input, a fade, or cursor damping
   that has not settled — holds the composite at panel refresh */
function bursting(now) {
  return (now - lastInput) < STILL_MS
    || fadesActive > 0
    || Math.hypot(target.x - cursor.x, target.y - cursor.y) > SETTLE_PX;
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  /* Cap follows the engine's actual mode, so the debug C-toggle can override
     the URL flag either way; the live path keeps its own 30 FPS cap. */
  const cap = sky.renderBaked ? (bursting(now) ? 0 : idleMs) : FRAME_MS;
  if (cap > 0 && now - lastFrame < cap) return;
  const dt = Math.min((now - lastNow) / 1000, 0.25);
  /* Carry the remainder so a capped cadence averages its true rate against vsync */
  lastFrame = cap > 0 ? now - ((now - lastFrame) % cap) : now;
  lastNow = now;

  /* Exponential damping toward the pointer, framerate-independent */
  const k = 1 - Math.exp(-dt * 3.5);
  cursor.x += (target.x - cursor.x) * k;
  cursor.y += (target.y - cursor.y) * k;

  draw(cursor.x, cursor.y);
  drawnFrames += 1;
}

function start() {
  if (rafId || !sky || reduceMotion.matches || document.hidden) return;
  lastFrame = 0;
  lastNow = performance.now();
  rafId = requestAnimationFrame(frame);
}

function stop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

function renderOnce() {
  if (!resizeNow()) return;
  if (reduceMotion.matches) {
    stop();
    draw(0, 0);
  } else {
    draw(cursor.x, cursor.y);
    start();
  }
}

const veilEl = document.getElementById('veil');

/* The veil (a plain div) carries every fade; canvases repaint unpredictably
   around context creation, so they never animate themselves */
async function veil(dark) {
  if (!veilEl) return;
  /* Boot can outrun the page's first presented frame; revealing before the
     dark veil has visibly painted reads as a pop, not a fade */
  if (!dark) {
    if (document.readyState !== 'complete') {
      await new Promise((r) => window.addEventListener('load', r, { once: true }));
    }
    await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  /* Counted rather than flagged so overlapping fades cannot un-burst each other,
     and raised only here so a slow load never holds the burst open waiting */
  fadesActive += 1;
  try {
    veilEl.classList.toggle('is-dark', dark);
    if (reduceMotion.matches) return;
    await new Promise((resolve) => setTimeout(resolve, 1060));
  } finally {
    fadesActive -= 1;
  }
}

/* The default homepage is Sam's authored .cosmos, run through the same
   sanitizer and config builder Firmament uses. A reroll or a shared ?seed
   drops to the procedural hero; any failure here does the same. */
async function authoredScene() {
  const [{ deserialize, buildEngineConfig }, res] = await Promise.all([
    import('/firmament/preset.js'),
    fetch('/site/hero.cosmos'),
  ]);
  if (!res.ok) throw new Error(`hero.cosmos ${res.status}`);
  const { scene, savedT } = deserialize(await res.json());
  return { config: buildEngineConfig(scene), savedT };
}

/* ?demo= swaps the scene without touching the hero config, and the module only
   loads when asked for, so the homepage never fetches it */
async function sceneFor(seed, useAuthored) {
  const name = params.get('demo');
  /* A failed import must fall back to the hero here, not tumble into boot()'s
     catch, which would blame the engine and swap in the static placeholder */
  if (name) {
    try {
      const { demoScene } = await import('/site/demo-scenes.js');
      const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
      const scene = demoScene(name, seed, aspect);
      if (!scene) console.warn(`Cosmorph: no demo scene named "${name}", using the hero.`);
      return { config: scene ?? heroScene(seed), savedT: 0, sceneIdentity: `demo:${name}` };
    } catch (err) {
      console.warn('Cosmorph: demo scenes failed to load, using the hero.', err);
      return { config: heroScene(seed), savedT: 0, sceneIdentity: `demo:${name}` };
    }
  }
  if (useAuthored) {
    try {
      return { ...await authoredScene(), sceneIdentity: 'authored-hero' };
    } catch (err) {
      console.warn('Cosmorph: authored homepage failed to load, using the procedural hero.', err);
    }
  }
  /* Rerolls and shared ?seed links generate a whole new composition, still
     seed-deterministic so the URL reproduces the exact sky. */
  try {
    const { rerollScene } = await import('/site/reroll-scene.js');
    return { config: rerollScene(seed), savedT: 0, sceneIdentity: 'procedural-hero' };
  } catch (err) {
    console.warn('Cosmorph: reroll generator failed, using the fixed hero.', err);
    return { config: heroScene(seed), savedT: 0, sceneIdentity: 'procedural-hero' };
  }
}

async function startEngine(seed, forceGL, useAuthored = false) {
  Object.assign(lastBoot, { seed, forceGL, useAuthored });
  const { config, savedT, sceneIdentity } = await sceneFor(seed, useAuthored);
  sky = await tryEngine(config, forceGL);
  /* ?debug=1 exposes the instance for bake-stats inspection; never set by the site */
  if (params.has('debug')) window.__sky = sky;
  clock = createEvolutionClock(`cosmorph:T:${sceneIdentity}:${config.seed ?? seed}`, savedT);
  evolutionRate = config.evolution.rate;
  computeIdle();
  console.info(`Cosmorph: seed ${config.seed ?? seed} on ${sky.backend}`);
}

/* Debug-only baked↔live flip: same seed, same T, fresh engine on the other path */
async function setMode(nextBaked) {
  if (rerolling || !sky) return;
  rerolling = true;
  try {
    stop();
    clock.persist();
    sky.dispose();
    sky = null;
    bakedOverride = nextBaked;
    await startEngine(lastBoot.seed, lastBoot.forceGL, lastBoot.useAuthored);
    renderOnce();
  } catch (err) {
    console.warn('Cosmorph: mode toggle failed.', err);
  } finally {
    rerolling = false;
  }
}

/* Fade to black, rebuild the whole sky on a fresh seed, fade back in.
   The URL updates without a navigation so the sky stays shareable. */
async function reroll() {
  if (rerolling) return;
  const seed = Math.floor(Math.random() * 0x7FFFFFFF);
  params.set('seed', String(seed));
  if (!sky) {
    location.assign(`?${params}`);
    return;
  }
  rerolling = true;
  try {
    await veil(true);
    stop();
    clock.persist();
    sky.dispose();
    sky = null;
    await startEngine(seed, params.get('gl') === '1');
    history.replaceState(null, '', `?${params}`);
    renderOnce();
    await veil(false);
  } catch (err) {
    console.warn('Cosmorph: reroll failed, reloading.', err);
    veil(false);
    location.assign(`?${params}`);
  } finally {
    rerolling = false;
  }
}

async function boot() {
  const urlSeed = parseInt(params.get('seed'), 10);
  const initialSeed = Number.isFinite(urlSeed) ? urlSeed : HERO_SEED;
  /* No explicit seed and no demo: the authored default sky */
  const useAuthored = !Number.isFinite(urlSeed) && !params.get('demo');

  document.getElementById('reroll')?.addEventListener('click', reroll);

  if (params.get('fb') === '1') {
    freshCanvas();
    await import('/site/starfield.js');
    veil(false);
    return;
  }

  try {
    await startEngine(initialSeed, params.get('gl') === '1', useAuthored);
  } catch (err) {
    console.warn('Cosmorph: engine unavailable, using placeholder starfield.', err);
    freshCanvas();
    await import('/site/starfield.js');
    veil(false);
    return;
  }

  measureRefresh();

  if (params.has('debug')) {
    import('/site/debug.js').then((m) => m.initDebug({
      getState: () => ({
        backend: sky?.backend,
        mode: sky?.renderBaked ? 'baked' : 'live',
        bursting: rafId ? bursting(performance.now()) : false,
        idleMs,
        refreshHz,
        twinkle: sky?.twinkleActive ?? false,
        planes: sky?.planesInfo ?? [],
        stats: sky?.bakedStats ?? null,
        drawnFrames,
      }),
      toggleMode: () => setMode(!sky?.renderBaked),
    })).catch((err) => console.warn('Cosmorph: debug tools failed to load.', err));
  }

  window.addEventListener('pointermove', (e) => {
    lastInput = performance.now();
    target.x = ((e.clientX / window.innerWidth) * 2 - 1) * MAX_THROW;
    target.y = ((e.clientY / window.innerHeight) * 2 - 1) * MAX_THROW;
  }, { passive: true });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderOnce, 150);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop();
      clock?.persist();
    } else {
      start();
    }
  });
  window.addEventListener('pagehide', () => clock?.persist());
  reduceMotion.addEventListener('change', renderOnce);

  renderOnce();
  veil(false);
}

boot().catch((err) => {
  console.warn('Cosmorph: boot failed.', err);
  veil(false);
});
