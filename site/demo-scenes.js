/* Demo scenes for the entity types the hero does not use. Reached only via
   ?demo=, loaded on demand, and deliberately separate from the hero config. */

import { createRng, deriveSeed } from '/engine/core/rng.js';

/* Framed positions (arc center, star) are params, not noise, so without this
   seed-driven jitter they would sit frozen across rerolls. Firmament gets dials. */
function jitter(seed, salt) {
  return createRng(deriveSeed(seed, salt));
}

function base(seed, extra) {
  return {
    version: 1,
    seed,
    evolution: { rate: 1 },
    palette: 'hooNatural',
    exposure: 0.85,
    stretchK: 10,
    entities: [
      { type: 'stars', seed: deriveSeed(seed, 1), depth: 1.0, lock: false, params: {} },
      { type: 'ifn', seed: deriveSeed(seed, 3), depth: 0.12, lock: false, params: {} },
      ...extra,
    ],
  };
}

const SCENES = {
  /* Dark clumps eating an emission field, tails and rims pointing at the source */
  globules: (seed) => base(seed, [
    {
      type: 'emission',
      seed: deriveSeed(seed, 2),
      depth: 0.3,
      lock: false,
      params: { gain: 1.0, covLo: 0.3, covHi: 0.5, oiii: 0.45 },
    },
    { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 1.2 } },
    {
      type: 'globules',
      seed: deriveSeed(seed, 5),
      depth: 0.6,
      lock: false,
      params: { freq: 2.8, radius: 0.38, fill: 0.62, tau: 3.6, rimGain: 1.6 },
    },
  ]),

  /* One illuminated cloud: blue scatter, warm core, its own faint extinction */
  reflection: (seed) => {
    const r = jitter(seed, 8);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 1.0 } },
      {
        type: 'reflection',
        seed: deriveSeed(seed, 6),
        depth: 0.35,
        lock: false,
        params: { star: [0.28 + r.next() * 0.44, 0.35 + r.next() * 0.32], lum: 1.1 },
      },
    ]);
  },

  /* Veil-style arc sweeping the frame: the shell center sits offscreen on a
     random bearing, so rerolls curve left, right, up, and down alike */
  filaments: (seed, aspect = 1.7) => {
    const r = jitter(seed, 9);
    const th = r.next() * Math.PI * 2;
    const d = 0.55 + r.next() * 0.4;
    const rot = (r.next() - 0.5) * 1.2;
    const squash = 0.88 + r.next() * 0.22;
    /* The host aspect-scales center x, so the offset is pre-divided by the
       live aspect to keep the placement circular and the phase math exact. */
    const center = [0.5 + (d * Math.cos(th)) / aspect, 0.5 + d * Math.sin(th)];
    /* Bearing back at the frame, then into the shell's own rotated and squashed
       frame, which is where the shader measures phase from +X. */
    const a = th + Math.PI - rot;
    const local = Math.atan2(Math.sin(a) / squash, Math.cos(a));
    const dLocal = d * Math.hypot(Math.cos(a), Math.sin(a) / squash);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0 } },
      {
        type: 'filaments',
        seed: deriveSeed(seed, 7),
        depth: 0.25,
        lock: false,
        params: {
          center,
          rot,
          squash,
          radius: dLocal * (0.72 + r.next() * 0.56),
          thick: 0.055 + r.next() * 0.045,
          phase: local + (r.next() - 0.5) * 0.3,
          half: 0.75 + r.next() * 0.55,
          gain: 0.22 + r.next() * 0.1,
        },
      },
    ]);
  },
};

/* Everything at once, to prove the tau sum and the shared line RT co-exist */
SCENES.all = (seed, aspect) => {
  const scene = SCENES.globules(seed);
  scene.entities.push(
    ...SCENES.reflection(seed).entities.filter((e) => e.type === 'reflection'),
    ...SCENES.filaments(seed, aspect).entities.filter((e) => e.type === 'filaments'),
  );
  return scene;
};

export function demoScene(name, seed, aspect = 1.7) {
  return SCENES[name]?.(seed, aspect) ?? null;
}
