/* .cosmos preset model: the studio's scene state, its JSON form, and the
   translation into an engine config for sky2d.js. */

import { deriveSeed } from '/engine/core/rng.js';
import {
  TYPE_BY_ID, BASE_TYPES, SCENE_PARAMS, CAMERA_RANGE,
  defaultParams, getPath, setPath,
} from './spec.js';

export const SCHEMA_VERSION = 1;
export const FORMAT = 'cosmos';

/* Carl Sagan's Cosmos premiered 1980-09-28; the curated homepage seed */
export const DEFAULT_SEED = 9281980;

const MAX_SEED = 0x7FFFFFFF;

export const randomSeed = () => Math.floor(Math.random() * MAX_SEED);

function gradingDefaults() {
  const out = {};
  for (const param of SCENE_PARAMS) out[param.key] = param.def;
  return out;
}

export function makeEntity(type, rootSeed, seed = null) {
  const spec = TYPE_BY_ID[type];
  return {
    type,
    seed: seed ?? deriveSeed(rootSeed, spec.salt),
    depth: spec.depth ?? 0,
    order: spec.rank,
    lock: false,
    hidden: false,
    params: defaultParams(type),
  };
}

/* The homepage scene, which is also the studio's starting point */
export function createScene(seed = DEFAULT_SEED) {
  return {
    name: 'Untitled Sky',
    seed,
    palette: 'hooNatural',
    evolutionRate: 1,
    camera: { x: 0, y: 0 },
    grading: { ...gradingDefaults(), exposure: 0.85, stretchK: 10 },
    entities: BASE_TYPES.map((type) => makeEntity(type, seed)),
  };
}

export function effectiveParams(entity) {
  const spec = TYPE_BY_ID[entity.type];
  return entity.hidden ? { ...entity.params, ...spec.mute } : entity.params;
}

/* Bools live as 0/1 in the UI but sky2d tests `cometary !== false`, so a
   numeric 0 would read as true. Convert on the way out, not in the state; the
   clone is deep so a nested flag bag (the jet's `look`) is never written back. */
function engineParams(entity) {
  const spec = TYPE_BY_ID[entity.type];
  const src = effectiveParams(entity);
  const out = structuredClone(src);
  for (const param of spec.params) {
    if (param.kind === 'bool') setPath(out, param.key, !!getPath(src, param.key));
  }
  return out;
}

export function buildEngineConfig(scene) {
  const listed = new Set(scene.entities.map((e) => e.type));
  const entities = scene.entities.map((e) => ({
    type: e.type,
    seed: e.seed,
    depth: e.depth,
    lock: e.lock,
    params: engineParams(e),
  }));

  /* sky2d always evaluates the four base layers. A base type the user removed
     therefore has to be present and muted, or it would keep rendering. */
  for (const type of BASE_TYPES) {
    if (listed.has(type)) continue;
    const ghost = makeEntity(type, scene.seed);
    ghost.hidden = true;
    entities.push({
      type, seed: ghost.seed, depth: ghost.depth, lock: false, params: engineParams(ghost),
    });
  }

  return {
    version: 1,
    seed: scene.seed,
    evolution: { rate: scene.evolutionRate },
    camera: { x: scene.camera.x, y: scene.camera.y },
    palette: scene.palette,
    scnr: scene.grading.scnr,
    exposure: scene.grading.exposure,
    stretchK: scene.grading.stretchK,
    entities,
  };
}

export function serialize(scene, savedT = 0) {
  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    name: scene.name,
    seed: scene.seed,
    palette: scene.palette,
    grading: { ...scene.grading },
    evolution: { rate: scene.evolutionRate, savedT },
    camera: { x: scene.camera.x, y: scene.camera.y },
    entities: scene.entities.map((e) => ({
      type: e.type,
      seed: e.seed,
      depth: e.depth,
      order: e.order,
      lock: e.lock,
      hidden: e.hidden,
      params: structuredClone(e.params),
    })),
  };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/* Every loaded param is re-derived from the spec, so an old or hand-edited
   file can never smuggle an out-of-range value or a stale key into a uniform. */
function sanitizeParams(type, raw) {
  const out = defaultParams(type);
  if (!raw || typeof raw !== 'object') return out;
  for (const param of TYPE_BY_ID[type].params) {
    if (param.derived) continue;
    const value = getPath(raw, param.key);
    if (value === undefined || value === null) continue;
    if (param.kind === 'bool') {
      setPath(out, param.key, value === true || value === 1 ? 1 : 0);
      continue;
    }
    /* An enum's value is an id, not a number: an unlisted one (a renamed asset,
       a hand-edited file) falls back to the default rather than reaching fetch. */
    if (param.kind === 'enum') {
      if (param.options.some((o) => o.id === value)) setPath(out, param.key, value);
      continue;
    }
    const n = Number(value);
    if (Number.isFinite(n)) setPath(out, param.key, clamp(n, param.min, param.max));
  }
  return out;
}

const PALETTES = new Set(['hooNatural', 'hooBold', 'sho', 'cfht']);

export function deserialize(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object') throw new Error('Not a .cosmos preset.');
  if (raw.format !== FORMAT) throw new Error('Missing "cosmos" format marker.');

  const version = num(raw.schemaVersion, 0);
  if (version > SCHEMA_VERSION) {
    warnings.push(`Preset is schema v${version}; this build reads v${SCHEMA_VERSION}. Unknown fields were dropped.`);
  }

  const seed = Math.abs(Math.trunc(num(raw.seed, DEFAULT_SEED))) % MAX_SEED;
  const scene = createScene(seed);
  scene.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'Untitled Sky';
  scene.palette = PALETTES.has(raw.palette) ? raw.palette : 'hooNatural';
  scene.evolutionRate = clamp(num(raw.evolution?.rate, 1), 0, 100);
  scene.camera = {
    x: clamp(num(raw.camera?.x, 0), -CAMERA_RANGE, CAMERA_RANGE),
    y: clamp(num(raw.camera?.y, 0), -CAMERA_RANGE, CAMERA_RANGE),
  };

  for (const param of SCENE_PARAMS) {
    scene.grading[param.key] = clamp(num(raw.grading?.[param.key], param.def), param.min, param.max);
  }

  if (Array.isArray(raw.entities)) {
    const seen = new Set();
    const entities = [];
    for (const item of raw.entities) {
      const type = item?.type;
      if (!TYPE_BY_ID[type]) {
        if (type) warnings.push(`Unknown entity type "${type}" was skipped.`);
        continue;
      }
      /* Firmament's entity list is type-keyed; the engine now multiplies
         globules/reflection/filaments, so the studio is the constraint here. */
      if (seen.has(type)) {
        warnings.push(`Duplicate "${type}" entity was dropped (the studio edits one per type).`);
        continue;
      }
      seen.add(type);
      const spec = TYPE_BY_ID[type];
      entities.push({
        type,
        seed: Math.abs(Math.trunc(num(item.seed, deriveSeed(seed, spec.salt)))) % MAX_SEED,
        depth: clamp(num(item.depth, spec.depth ?? 0), 0, spec.depthParam?.max ?? 1),
        order: Math.trunc(num(item.order, spec.rank)),
        lock: item.lock === true,
        hidden: item.hidden === true,
        params: sanitizeParams(type, item.params),
      });
    }
    if (entities.length) {
      scene.entities = entities;
      /* Hand-edited or duplicate order values would make the list order
         ambiguous, so it is renumbered rather than trusted. */
      normalizeOrder(scene.entities);
    } else {
      warnings.push('Preset listed no usable entities; the default scene was kept.');
    }
  }

  const savedT = clamp(num(raw.evolution?.savedT, 0), 0, 4096 * 3600);
  return { scene, savedT, warnings };
}

/* List order is depth order: top is farthest. Stars is pinned first whatever
   its stored order, because its tier has no depth uniform to rank. */
export function sortEntities(entities) {
  const rank = (e) => (TYPE_BY_ID[e.type].pinned ? -1e9 : e.order);
  return [...entities].sort((a, b) => {
    const d = rank(a) - rank(b);
    return d || TYPE_BY_ID[a.type].rank - TYPE_BY_ID[b.type].rank;
  });
}

/* Smallest gap the Expert depth dial is allowed to leave between two ranks.
   One step: below this the dial has no range left to move in. */
export const DEPTH_GAP = 0.01;

/* Redistributes depth to match the visible order, so a drag permutes the
   user's tuned spread instead of inventing new numbers; order always wins over depth. */
export function normalizeOrder(entities) {
  const sorted = sortEntities(entities);
  const movable = sorted.filter((e) => !TYPE_BY_ID[e.type].pinned);
  const depths = movable.map((e) => e.depth).sort((a, b) => a - b);
  sorted.forEach((e, i) => { e.order = i; });

  let floor = 0;
  movable.forEach((e, i) => {
    const max = TYPE_BY_ID[e.type].depthParam?.max ?? 1;
    e.depth = clamp(Math.max(depths[i], floor + DEPTH_GAP), 0, max);
    floor = e.depth;
  });
  /* A depth-capped type mid-list can collapse onto its successors after the
     ascending pass; the backward pass reopens the gaps so order never lies. */
  for (let i = movable.length - 2; i >= 0; i--) {
    movable[i].depth = Math.max(Math.min(movable[i].depth, movable[i + 1].depth - DEPTH_GAP), 0);
  }
  return sorted;
}

/* Drops one entity at a list index and re-derives depth. Returns false when the
   move is blocked or a no-op, so the caller can skip a pointless repaint. */
export function placeEntity(entities, type, index) {
  if (TYPE_BY_ID[type].pinned) return false;
  const sorted = sortEntities(entities);
  const from = sorted.findIndex((e) => e.type === type);
  if (from < 0) return false;
  /* Pinned rows hold the head of the list, so nothing may land above them */
  const first = sorted.findIndex((e) => !TYPE_BY_ID[e.type].pinned);
  const to = Math.min(Math.max(index, first), sorted.length - 1);
  if (to === from) return false;
  sorted.splice(to, 0, sorted.splice(from, 1)[0]);
  sorted.forEach((e, i) => { e.order = i; });
  normalizeOrder(entities);
  return true;
}

export function moveEntity(entities, type, delta) {
  const at = sortEntities(entities).findIndex((e) => e.type === type);
  return at >= 0 && placeEntity(entities, type, at + delta);
}
