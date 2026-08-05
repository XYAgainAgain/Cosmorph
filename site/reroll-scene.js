/* True reroll: a seed-deterministic scene generator. Composition, seeds, and
   params all roll, so every reroll points the telescope somewhere new. Runs
   through Firmament's createScene/buildEngineConfig, one sanitizer for all. */

import { createRng, deriveSeed } from '/engine/core/rng.js';
import { TYPE_BY_ID, getPath, setPath } from '/firmament/spec.js';
import { createScene, makeEntity, buildEngineConfig, normalizeOrder } from '/firmament/preset.js';

/* Engine-side instance ceiling for feature types the compositor multiplies */
const MULTI_MAX = 3;

/* Feature deck: [type, weight, maxInstances]. Weights are draw odds, not
   frequencies; the deck is drawn without replacement. */
const FEATURES = [
  ['galaxies', 2.2, 1],
  ['clusters', 1.0, MULTI_MAX],
  ['globules', 1.2, MULTI_MAX],
  ['filaments', 1.4, MULTI_MAX],
  ['reflection', 1.2, MULTI_MAX],
  ['echo', 0.7, 2],
  ['shadowFan', 0.7, 2],
  ['searchlight', 0.6, 2],
  ['planetary', 0.9, 2],
  ['jets', 0.9, 2],
  ['wrbubble', 0.9, 2],
  ['ionCloud', 0.8, 2],
  ['shape', 0.5, 1],
];

/* Numeric params drift ±delta of their full spec range around the default.
   Structural, gated, bool, enum, and link params never jitter here: gates and
   morphology flips are curated in character() instead, where the odds are chosen. */
function jitterParams(entity, rng, delta = 0.12) {
  const spec = TYPE_BY_ID[entity.type];
  for (const p of spec.params) {
    if (p.derived || p.structural || p.gate || p.kind === 'bool' || p.kind === 'enum' || p.kind === 'link') continue;
    const v = getPath(entity.params, p.key);
    if (typeof v !== 'number') continue;
    /* Colors drift half as far: a hue swing reads as a palette break */
    const d = p.key.includes('.') ? delta * 0.5 : delta;
    let j = v + (rng.next() * 2 - 1) * (p.max - p.min) * d;
    /* Whole-number dials (arm count, member cells) must stay on their grid; a
       fractional arm count blends two harmonics and reads as a smeared spiral. */
    if (p.step >= 1) j = Math.round(j / p.step) * p.step;
    setPath(entity.params, p.key, Math.min(Math.max(j, p.min), p.max));
  }
}

/* Curated structural rolls: the dials generic jitter must not touch, with
   odds tuned for variety over chaos. */
function character(entity, rng) {
  const P = entity.params;
  switch (entity.type) {
    case 'galaxies': {
      const morph = rng.next();
      if (morph < 0.08) P.look = { ...P.look, ring: 1 };
      else if (morph < 0.16) P.look = { ...P.look, shell: 1 };
      else if (morph < 0.2) P.look = { ...P.look, ring: 1, polar: 1 };
      if (rng.next() < 0.35) P.barAmt = 0.3 + rng.next() * 0.4;
      if (rng.next() < 0.5) P.laneWob = 0.2 + rng.next() * 0.5;
      if (rng.next() < 0.3) P.spurAmt = 0.1 + rng.next() * 0.25;
      if (rng.next() < 0.25) P.starsN = 6000 + Math.floor(rng.next() * 8000);
      P.center = [0.3 + rng.next() * 0.4, 0.3 + rng.next() * 0.4];
      P.size = 0.14 + rng.next() * 0.3;
      break;
    }
    case 'darkDust':
      /* Marched slabs are the expensive kind; most rolls keep the flat wisp */
      if (rng.next() < 0.35) P.march = 1;
      break;
    case 'jets': {
      const look = { beam: 1, bow: rng.next() < 0.5 ? 1 : 0, counter: rng.next() < 0.4 ? 1 : 0, wake: 0 };
      if (rng.next() < 0.25) { look.beam = 0; look.wake = 1; }
      P.look = look;
      break;
    }
    case 'starcloud':
      if (rng.next() < 0.5) P.riftTau = 0;
      break;
    default:
      break;
  }
}

function weightedDraw(rng, deck) {
  const total = deck.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < deck.length; i++) {
    roll -= deck[i][1];
    if (roll <= 0) return deck.splice(i, 1)[0];
  }
  return deck.pop();
}

export function rerollScene(seed) {
  const rng = createRng(deriveSeed(seed, 777));
  const scene = createScene(seed);

  const entities = [];
  let salt = 0;
  const spawn = (type, k) => {
    /* Unique per-instance seed stream: type salt crossed with draw order */
    const spec = TYPE_BY_ID[type];
    const e = makeEntity(type, seed, deriveSeed(seed, spec.salt * 1000 + salt * 17 + k));
    salt += 1;
    jitterParams(e, rng);
    character(e, rng);
    return e;
  };

  /* Base sky: stars always; each backdrop layer rolls its own presence */
  entities.push(spawn('stars', 0));
  if (rng.next() < 0.8) entities.push(spawn('emission', 0));
  if (rng.next() < 0.7) entities.push(spawn('ifn', 0));
  if (rng.next() < 0.65) entities.push(spawn('darkDust', 0));
  if (rng.next() < 0.3) entities.push(spawn('starcloud', 0));

  /* Feature draw: 1-4 distinct types, each 1-3 instances, capped for cost */
  const deck = FEATURES.map((f) => [...f]);
  const typeCount = 1 + Math.floor(rng.next() * 4);
  let budget = 6;
  for (let t = 0; t < typeCount && budget > 0; t++) {
    const [type, , maxN] = weightedDraw(rng, deck);
    const nRoll = rng.next();
    let n = nRoll < 0.6 ? 1 : nRoll < 0.9 ? 2 : 3;
    n = Math.min(n, maxN, budget);
    for (let k = 0; k < n; k++) {
      const e = spawn(type, k + 1);
      /* Copies spread across the frame and depth or they stack into one blob */
      if (e.params.center) {
        e.params.center = [0.15 + rng.next() * 0.7, 0.15 + rng.next() * 0.7];
      }
      e.depth = Math.min(0.96, Math.max(0.02, e.depth + (rng.next() - 0.5) * 0.2 + k * 0.07));
      entities.push(e);
      budget -= 1;
    }
  }

  scene.entities = entities;
  normalizeOrder(scene.entities);

  /* Scene dressing: palette, grading, and the occasional foreground lens */
  const pal = rng.next();
  scene.palette = pal < 0.6 ? 'hooNatural' : pal < 0.8 ? 'hooBold' : pal < 0.92 ? 'sho' : 'cfht';
  scene.grading.exposure = 0.75 + rng.next() * 0.3;
  scene.grading.stretchK = 8 + rng.next() * 4;
  if (rng.next() < 0.12) {
    scene.grading.lens = 1;
    scene.grading.lensThetaE = 0.008 + rng.next() * 0.02;
    scene.grading.lensX = 0.3 + rng.next() * 0.4;
    scene.grading.lensY = 0.3 + rng.next() * 0.4;
    scene.grading.lensMag = 0.3 + rng.next() * 0.3;
  }

  return buildEngineConfig(scene);
}
