/* Wallpaper host: boots the engine full-bleed with no page chrome. Cursor
   positions arrive from a platform host because the window accepts no input. */

import { heroScene, HERO_SEED } from '/site/hero-scene.js';
import { createEvolutionClock } from '/engine/core/evolution.js';
import { createSky2D } from '/engine/render/sky2d.js';

const FRAME_MS = 1000 / 30;
/* Safe to raise: the margin is a remap costing sampling density, not fill rate */
const WALLPAPER_THROW = 25;
const CURSOR_EVENT = 'cosmorph://cursor-position';

/* Burst cadence mirrors site/sky.js but caps at 60: a wallpaper's ~17 Mpx across
   three monitors would spin the GPU for smoothness nobody sees on a background. */
const BURST_MS = 1000 / 60;
const STILL_MS = 1000;
const SETTLE_PX = 0.05;
const IDLE_STATIC_MS = 500;

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('sky');

const urlSeed = parseInt(params.get('seed'), 10);
const seed = Number.isFinite(urlSeed) ? urlSeed : HERO_SEED;
/* No explicit seed: the same authored default sky the homepage boots */
const useAuthored = !Number.isFinite(urlSeed);

/* WebGL2 is the shipping desktop renderer; WebKitGTK and WebView2 WebGPU
   support both vary by runtime, so it is opt-in via ?gpu=1 until a probe says otherwise. */
const wantsWebGPU = params.get('gpu') === '1';
/* Baked is the default exactly like the homepage; ?live=1 keeps the 30 FPS live path */
const LIVE = params.get('live') === '1';

let sky = null;
let clock = null;
let rate = 1;
let lastFrame = 0;
let lastNow = performance.now();
let lastInput = 0;
let idleMs = 1000 / 30;
let refreshHz = 0;
let unlistenCursor = null;

const target = { x: 0, y: 0 };
const cursor = { x: 0, y: 0 };

const tev = () => (clock.now() / 3600) * rate;

const clampDeflection = (value) => Math.min(Math.max(value, -1), 1);

async function listenForCursor() {
  const listen = window.__TAURI__?.event?.listen;
  if (!listen) return;

  try {
    unlistenCursor = await listen(CURSOR_EVENT, ({ payload }) => {
      if (!Number.isFinite(payload?.x) || !Number.isFinite(payload?.y)) return;
      const nx = clampDeflection(payload.x) * WALLPAPER_THROW;
      const ny = clampDeflection(payload.y) * WALLPAPER_THROW;
      /* The host emits ~30/s even when idle; only real movement counts as
         input, or the burst would never end. */
      if (Math.hypot(nx - target.x, ny - target.y) > SETTLE_PX) {
        lastInput = performance.now();
      }
      target.x = nx;
      target.y = ny;
    });
  } catch (err) {
    console.warn('Cosmorph: host cursor feed unavailable; parallax stays neutral.', err);
  }
}

/* The authored .cosmos through Firmament's own sanitizer and config builder,
   exactly like the homepage; any failure drops to the procedural hero. */
async function sceneFor() {
  if (useAuthored) {
    try {
      const [{ deserialize, buildEngineConfig }, res] = await Promise.all([
        import('/firmament/preset.js'),
        fetch('/site/hero.cosmos'),
      ]);
      if (!res.ok) throw new Error(`hero.cosmos ${res.status}`);
      const { scene, savedT } = deserialize(await res.json());
      return { config: buildEngineConfig(scene), savedT, sceneIdentity: 'authored-hero' };
    } catch (err) {
      console.warn('Cosmorph: authored scene failed to load, using the procedural hero.', err);
    }
  }
  return { config: heroScene(seed), savedT: 0, sceneIdentity: 'procedural-hero' };
}

function computeIdle() {
  const twinkling = sky?.twinkleActive ?? true;
  idleMs = twinkling ? 1000 / Math.min(60, Math.max(30, (refreshHz || 60) / 2)) : IDLE_STATIC_MS;
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
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w === 0 || h === 0) return false;
  sky.resize(w, h, window.devicePixelRatio || 1);
  return true;
}

function draw(px, py) {
  (sky.renderBaked ?? sky.render)(tev(), px, py);
}

function bursting(now) {
  return (now - lastInput) < STILL_MS
    || sky?.fadeActive
    || Math.hypot(target.x - cursor.x, target.y - cursor.y) > SETTLE_PX;
}

function frame(now) {
  requestAnimationFrame(frame);
  const cap = sky.renderBaked ? (bursting(now) ? BURST_MS : idleMs) : FRAME_MS;
  if (cap > 0 && now - lastFrame < cap) return;
  const dt = Math.min((now - lastNow) / 1000, 0.25);
  /* Carry the remainder so a capped cadence averages its true rate against vsync */
  lastFrame = cap > 0 ? now - ((now - lastFrame) % cap) : now;
  lastNow = now;

  /* Matches the homepage's framerate-independent cursor damping. */
  const k = 1 - Math.exp(-dt * 3.5);
  cursor.x += (target.x - cursor.x) * k;
  cursor.y += (target.y - cursor.y) * k;

  draw(cursor.x, cursor.y);
}

async function boot() {
  const { config, savedT, sceneIdentity } = await sceneFor();
  sky = await createSky2D({
    canvas,
    config,
    forceWebGL: !wantsWebGPU,
    maxParallaxPx: WALLPAPER_THROW,
    baked: !LIVE,
    crossfade: true,
  });
  clock = createEvolutionClock(`cosmorph:T:${sceneIdentity}:${config.seed ?? seed}`, savedT);
  rate = config.evolution.rate;
  computeIdle();
  console.info(`Cosmorph: ${sceneIdentity} seed ${config.seed ?? seed} on ${sky.backend}`);

  resizeNow();
  draw(0, 0);
  lastNow = performance.now();
  requestAnimationFrame(frame);
  measureRefresh();

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (resizeNow()) draw(cursor.x, cursor.y);
    }, 150);
  }, { passive: true });

  /* A wallpaper is never navigated away from and gets killed rather than
     closed, so pagehide alone would lose the evolution clock every session. */
  setInterval(() => clock.persist(), 60_000);
  window.addEventListener('pagehide', () => {
    unlistenCursor?.();
    clock.persist();
  });
}

listenForCursor();
boot().catch((err) => {
  console.error('Cosmorph: wallpaper boot failed.', err);
});
