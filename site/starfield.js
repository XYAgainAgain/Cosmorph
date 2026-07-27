/* Placeholder hero sky. Swapped for the real Cosmorph engine once it exists;
   the layout and the canvas element stay exactly as they are. */

const canvas = document.getElementById('sky');
const ctx = canvas?.getContext('2d', { alpha: true });
if (!canvas || !ctx) throw new Error('sky canvas unavailable');

const LAYERS = [
  { count: 620, depth: 0.25 },
  { count: 300, depth: 0.55 },
  { count: 110, depth: 1.00 },
];

/* Real star counts are dominated by the faint end. A uniform brightness roll is the
   single most obvious tell of a fake field, so bias the draw hard toward dim. */
const MAG_GAMMA = 3.4;

/* Weighted toward white and blue-white: a magnitude-limited sample skews hot,
   which is why real deep-sky frames are mostly white with a few orange standouts. */
const TINTS = [
  [255, 255, 255, 5],
  [220, 230, 255, 2],
  [170, 191, 255, 1],
  [255, 244, 232, 2],
  [255, 237, 151, 1.5],
  [255, 196, 107, 1],
];
const TINT_TOTAL = TINTS.reduce((sum, t) => sum + t[3], 0);

/* Mulberry32, matching the engine's own PRNG so the site and the product agree */
function createRng(seed) {
  let s = seed | 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

function pickTint(r) {
  let roll = r * TINT_TOTAL;
  for (const tint of TINTS) {
    roll -= tint[3];
    if (roll <= 0) return tint;
  }
  return TINTS[0];
}

let stars = [];
let width = 0;
let height = 0;
let dpr = 1;

/* The field is generated wider than the viewport so slow drift never exposes an edge */
const BLEED = 0.12;

function build() {
  const rng = createRng(1978);
  stars = [];

  for (const layer of LAYERS) {
    for (let i = 0; i < layer.count; i++) {
      const [r, g, b] = pickTint(rng());
      const mag = Math.pow(rng(), MAG_GAMMA);
      stars.push({
        x: rng() * (1 + BLEED * 2) - BLEED,
        y: rng() * (1 + BLEED * 2) - BLEED,
        /* Radius follows brightness, so the bright few are also the big few */
        radius: lerp(0.32, 1.25, Math.pow(mag, 0.65)),
        mag: lerp(0.1, 1, mag),
        depth: layer.depth,
        phase: rng() * Math.PI * 2,
        rate: 0.35 + rng() * 0.5,
        color: `${r}, ${g}, ${b}`,
      });
    }
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = rect.width;
  height = rect.height;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

function draw(seconds) {
  ctx.clearRect(0, 0, width, height);

  const span = Math.max(width, height);

  for (const star of stars) {
    /* Deeper layers slide further: the same multiplane parallax the wallpaper uses */
    const driftX = Math.sin(seconds * 0.013 + star.depth * 1.7) * 26 * star.depth;
    const driftY = Math.cos(seconds * 0.009 + star.depth * 2.3) * 16 * star.depth;

    const x = star.x * width + driftX;
    const y = star.y * height + driftY;
    if (x < -8 || x > width + 8 || y < -8 || y > height + 8) continue;

    const twinkle = 0.82 + 0.18 * Math.sin(seconds * star.rate + star.phase);
    const alpha = star.mag * twinkle;

    ctx.fillStyle = `rgba(${star.color}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, star.radius, 0, Math.PI * 2);
    ctx.fill();

    /* Only the brightest few get a halo, and it stays weak: a glow on every
       star reads as fog, and a strong one turns sharp points into blobs */
    if (star.mag > 0.86) {
      const reach = star.radius * 6;
      const glow = ctx.createRadialGradient(x, y, star.radius * 0.6, x, y, reach);
      glow.addColorStop(0, `rgba(${star.color}, ${alpha * 0.16})`);
      glow.addColorStop(1, `rgba(${star.color}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, reach, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* Faint vignette so the field falls off toward the frame edge */
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, span * 0.25,
    width / 2, height / 2, span * 0.78,
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const FRAME_MS = 1000 / 24;

let rafId = 0;
let lastFrame = 0;

function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (now - lastFrame < FRAME_MS) return;
  lastFrame = now;
  draw(now / 1000);
}

function stop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

function start() {
  if (rafId || reduceMotion.matches || document.hidden) return;
  lastFrame = 0;
  rafId = requestAnimationFrame(loop);
}

function render() {
  if (!resize()) return;
  if (reduceMotion.matches) {
    stop();
    draw(0);
  } else {
    draw(performance.now() / 1000);
    start();
  }
}

build();
render();

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  document.hidden ? stop() : start();
});

reduceMotion.addEventListener('change', render);
