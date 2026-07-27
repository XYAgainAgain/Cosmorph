/* The homepage sky: one curated scene, expressed as the engine's entity
   array. Per-entity seeds derive from the master so a future reroll of one
   layer never disturbs the others. */

import { deriveSeed } from '/engine/core/rng.js';

/* 09281980 — Carl Sagan's Cosmos first episode aired Sept. 28th, 1980 :) */
export const HERO_SEED = 9281980;

export function heroScene(seed = HERO_SEED) {
  return {
    version: 1,
    seed,
    evolution: { rate: 1 },
    palette: 'hooNatural',
    exposure: 0.85,
    stretchK: 10,
    entities: [
      { type: 'stars', seed: deriveSeed(seed, 1), depth: 1.0, lock: false, params: {} },
      { type: 'emission', seed: deriveSeed(seed, 2), depth: 0.3, lock: false, params: {} },
      { type: 'ifn', seed: deriveSeed(seed, 3), depth: 0.12, lock: false, params: {} },
      { type: 'darkDust', seed: deriveSeed(seed, 4), depth: 0.55, lock: false, params: {} },
    ],
  };
}
