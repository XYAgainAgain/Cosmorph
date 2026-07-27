/* Hero sky host: engine on WebGPU, then WebGL2, then the static 2D fallback.
   Owns the frame cap, evolution clock, cursor parallax, reroll, and lifecycle. */

import { heroScene, HERO_SEED } from '/site/hero-scene.js';
import { createEvolutionClock } from '/engine/core/evolution.js';

/* 30 divides evenly into 60/120/240 Hz refreshes; 24 judders against them */
const FRAME_MS = 1000 / 30;
const MAX_THROW = 14; // css px of cursor parallax at full deflection

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);

let canvasEl = document.getElementById('sky');
let sky = null;
let clock = null;
let evolutionRate = 1;
let rafId = 0;
let lastFrame = 0;
let lastNow = 0;
let rerolling = false;

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
  if (forceGL) {
    return createSky2D({ canvas: freshCanvas(), config, forceWebGL: true, maxParallaxPx: MAX_THROW });
  }
  try {
    return await createSky2D({ canvas: freshCanvas(), config, maxParallaxPx: MAX_THROW });
  } catch (err) {
    console.warn('Cosmorph: WebGPU path failed, retrying on WebGL2.', err);
    return createSky2D({ canvas: freshCanvas(), config, forceWebGL: true, maxParallaxPx: MAX_THROW });
  }
}

const tev = () => (clock.now() / 3600) * evolutionRate;

function resizeNow() {
  if (!sky) return false;
  const rect = canvasEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  sky.resize(rect.width, rect.height, window.devicePixelRatio || 1);
  return true;
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (now - lastFrame < FRAME_MS) return;
  const dt = Math.min((now - lastNow) / 1000, 0.25);
  lastFrame = now;
  lastNow = now;

  /* Exponential damping toward the pointer, framerate-independent */
  const k = 1 - Math.exp(-dt * 3.5);
  cursor.x += (target.x - cursor.x) * k;
  cursor.y += (target.y - cursor.y) * k;

  sky.render(tev(), cursor.x, cursor.y);
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
    sky.render(tev(), 0, 0);
  } else {
    sky.render(tev(), cursor.x, cursor.y);
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
  veilEl.classList.toggle('is-dark', dark);
  if (reduceMotion.matches) return;
  await new Promise((resolve) => setTimeout(resolve, 1060));
}

async function startEngine(seed, forceGL) {
  const config = heroScene(seed);
  sky = await tryEngine(config, forceGL);
  clock = createEvolutionClock(`cosmorph:T:${seed}`);
  evolutionRate = config.evolution.rate;
  console.info(`Cosmorph: seed ${seed} on ${sky.backend}`);
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

  document.getElementById('reroll')?.addEventListener('click', reroll);

  if (params.get('fb') === '1') {
    freshCanvas();
    await import('/site/starfield.js');
    veil(false);
    return;
  }

  try {
    await startEngine(initialSeed, params.get('gl') === '1');
  } catch (err) {
    console.warn('Cosmorph: engine unavailable, using placeholder starfield.', err);
    freshCanvas();
    await import('/site/starfield.js');
    veil(false);
    return;
  }

  window.addEventListener('pointermove', (e) => {
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
