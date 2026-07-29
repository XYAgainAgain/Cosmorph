/* Demo scenes for the entity types the hero does not use. Reached only via
   ?demo=, loaded on demand, and deliberately separate from the hero config. */

import { createRng, deriveSeed } from '/engine/core/rng.js';

/* Framed positions (arc center, star) are params, not noise, so without this
   seed-driven jitter they would sit frozen across rerolls. Firmament gets dials. */
function jitter(seed, salt) {
  return createRng(deriveSeed(seed, salt));
}

/* `scale` is the shape frame's extent in sky units. A whole-frame v2 asset has to
   overhang the viewport with its feather margin offscreen, or the column ramps to
   zero inside the frame and reads as a soft seam down each edge. */
function frameScale(aspect, center, edgeFade, floor) {
  const span = 1 - 2 * edgeFade;
  const x = (2 * Math.max(center[0], 1 - center[0]) * aspect) / span;
  const y = (2 * Math.max(center[1], 1 - center[1])) / span;
  return Math.max(floor, x, y);
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

  /* V838-style light echo: one flash walking outward through a static dust
     cloud whose center is offset, so the rings read asymmetric, not concentric */
  echo: (seed) => {
    const r = jitter(seed, 20);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.8 } },
      {
        type: 'echo',
        seed: deriveSeed(seed, 30),
        depth: 0.4,
        lock: false,
        params: { src: [0.34 + r.next() * 0.32, 0.36 + r.next() * 0.28], lum: 0.6 },
      },
    ]);
  },

  /* Hubble's Variable Nebula: the apex lands out toward a corner and the cone
     aims back through the frame, so a reroll never opens it off-screen */
  shadowfan: (seed, aspect = 1.7) => {
    const r = jitter(seed, 21);
    const apex = [0.66 + r.next() * 0.26, 0.64 + r.next() * 0.24];
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.7 } },
      {
        type: 'shadowFan',
        seed: deriveSeed(seed, 31),
        depth: 0.42,
        lock: false,
        params: {
          apex,
          angle: Math.atan2(0.46 - apex[1], (0.46 - apex[0]) * aspect),
          len: 0.55 + r.next() * 0.25,
        },
      },
    ]);
  },

  /* Egg Nebula class: twin polar beams with the dust torus that hides the star,
     and the torus is the only extinction in the scene worth looking at */
  searchlight: (seed) => {
    const r = jitter(seed, 22);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.5 } },
      {
        type: 'searchlight',
        seed: deriveSeed(seed, 32),
        depth: 0.4,
        lock: false,
        /* Tighter and brighter than module defaults: those were tuned against
           the hero chain, and the demo's 0.85/10 grading reads them too dim. */
        params: {
          center: [0.36 + r.next() * 0.28, 0.36 + r.next() * 0.28],
          axis: r.next() * Math.PI,
          len: 0.45,
          lum: 0.9,
        },
      },
    ]);
  },

  /* Planetary nebula: limb-brightened nested shells, onion rings, and ansae */
  planetary: (seed) => {
    const r = jitter(seed, 23);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.6 } },
      {
        type: 'planetary',
        seed: deriveSeed(seed, 33),
        depth: 0.45,
        lock: false,
        params: {
          center: [0.34 + r.next() * 0.32, 0.34 + r.next() * 0.32],
          rot: r.next() * Math.PI,
          waist: 0.25 + r.next() * 0.4,
        },
      },
    ]);
  },

  /* Herbig-Haro jet: bipolar beam, drifting knot chain, offset shock strands */
  jets: (seed) => {
    const r = jitter(seed, 24);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.6 } },
      {
        type: 'jets',
        seed: deriveSeed(seed, 34),
        depth: 0.42,
        lock: false,
        params: {
          src: [0.36 + r.next() * 0.28, 0.34 + r.next() * 0.32],
          angle: (r.next() - 0.5) * Math.PI,
        },
      },
    ]);
  },

  /* Same module, runaway look: no beam and no counter cap, one leading paraboloid
     shock with a widening wake behind it */
  bowshock: (seed) => {
    const r = jitter(seed, 25);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.6 } },
      {
        type: 'jets',
        seed: deriveSeed(seed, 35),
        depth: 0.42,
        lock: false,
        params: {
          look: { beam: false, counter: false, wake: true },
          src: [0.3 + r.next() * 0.26, 0.32 + r.next() * 0.32],
          angle: (r.next() - 0.5) * 1.4,
          bowStand: 0.12,
          bowCurv: 14.0,
          bowSpan: 0.19,
          bowThick: 0.018,
          bowGain: 0.5,
          wakeGain: 0.14,
          leadOiii: 0.22,
        },
      },
    ]);
  },

  /* Wolf-Rayet bubble: an OIII shell nested inside the Hα one, bow-shocked
     along the motion axis, with the star that blew it sitting inside */
  wrbubble: (seed) => {
    const r = jitter(seed, 26);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.6 } },
      {
        type: 'wrbubble',
        seed: deriveSeed(seed, 36),
        depth: 0.42,
        lock: false,
        params: {
          center: [0.36 + r.next() * 0.28, 0.36 + r.next() * 0.28],
          axis: (r.next() - 0.5) * Math.PI,
          radius: 0.24 + r.next() * 0.08,
        },
      },
    ]);
  },

  /* Baked column-density asset: an authored dark shape eating an emission field,
     its boundary roughened by noise and its rim lit from an offscreen source */
  shape: (seed, aspect = 1.7) => {
    const r = jitter(seed, 27);
    const center = [0.5 + (r.next() - 0.5) * 0.14, 0.5 - (r.next() - 0.5) * 0.1];
    return base(seed, [
      {
        type: 'emission',
        seed: deriveSeed(seed, 2),
        depth: 0.3,
        lock: false,
        params: { gain: 1.1, covLo: 0.28, covHi: 0.5, oiii: 0.45 },
      },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.9 } },
      {
        type: 'shape',
        seed: deriveSeed(seed, 37),
        depth: 0.5,
        lock: false,
        params: {
          asset: 'assets/shapes/test-blob.json',
          center,
          scale: frameScale(aspect, center, 0.07, 1.9) + r.next() * 0.3,
          rot: (r.next() - 0.5) * 0.5,
        },
      },
    ]);
  },

  /* Barnard 33 as the reference photo frames it: the IC 434 emission wall
     behind the head, the molecular cloud banked below, NGC 2023 off the flank */
  horsehead: (seed, aspect = 1.7) => {
    const r = jitter(seed, 28);
    /* The head is the middle third of the baked frame, so 2.2 is what makes it
       fill the viewport; wider canvases take the frame-coverage figure instead. */
    const center = [0.5, 0.545];
    return base(seed, [
      {
        type: 'emission',
        seed: deriveSeed(seed, 2),
        depth: 0.3,
        lock: false,
        /* IC 434 is an Hα wall with almost no OIII, and the silhouette only
           reads if the field behind it stays bright across most of the frame.
           The high stria is the reference photo's vertical combing. */
        params: {
          gain: 1.5, covLo: 0.05, covHi: 0.34, contrast: 1.05,
          oiii: 0.2, sii: 0.14, mottle: 1.1,
          stria: 0.6, striaFreq: 26, striaAniso: 45,
        },
      },
      /* Thin: the shape asset now bakes its own cloud bank, and a second wisp
         layer at full strength just muddies it. */
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.35 } },
      {
        /* NGC 2023 keeps the corner opposite the horse from reading as bare sky */
        type: 'reflection',
        seed: deriveSeed(seed, 6),
        depth: 0.35,
        lock: false,
        params: { star: [0.17 + r.next() * 0.08, 0.74 + r.next() * 0.08], lum: 0.9 },
      },
      {
        type: 'shape',
        seed: deriveSeed(seed, 38),
        depth: 0.5,
        lock: false,
        params: {
          asset: 'assets/shapes/horsehead.json',
          center,
          scale: frameScale(aspect, center, 0.06, 2.2),
          rot: (r.next() - 0.5) * 0.1,
          /* Sigma Ori sits above and off the right edge, which is what puts the
             lit rim along the mane and the crown rather than the muzzle. */
          ionSrc: [1.18, 0.26], ionRadius: 1.15,
          rimGain: 4.2, rimW: 0.012, rimHalo: 0, rimFacing: 0.7, rimEps: 0.01,
          rimDens: 0.8,
          rimKnot: 0.85, rimKnotFreq: 26, rimJit: 0.03, rimOiii: 0.3, rimSii: 0.2,
          /* The photograph's own tau is near 1 because it is stretched, so 4 is
             what makes the skull opaque; the low veil and small core boost are
             what keep the mane and the bank transmitting through it. */
          tau: 4.0, density: 1.0, core: 0.18, veil: 0.5, edgeFade: 0.06,
          threshold: 0.12, softness: 0.2, erode: 0.22, freq: 7.0,
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

/* Two arcs and two lit clouds at once: the multi-instance proof. Each copy
   carries its own seed, params, and depth, so they part ways under parallax. */
SCENES.multi = (seed, aspect) => {
  const scene = SCENES.filaments(seed, aspect);
  const r = jitter(seed, 10);
  scene.entities.push(
    /* Depth override so the copies provably parallax apart, not just differ */
    {
      ...SCENES.filaments(deriveSeed(seed, 12), aspect).entities.find((e) => e.type === 'filaments'),
      depth: 0.18,
    },
    {
      type: 'reflection',
      seed: deriveSeed(seed, 14),
      depth: 0.35,
      lock: false,
      params: { star: [0.16 + r.next() * 0.24, 0.28 + r.next() * 0.4], lum: 1.05 },
    },
    {
      type: 'reflection',
      seed: deriveSeed(seed, 15),
      depth: 0.5,
      lock: false,
      params: { star: [0.58 + r.next() * 0.26, 0.3 + r.next() * 0.4], lum: 0.85 },
    },
  );
  return scene;
};

export function demoScene(name, seed, aspect = 1.7) {
  return SCENES[name]?.(seed, aspect) ?? null;
}
