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
      params: { covLo: 0.3, covHi: 0.5 },
    },
    { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: {} },
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
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: {} },
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
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: {} },
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
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: {} },
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
          /* Pinned: test-blob's suggested tau (13.6) saturates the blob into
             the black-sticker look this demo disproves. */
          tau: 3.4,
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
          /* Just under the bake's own suggestion (3.71): the skull still reads
             opaque, and the low veil is what lets the mane and bank transmit. */
          tau: 3.1, density: 1.0, core: 0.18, veil: 0.42, edgeFade: 0.06,
          threshold: 0.12, softness: 0.2, erode: 0.28, freq: 7.0,
        },
      },
    ]);
  },
  /* HH 901/902 rising out of the Carina murk. The bake's interior column is
     near zero (the crag is rim-lit, not extinct), so `core` carries the body. */
  mystic: (seed, aspect = 1.7) => {
    const r = jitter(seed, 40);
    const center = [0.55, 0.66];
    const scene = base(seed, [
      {
        type: 'emission',
        seed: deriveSeed(seed, 2),
        depth: 0.3,
        lock: false,
        /* Emission is always Hα-anchored, so the teal-and-gold Carina look only
           exists under SHO, where Hα lands in green and SII carries the gold. */
        params: {
          gain: 0.9, covLo: 0.16, covHi: 0.52, contrast: 1.15,
          oiii: 0.75, sii: 0.3, mottle: 1.35, freq: 1.5,
          stria: 0.3, striaFreq: 12, striaAniso: 20,
          ionSrc: [0.5, -0.15], ionRadius: 1.3, hotLo: 0.35, hotHi: 0.85,
        },
      },
      {
        /* Soft and low: at the module's default hardness the lanes punch black
           holes in the wall instead of reading as murk in front of it. */
        type: 'darkDust',
        seed: deriveSeed(seed, 4),
        depth: 0.55,
        lock: false,
        params: { tau: 0.5, freq: 3.4, softness: 0.3 },
      },
      {
        type: 'shape',
        seed: deriveSeed(seed, 60),
        depth: 0.5,
        lock: false,
        params: {
          asset: 'assets/shapes/mystic-mountain.json',
          center,
          scale: frameScale(aspect, center, 0.06, 2.1),
          rot: (r.next() - 0.5) * 0.08,
          /* The cluster sits off the top of the frame, which is what lights the
             crown of every spire and leaves the flanks in shadow. */
          ionSrc: [0.46, -0.22], ionRadius: 1.2,
          rimGain: 1.2, rimW: 0.01, rimHalo: 0, rimFacing: 0.65, rimEps: 0.01,
          rimDens: 0.75, rimKnot: 0.6, rimKnotFreq: 30, rimJit: 0.012,
          /* SII is the red row under SHO, so a SII-heavy rim is the gold one */
          rimOiii: 0.15, rimSii: 1.3,
          /* An emission-mode bake defaults to glow 0.9, which lights the column
             across the whole frame; the crag is the dark one, so it stays off. */
          glow: 0,
          /* The v3 bake fills its own interior, so density and core came back
             down: at 2.1 the column clipped frame-wide and ate the whole sky. */
          tau: 1.9, density: 0.8, core: 0.6, veil: 0.5, edgeFade: 0.06,
          threshold: 0.16, softness: 0.24, erode: 0.2, freq: 8.5, eroFreq: 30,
        },
      },
    ]);
    scene.palette = 'sho';
    scene.exposure = 0.78;
    return scene;
  },

  /* NGC 7635: the traced polygon is only the western crescent, but the baked
     column carries the whole shell, so density draws the ring and the rim stays
     quiet. Cyan bubble against the gold Sharpless wall. */
  bubble: (seed) => {
    const r = jitter(seed, 41);
    const scene = base(seed, [
      {
        type: 'emission',
        seed: deriveSeed(seed, 2),
        depth: 0.3,
        lock: false,
        params: {
          gain: 1.1, covLo: 0.34, covHi: 0.58, contrast: 1.35,
          oiii: 0.38, sii: 0.14, mottle: 1.2, freq: 1.5,
          ionSrc: [0.2, 0.2], ionRadius: 1.0, hotLo: 0.2, hotHi: 0.7,
        },
      },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 1.1, freq: 3.0 } },
      {
        type: 'shape',
        seed: deriveSeed(seed, 61),
        depth: 0.5,
        lock: false,
        /* Fixed scale, not frameScale: the shell is a compact object on open
           sky, so filling the viewport would crop it into a wall. */
        params: {
          asset: 'assets/shapes/bubble.json',
          center: [0.47, 0.42],
          scale: 1.3,
          rot: (r.next() - 0.5) * 0.12,
          /* Near zero, or the envelope fills the crescent solid and the ring
             the G channel is carrying disappears under it. */
          core: 0.05,
          tau: 0.45, density: 1.0, veil: 0.65, edgeFade: 0.05,
          /* Fine over broad: the shell's filaments are the detail, and the
             tighter cells also break up the traced crescent's vertex stair. */
          threshold: 0.24, softness: 0.14, erode: 0.28, freq: 16.0, eroFreq: 26,
          /* Short falloff and a sub-unity glow: the crescent is a limb, so a
             long one fills it into a disc and clips the shell to white. */
          glow: 0.85, glowFall: 0.06, oiii: 1.5, sii: 0.1,
          ionSrc: [0.42, 0.35], ionRadius: 0.7,
          rimGain: 0.55, rimW: 0.02, rimOiii: 0.9, rimKnotFreq: 28,
        },
      },
    ]);
    scene.exposure = 0.9;
    scene.stretchK = 11;
    return scene;
  },

  /* M1 on near-empty sky. The outline is a lumpy oval; the lacework in the
     column channel is the whole show, so two filament arcs ride inside it. */
  crab: (seed) => {
    const r = jitter(seed, 42);
    const scene = base(seed, [
      {
        type: 'emission',
        seed: deriveSeed(seed, 2),
        depth: 0.3,
        lock: false,
        params: {
          gain: 0.3, covLo: 0.64, covHi: 0.8, contrast: 1.5,
          oiii: 0.2, sii: 0.3, mottle: 1.1, freq: 1.6,
        },
      },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.4 } },
      {
        type: 'shape',
        seed: deriveSeed(seed, 62),
        depth: 0.5,
        lock: false,
        params: {
          asset: 'assets/shapes/crab.json',
          center: [0.5, 0.5],
          scale: 1.05,
          rot: (r.next() - 0.5) * 0.14,
          core: 0.05,
          /* A long glow falloff so the remnant lights all the way through
             rather than skinning its own boundary. */
          tau: 0.5, glow: 0.55, glowFall: 0.5, oiii: 0.52, sii: 0.12,
          density: 1.4, veil: 0.6, edgeFade: 0.05,
          threshold: 0.16, softness: 0.3, erode: 0.28, freq: 10.0, eroFreq: 24,
          ionSrc: [0.5, 0.5], ionRadius: 0.6,
          rimGain: 0.8, rimW: 0.03, rimOiii: 0.3, rimSii: 0.2, rimKnotFreq: 20,
        },
      },
      {
        type: 'filaments',
        seed: deriveSeed(seed, 50),
        depth: 0.24,
        lock: false,
        params: {
          center: [0.5, 0.5], rot: r.next() * Math.PI, squash: 0.9,
          radius: 0.33, thick: 0.055, phase: r.next() * Math.PI * 2, half: 1.8,
          /* OIII over Hα is the only way to get the teal threads: the shape's
             own body is Hα-anchored and can never run cooler than orange. */
          freq: 15, lace: 0.6, gain: 0.26, ha: 0.45, oiii: 1.0, sii: 0.9,
        },
      },
      {
        type: 'filaments',
        seed: deriveSeed(seed, 51),
        depth: 0.26,
        lock: false,
        params: {
          center: [0.5, 0.5], rot: r.next() * Math.PI, squash: 1.08,
          radius: 0.22, thick: 0.045, phase: r.next() * Math.PI * 2, half: 1.9,
          freq: 19, lace: 0.7, gain: 0.2, ha: 0.4, oiii: 1.05, sii: 1.0,
        },
      },
    ]);
    scene.palette = 'cfht';
    scene.exposure = 0.95;
    scene.stretchK = 12;
    return scene;
  },

  /* The 2014 HST frame: three risers climbing out of the bottom against a
     blue-green wall, the ionizing cluster off the top edge. */
  pillars: (seed, aspect = 1.7) => {
    const r = jitter(seed, 43);
    const center = [0.54, 0.55];
    const scene = base(seed, [
      {
        type: 'emission',
        seed: deriveSeed(seed, 2),
        depth: 0.3,
        lock: false,
        /* Wide coverage and a high ionizing source: the silhouettes only read
           if the wall stays lit across the frame and cools toward the base. */
        params: {
          gain: 1.2, covLo: 0.08, covHi: 0.34, contrast: 1.05,
          oiii: 0.8, sii: 0.16, mottle: 1.0, freq: 1.2,
          stria: 0.25, striaFreq: 10, striaAniso: 24,
          ionSrc: [0.72, -0.1], ionRadius: 1.4, hotLo: 0.3, hotHi: 0.9,
        },
      },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.4 } },
      {
        type: 'shape',
        seed: deriveSeed(seed, 63),
        depth: 0.5,
        lock: false,
        params: {
          asset: 'assets/shapes/pillars.json',
          center,
          scale: frameScale(aspect, center, 0.05, 2.0),
          rot: (r.next() - 0.5) * 0.06,
          ionSrc: [0.42, -0.25], ionRadius: 1.25,
          rimGain: 2.4, rimW: 0.018, rimHalo: 0, rimFacing: 0.7, rimEps: 0.01,
          rimDens: 0.8, rimKnot: 0.85, rimKnotFreq: 24, rimJit: 0.03,
          rimOiii: 0.2, rimSii: 1.1,
          /* Well under the bake's 4.57: at the honest figure the columns go
             flat black and the photo's brown-tan interior never shows. */
          tau: 2.3, density: 1.1, core: 0.22, veil: 0.5, edgeFade: 0.05,
          threshold: 0.14, softness: 0.2, erode: 0.24, freq: 9.5, eroFreq: 32,
        },
      },
    ]);
    /* Same palette as `mystic` because SHO is the only one that puts a
       blue-green wall behind a dark silhouette; the line mix differs. */
    scene.palette = 'sho';
    scene.exposure = 0.82;
    return scene;
  },

  /* The MIRI view of the same pillars: deep orange field up top, the splayed
     claw crossing it diagonally as grey-blue glowing towers, dark below. */
  pillarsMiri: (seed, aspect = 1.7) => {
    const r = jitter(seed, 44);
    const center = [0.5, 0.5];
    const scene = base(seed, [
      {
        type: 'emission',
        seed: deriveSeed(seed, 2),
        depth: 0.3,
        lock: false,
        params: {
          /* A tight ionizing radius up top is what makes the field fall away
             into the dark lower half; nebula.js scales emission by 1/(r²+1). */
          gain: 1.15, covLo: 0.14, covHi: 0.46, contrast: 1.35,
          oiii: 0.12, sii: 0.1, mottle: 1.25, freq: 1.4,
          ionSrc: [0.38, 0.02], ionRadius: 0.68, hotLo: 0.6, hotHi: 0.95,
        },
      },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.9, freq: 2.6 } },
      {
        type: 'shape',
        seed: deriveSeed(seed, 64),
        depth: 0.5,
        lock: false,
        /* High OIII on the body is what turns the towers grey-blue against the
           Hα field under the bold palette; the silhouette carries the rest. */
        params: {
          asset: 'assets/shapes/pillars-miri.json',
          center,
          scale: frameScale(aspect, center, 0.05, 1.95),
          rot: (r.next() - 0.5) * 0.06,
          core: 0.06,
          /* Under the old 0.38 the tower crowns clipped to flat white, which is
             what read as creamsicle rather than grey-blue dust. */
          tau: 0.55, glow: 0.26, glowFall: 0.09, oiii: 1.4, sii: 0.2,
          density: 1.2, veil: 0.55, edgeFade: 0.05,
          threshold: 0.24, softness: 0.2, erode: 0.2, freq: 14.0, eroFreq: 26,
          ionSrc: [0.4, 0.08], ionRadius: 1.0,
          rimGain: 0.7, rimW: 0.02, rimOiii: 0.9, rimKnotFreq: 20,
        },
      },
    ]);
    scene.palette = 'hooBold';
    scene.exposure = 0.85;
    scene.stretchK = 11;
    return scene;
  },

  /* M13 and the Jewel Box in one frame: a globular whose core fuses into a
     single glow, and a loose blue-white open cluster that never fuses at all. */
  clusters: (seed) => {
    const r = jitter(seed, 47);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.35 } },
      {
        type: 'clusters',
        seed: deriveSeed(seed, 65),
        depth: 0.2,
        lock: false,
        /* Wider than the module default: at tidal 0.13 the ball reads as a smudge
           rather than as the count of stars that is the whole point. */
        params: {
          center: [0.62 + r.next() * 0.16, 0.44 + r.next() * 0.16],
          core: 0.026, tidal: 0.2, haloR: 0.11, halo: 0.16,
          rot: r.next() * Math.PI, squash: 0.9 + r.next() * 0.12,
          lum: 2.2, resolve: 0.03, memGain: 2.2, rich: 1.2,
        },
      },
      {
        /* The Jewel Box: no fused core, a handful of bright blue members, and
           one warm supergiant carried by the second population. */
        type: 'clusters',
        seed: deriveSeed(seed, 66),
        depth: 0.24,
        lock: false,
        params: {
          center: [0.2 + r.next() * 0.14, 0.62 + r.next() * 0.14],
          core: 0.075, tidal: 0.2, squash: 0.78, rot: (r.next() - 0.5) * 1.4,
          /* Near-zero glow: an open cluster never fuses, so any core light at all
             reads as a smudge where the reference has nothing but points. */
          lum: 0.06, tint: [0.72, 0.8, 1.0], halo: 0.14, haloR: 0.13,
          cells: 60, rich: 0.7, memGain: 4.0, memFall: 0.8, memSize: 1.35,
          resolve: 0, memTint: [0.78, 0.85, 1.0], memTint2: [1.0, 0.72, 0.48],
          memMix: 0.05, clump: 0.65, clumpFreq: 26.0,
        },
      },
    ]);
  },

  /* The summer Milky Way: unresolved starlight as one broad continuum gradient,
     split lengthwise by the Great Rift's extinction. */
  starcloud: (seed) => {
    const r = jitter(seed, 48);
    const scene = base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.3 } },
      {
        type: 'starcloud',
        seed: deriveSeed(seed, 67),
        depth: 0.1,
        lock: false,
        /* Well over the module default, which is tuned for the hero's deeper
           stretch; at 0.02 this scene's 0.85/10 grading leaves it invisible. */
        params: {
          gain: 0.035, width: 0.2, wing: 0.12, patch: 0.7,
          riftCenter: 0.02 + r.next() * 0.05, riftW: 0.11,
          /* Under ~1.5 the lane keeps its carved interior; saturate it and every
             braid inside collapses into one flat black ribbon. */
          riftTau: 1.3, riftTh: 0.46, riftFreq: 6.5,
          riftWander: 0.12 + r.next() * 0.08,
        },
      },
    ]);
    /* The band rides the star field's own galactic plane, so the demo tilts that
       line rather than giving the layer a second, contradictory one. */
    const stars = scene.entities.find((e) => e.type === 'stars');
    if (stars) stars.params = { bandY: 0.52, bandTilt: -0.22, density: 0.85, count: 70 };
    /* Thinned: at full amplitude the IFN fills the off-band sky the band is
       supposed to be falling away into. */
    const ifn = scene.entities.find((e) => e.type === 'ifn');
    if (ifn) ifn.params = { amp: 0.3 };
    return scene;
  },

  /* M51/NGC 1300/NGC 2841: the default showpiece spiral, with the arm count,
     bar, lopsidedness, and star-cloud granulation all rolled off the seed */
  spiralgal: (seed) => {
    const r = jitter(seed, 45);
    const arms = 2 + Math.floor(r.next() * 3);
    /* A bar only reads on a fairly open spiral, so the two roll together */
    const barred = r.next() < 0.5;
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0 } },
      {
        type: 'galaxies',
        seed: deriveSeed(seed, 45),
        depth: 0.13,
        lock: false,
        params: {
          look: { shell: false, ring: false, spokes: false, polar: false },
          center: [0.42 + r.next() * 0.16, 0.4 + r.next() * 0.2],
          size: 0.26,
          cosI: 0.55 + r.next() * 0.4,
          pa: r.next() * Math.PI,
          gain: 0.9,
          wind: barred ? 2.2 + r.next() * 0.8 : 3.2 + r.next() * 1.6,
          armCount: arms + (r.next() < 0.4 ? r.next() * 0.6 : 0),
          armAsym: r.next() * 0.35,
          armAmt: 0.88,
          armSharp: 1.9,
          barAmt: barred ? 0.35 + r.next() * 0.35 : 0,
          barLen: 0.3 + r.next() * 0.2,
          bulgeAmt: 1.8,
          bulgeR: 0.13,
          diskFall: 2.8,
          laneDepth: 0.3,
          granBright: 0.6,
          granDark: 0.22,
          granFreq: 170 + r.next() * 90,
          hii: 0.38,
          flowerGain: 1.0,
          cutIn: 1.2,
          cutOut: 1.85,
          fieldLum: 0.02,
          fieldDensity: 0.07,
        },
      },
    ]);
  },

  /* M51 with the arms resolving: the spiral showpiece plus the density-wave
     sprite tier, stars strung along the arms and dimming behind the lane */
  resolved: (seed) => {
    const r = jitter(seed, 49);
    const scene = SCENES.spiralgal(seed);
    const gx = scene.entities.find((e) => e.type === 'galaxies');
    Object.assign(gx.params, {
      center: [0.44 + r.next() * 0.12, 0.42 + r.next() * 0.16],
      size: 0.32,
      /* M51 is nearly face-on, and face-on is where ellipse crowding reads as
         arms; the far-side extinction still gets enough tip to bite */
      cosI: 0.78 + r.next() * 0.1,
      armCount: 2,
      armAsym: 0.12 + r.next() * 0.15,
      barAmt: 0,
      wind: 3.4 + r.next() * 0.8,
      gain: 1.1,
      laneDepth: 0.3,
      hii: 0.45,
      flowerGain: 1.1,
      starsN: 12000,
      /* Under the tier default: the glow's gold bulge must stay the brightest
         thing in the frame, with the sprites reading as its resolved skin */
      starsGain: 0.34,
      /* Slimmer ellipses than the dial default: the demo's whole job is making
         the crowding caustics unmistakable. Pitch itself rides the link. */
      starsAxis: 0.58,
      starsBulgeFrac: 0.16,
      starsLaneTau: 1.6,
    });
    /* Thinned like the starcloud demo: full-amplitude IFN buries the disk */
    const ifn = scene.entities.find((e) => e.type === 'ifn');
    if (ifn) ifn.params = { amp: 0.3 };
    return scene;
  },

  /* NGC 3923/NGC 474: an r^1/4 elliptical wearing nested merger shells that
     fall on alternating sides as the shell index climbs */
  shellgal: (seed) => {
    const r = jitter(seed, 32);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0 } },
      {
        type: 'galaxies',
        seed: deriveSeed(seed, 40),
        depth: 0.13,
        lock: false,
        params: {
          look: { shell: true, ring: false, spokes: false, polar: false },
          center: [0.42 + r.next() * 0.16, 0.42 + r.next() * 0.16],
          size: 0.18,
          cosI: 0.74,
          pa: r.next() * Math.PI,
          gain: 0.9,
          bulgeAmt: 1.6,
          devRe: 1.0,
          /* The r^1/4 law is nearly all dynamic range; raising the floor is what
             turns the singular spike into a body you can actually see. */
          devFloor: 0.22,
          shellAmt: 0.5,
          shellFreq: 16.0 + r.next() * 8.0,
          shellPhase: r.next() * 6.2832,
          shellRot: (r.next() - 0.5) * 2.2,
          shellFall: 1.4,
          /* Shells run well past the body, so the fade has to open up or the
             outermost arcs are cut off mid-sweep */
          cutIn: 1.8,
          cutOut: 2.4,
          fieldLum: 0.02,
          fieldDensity: 0.07,
        },
      },
    ]);
  },

  /* Hoag's Object: a detached blue ring of hot young stars around a yellow
     nucleus, with real empty sky in the gap between them */
  hoag: (seed) => {
    const r = jitter(seed, 33);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0 } },
      {
        type: 'galaxies',
        seed: deriveSeed(seed, 41),
        depth: 0.13,
        lock: false,
        params: {
          look: { shell: false, ring: true, spokes: false, polar: false },
          center: [0.42 + r.next() * 0.18, 0.42 + r.next() * 0.16],
          size: 0.28,
          cosI: 0.9,
          pa: r.next() * Math.PI,
          gain: 0.55,
          bulgeAmt: 2.4,
          bulgeR: 0.09,
          ringR: 0.85,
          ringW: 0.055,
          ringAmt: 1.3,
          knotAmt: 0.7,
          knotFreq: 13.0 + r.next() * 7.0,
          hii: 0.4,
          /* The second Hoag-like ring inside the gap is a line-of-sight
             coincidence in the real object; here it is the field tier */
          fieldLum: 0.025,
          fieldDensity: 0.09,
        },
      },
    ]);
  },

  /* The Cartwheel: a bullseye collision drove a blue star-forming ring outward
     and left radial spokes bridging it back to the nucleus */
  cartwheel: (seed) => {
    const r = jitter(seed, 30);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0 } },
      {
        type: 'galaxies',
        seed: deriveSeed(seed, 43),
        depth: 0.13,
        lock: false,
        params: {
          look: { shell: false, ring: true, spokes: true, polar: false },
          center: [0.42 + r.next() * 0.18, 0.42 + r.next() * 0.16],
          size: 0.3,
          cosI: 0.78,
          pa: r.next() * Math.PI,
          gain: 0.5,
          bulgeAmt: 1.4,
          bulgeR: 0.11,
          ringR: 0.82,
          ringW: 0.075,
          ringAmt: 1.1,
          knotAmt: 0.75,
          knotFreq: 15.0 + r.next() * 8.0,
          hii: 0.45,
          spokeAmt: 0.28,
          spokeFreq: 6.0 + r.next() * 5.0,
          spokeIn: 0.18,
          fieldLum: 0.02,
          fieldDensity: 0.08,
        },
      },
    ]);
  },

  /* NGC 660: a second ring orbiting perpendicular to the host disk, so the pair
     reads as two galaxies crossed at right angles */
  polarring: (seed) => {
    const r = jitter(seed, 31);
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0 } },
      {
        type: 'galaxies',
        seed: deriveSeed(seed, 44),
        depth: 0.13,
        lock: false,
        params: {
          look: { shell: false, ring: true, spokes: false, polar: true },
          center: [0.42 + r.next() * 0.18, 0.42 + r.next() * 0.16],
          size: 0.26,
          cosI: 0.3,
          pa: (r.next() - 0.5) * 1.2,
          gain: 0.55,
          bulgeAmt: 2.0,
          bulgeR: 0.16,
          ringR: 0.72,
          ringW: 0.13,
          ringAmt: 0.9,
          knotAmt: 0.5,
          knotFreq: 9.0 + r.next() * 5.0,
          hii: 0.3,
          polarAmt: 1.0,
          polarR: 0.85,
          polarW: 0.11,
          polarCosI: 0.22,
          fieldLum: 0.02,
          fieldDensity: 0.08,
        },
      },
    ]);
  },

  /* HUDF/SMACS 0723: nothing but galaxies, clustered toward the center, with
     size, brightness, and color all falling off the redshift ramp */
  deepfield: (seed) => {
    const r = jitter(seed, 29);
    const scene = base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0 } },
      {
        type: 'galaxies',
        seed: deriveSeed(seed, 42),
        depth: 0.13,
        lock: false,
        params: {
          showpiece: false,
          fieldCells: 12.0,
          fieldDensity: 0.55,
          fieldRadius: 0.35,
          fieldFlat: 0.12,
          fieldCoreAmt: 2.2,
          fieldCoreFall: 7.0,
          fieldLum: 0.65,
          cluster: 0.8,
          clusterPeak: 5.0,
          clusterR: 0.3,
          clusterAt: [0.42 + r.next() * 0.16, 0.42 + r.next() * 0.16],
          zLo: 0.2,
          zHi: 3.5,
          /* Both exponents compound: at the far end they already cost a factor
             of three each, and any more buries the high-z end in the dither. */
          zSize: 0.8,
          zDim: 0.8,
          zTint: 0.9,
        },
      },
    ]);
    /* Only a handful of foreground stars: the spikes are what tells a star from
       a galaxy, and that asymmetry is the whole read of a deep field */
    const stars = scene.entities.find((e) => e.type === 'stars');
    if (stars) stars.params = { count: 22, density: 0.2, gain: 1.3, spikeThreshold: 0.2 };
    return scene;
  },

  /* Abell 370/SMACS 0723: the same deep field seen through a cluster lens
     parked on its own light concentration, which is where the mass would be.
     The arcs are the galaxy field read at β = θ − α, not anything drawn. */
  lensed: (seed) => {
    const r = jitter(seed, 35);
    const scene = SCENES.deepfield(seed);
    const gx = scene.entities.find((e) => e.type === 'galaxies');
    /* Denser and brighter than the plain deep field: an arc is one background
       galaxy stretched thin, so a sparse field lenses into empty sky. */
    if (gx) {
      Object.assign(gx.params, {
        fieldCells: 18.0, fieldDensity: 0.9, fieldLum: 0.9, cluster: 0.55, clusterR: 0.42,
      });
    }
    /* The IFN rides the same RT as the galaxies and lenses with them; a smooth
       field has no structure to stretch, so it only smears into a bruise. */
    const ifn = scene.entities.find((e) => e.type === 'ifn');
    if (ifn) ifn.params = { amp: 0 };
    scene.lensing = {
      on: true,
      halos: 2,
      /* Ring radius in sky units, where the frame is one unit tall. The core
         has to stay far below it or the deflection softens the arcs away. */
      thetaE: 0.185,
      core: 0.03,
      /* Copied, never aliased: sharing the array would let any later edit to the
         lens center silently drag the galaxy cluster along with it. */
      center: gx?.params.clusterAt?.slice() ?? [0.5, 0.5],
      ellip: 0.3,
      angle: r.next() * Math.PI,
      point: 0,
      shear1: 0.04 + r.next() * 0.06,
      shear2: r.next() * 0.05 - 0.025,
      haloStrength: 0.45,
      haloSpread: 0.3,
      magBoost: 0.6,
    };
    return scene;
  },

  /* Hanny's Voorwerp, composed from three entities: the showpiece spiral IC 2497,
     the quasar burning at its nucleus, and the ionized tidal-tail cloud below,
     lit only where the cone lands. One depth for all three, since they are one
     system and must not parallax apart. */
  voorwerp: (seed, aspect = 1.7) => {
    const r = jitter(seed, 34);
    const DEPTH = 0.13;
    /* Sky y grows downward, so the host sits above the cloud at the smaller y */
    const nucleus = [0.46 + r.next() * 0.16, 0.22 + r.next() * 0.06];
    const center = [0.34 + r.next() * 0.22, 0.66 + r.next() * 0.08];
    /* The apex trails the nucleus by the light-travel delay: the quasar moved
       while its light was in flight, so the cone misses its own source. */
    const lagBear = r.next() * Math.PI * 2;
    const apex = [nucleus[0] + Math.cos(lagBear) * 0.03, nucleus[1] + Math.sin(lagBear) * 0.05];
    /* Bearing is measured in sky units, since the host aspect-scales every x
       before it reaches the uniform. */
    const cone = Math.atan2(center[1] - apex[1], (center[0] - apex[0]) * aspect);
    const barred = r.next() < 0.35;
    return base(seed, [
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: { gain: 0 } },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: { tau: 0.18 } },
      {
        /* Every hue and arm key is written, because sky2d rolls a family and an
           arm count for whatever the scene leaves unset. */
        type: 'galaxies',
        seed: deriveSeed(seed, 46),
        depth: DEPTH,
        lock: false,
        params: {
          look: { shell: false, ring: false, spokes: false, polar: false },
          /* Copied, never aliased: the quasar shares this position, and a later
             edit to one entity's center must not drag the other along. */
          center: nucleus.slice(),
          size: 0.16 + r.next() * 0.03,
          cosI: 0.42 + r.next() * 0.2,
          pa: r.next() * Math.PI,
          gain: 1.0,
          wind: barred ? 2.4 + r.next() * 0.6 : 3.4 + r.next() * 1.2,
          armCount: 2 + Math.floor(r.next() * 2),
          armAsym: 0.1 + r.next() * 0.25,
          armAmt: 0.85,
          armSharp: 1.9,
          barAmt: barred ? 0.3 + r.next() * 0.3 : 0,
          barLen: 0.3 + r.next() * 0.16,
          bulgeAmt: 2.2,
          bulgeR: 0.14,
          diskFall: 2.6,
          laneDepth: 0.34,
          granBright: 0.55,
          granDark: 0.22,
          granFreq: 190 + r.next() * 70,
          hii: 0.42,
          flowerGain: 1.0,
          cutIn: 1.2,
          cutOut: 1.85,
          /* The mauve-and-pink cast of the real IC 2497 exposure */
          bulge: [1.0, 0.76, 0.6],
          disk: [0.8, 0.7, 0.86],
          flowerTint: [1.0, 0.18, 0.2],
          fieldLum: 0.02,
          fieldDensity: 0.07,
        },
      },
      {
        /* The quasar itself, so the scene shows its own cause: a compact
           illuminator at the nucleus, faint enough to stay a point. */
        type: 'reflection',
        seed: deriveSeed(seed, 6),
        depth: DEPTH,
        lock: false,
        params: {
          star: nucleus.slice(),
          lum: 0.35,
          radius: [0.024, 0.03, 0.04],
          warmAmt: 0.2,
          floor: 1,
          filAmp: 0,
          tau: 0,
        },
      },
      {
        type: 'ionCloud',
        seed: deriveSeed(seed, 39),
        depth: DEPTH,
        lock: false,
        params: {
          center: center.slice(),
          apex: apex.slice(),
          cone,
          rot: (r.next() - 0.5) * 1.4,
          size: 0.18 + r.next() * 0.05,
          /* Narrow enough that the cone edge cuts the cloud instead of washing
             over it: an unlit lobe is the whole point of the object. */
          half: 0.2 + r.next() * 0.1,
          holeR: 0.24 + r.next() * 0.12,
          litR: 0.4,
          fall: 1.2,
        },
      },
    ]);
  },
};

/* Everything at once, to prove the tau sum and the shared line RT co-exist */
SCENES.all = (seed, aspect) => {
  const scene = SCENES.globules(seed);
  /* The only scene that turns the IFN's character dials on; every other one,
     the hero included, leaves them at their neutral zero. */
  const ifn = scene.entities.find((e) => e.type === 'ifn');
  if (ifn) ifn.params = { swirl: 1.8, feather: 0.45, soft: 0.3, grain: 0.3 };
  /* Both continuum layers join at reduced amplitude: this is a co-existence
     proof, not a composition, and a full band flattens everything under it. */
  const band = SCENES.starcloud(seed).entities.find((e) => e.type === 'starcloud');
  band.params = { ...band.params, gain: 0.02, riftTau: 1.0 };
  const clu = SCENES.clusters(seed).entities.find((e) => e.type === 'clusters');
  /* Member gain is not an amplitude the way lum is: under pow(h2.x, 6) a low one
     resolves no members at all, which is the fused smudge this scene must avoid. */
  clu.params = { ...clu.params, lum: 1.1, memGain: 1.1 };
  scene.entities.push(
    ...SCENES.reflection(seed).entities.filter((e) => e.type === 'reflection'),
    ...SCENES.filaments(seed, aspect).entities.filter((e) => e.type === 'filaments'),
    band,
    clu,
  );
  return scene;
};

/* Marched Bok globules over an emission wall: the volumetric dust scaffold.
   `march: true` routes darkDust to the shared slab march instead of the wisp. */
SCENES.dust = (seed) => {
  const r = jitter(seed, 50);
  const ionSrc = [1.08, 0.16];
  const cx = 0.4 + r.next() * 0.2;
  const cy = 0.42 + r.next() * 0.16;
  return base(seed, [
    {
      type: 'emission',
      seed: deriveSeed(seed, 2),
      depth: 0.3,
      lock: false,
      params: { ionSrc, ionRadius: 0.9, covLo: 0.24, covHi: 0.44, gain: 0.5 },
    },
    {
      type: 'darkDust',
      seed: deriveSeed(seed, 51),
      depth: 0.58,
      lock: false,
      params: {
        march: true,
        ionSrc,
        center: [cx, cy],
        radius: 0.17,
        squash: 0.72 + r.next() * 0.2,
        rot: (r.next() - 0.5) * 1.4,
        tau: 5.0,
      },
    },
    {
      type: 'darkDust',
      seed: deriveSeed(seed, 52),
      depth: 0.5,
      lock: false,
      params: {
        march: true,
        ionSrc,
        center: [cx - 0.22 + r.next() * 0.08, cy + 0.18 + r.next() * 0.1],
        radius: 0.09,
        squash: 0.85,
        rot: (r.next() - 0.5) * 1.4,
        tau: 4.2,
        feather: 0.07,
      },
    },
  ]);
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
