/* Wallpaper host: boots the engine full-bleed with no page chrome. No cursor
   parallax: once parented behind the desktop icons the window stops receiving input. */

import { heroScene, HERO_SEED } from '/site/hero-scene.js';
import { createEvolutionClock } from '/engine/core/evolution.js';
import { createSky2D } from '/engine/render/sky2d.js';

const FRAME_MS = 1000 / 30;

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('sky');

const urlSeed = parseInt(params.get('seed'), 10);
const seed = Number.isFinite(urlSeed) ? urlSeed : HERO_SEED;

/* WebGL2 is the shipping desktop renderer; WebView2's WebGPU support varies by
   runtime version, so it is opt-in via ?gpu=1 until a probe says otherwise. */
const wantsWebGPU = params.get('gpu') === '1';

let sky = null;
let clock = null;
let rate = 1;
let lastFrame = 0;

const tev = () => (clock.now() / 3600) * rate;

function resizeNow() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w === 0 || h === 0) return false;
  sky.resize(w, h, window.devicePixelRatio || 1);
  return true;
}

function frame(now) {
  requestAnimationFrame(frame);
  if (now - lastFrame < FRAME_MS) return;
  lastFrame = now;
  sky.render(tev(), 0, 0);
}

async function boot() {
  const config = await heroScene(seed);
  /* No parallax means no overscan margin to pay for, which is real fill rate
     back across a multi-monitor canvas. Raise this if cursor deflection lands. */
  sky = await createSky2D({ canvas, config, forceWebGL: !wantsWebGPU, maxParallaxPx: 0 });
  clock = createEvolutionClock(`cosmorph:T:${seed}`);
  rate = config.evolution.rate;
  console.info(`Cosmorph: seed ${seed} on ${sky.backend}`);

  resizeNow();
  sky.render(tev(), 0, 0);
  requestAnimationFrame(frame);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (resizeNow()) sky.render(tev(), 0, 0);
    }, 150);
  }, { passive: true });

  /* A wallpaper is never navigated away from and gets killed rather than
     closed, so pagehide alone would lose the evolution clock every session. */
  setInterval(() => clock.persist(), 60_000);
  window.addEventListener('pagehide', () => clock.persist());
}

boot().catch((err) => {
  console.error('Cosmorph: wallpaper boot failed.', err);
});
