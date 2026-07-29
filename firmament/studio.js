/* Firmament studio: panel state, controls, and the preset→uniform bridge.
   Slider drags poke uniforms; build-time values go through a debounced rebuild. */

import { createSkyHost } from './sky-host.js';
import {
  ENTITY_TYPES, TYPE_BY_ID, SCENE_PARAMS, PALETTE_OPTIONS, UI_THEMES, SPEED_STEPS,
  DEFAULT_THEME, CAMERA_RANGE, CAPTURE_SIZES, getPath, setPath, formatValue,
} from './spec.js';
import {
  createScene, buildEngineConfig, serialize, deserialize, sortEntities,
  makeEntity, randomSeed, effectiveParams, normalizeOrder, placeEntity, moveEntity,
  DEPTH_GAP, DEFAULT_SEED,
} from './preset.js';
import { deriveSeed } from '/engine/core/rng.js';

const STORE_PRESET = 'cosmorph:firmament:preset';
const STORE_UI = 'cosmorph:firmament:ui';
const REBUILD_MS = 180;
const VEIL_MS = 950;
const T_WRAP_H = 4096;

const params = new URLSearchParams(location.search);
const forceGL = params.get('gl') === '1';
const urlSeed = Number.parseInt(params.get('seed'), 10);

const el = (id) => document.getElementById(id);
const dom = {
  veil: el('veil'),
  stack: el('sky-stack'),
  panel: el('panel'),
  body: el('panel-body'),
  panelOpen: el('panel-open'),
  panelClose: el('panel-close'),
  tier: el('tier'),
  name: el('preset-name'),
  dirty: el('dirty-dot'),
  seed: el('master-seed'),
  palette: el('palette'),
  theme: el('ui-theme'),
  sceneParams: el('scene-params'),
  list: el('entity-list'),
  adders: el('entity-adders'),
  camBlock: el('camera-block'),
  camPad: el('cam-pad'),
  camPuck: el('cam-puck'),
  camRead: el('cam-read'),
  camCenter: el('cam-center'),
  detail: el('entity-detail'),
  heading: el('entity-heading'),
  credits: el('credits-block'),
  creditsList: el('credits-list'),
  scrub: el('scrub'),
  tread: el('t-readout'),
  speed: el('speed'),
  play: el('play'),
  playIcon: el('play-icon'),
  reroll: el('reroll'),
  filing: el('filing'),
  dirtyFiling: el('dirty-filing'),
  shotSize: el('shot-size'),
  status: el('status'),
  file: el('import-file'),
};

const ui = {
  tier: 1,
  theme: DEFAULT_THEME,
  collapsed: false,
  selected: 'emission',
  openGroups: new Set(),
  scrubMax: 168,
  scrubBusy: false,
  filingOpen: false,
  shotSize: 'window',
  camOpen: true,
  creditsOpen: false,
  dirty: false,
  busy: false,
};

let scene = createScene(Number.isFinite(urlSeed) ? urlSeed : DEFAULT_SEED);
let paletteRows = null;
let rebuildTimer = 0;
let rebuildPending = false;
let dragType = null;

const host = createSkyHost({ mount: dom.stack, forceGL });

/* State to uniforms */

function uniformCtx(entity) {
  return {
    aspect: host.uniforms?.uAspect.value ?? 1,
    params: effectiveParams(entity),
  };
}

function applyParam(U, param, value, ctx) {
  if (param.structural) return;
  if (param.set) { param.set(U, value, ctx); return; }
  const slot = U[param.u];
  /* Gated entity types contribute no uniforms when absent from the build */
  if (!slot) return;
  if (param.comp) slot.value[param.comp] = value;
  else slot.value = value;
}

function applyPalette(U) {
  if (!paletteRows) return;
  const rows = paletteRows[scene.palette] ?? paletteRows.hooNatural;
  U.uPalette.value.set(...rows);
}

/* Runs after every build and every resize: resize() re-seats aspect-scaled
   framed positions from the build-time params, which would drop live edits. */
function applyAll(sky) {
  const U = sky?.uniforms;
  if (!U) return;
  applyPalette(U);
  for (const param of SCENE_PARAMS) applyParam(U, param, scene.grading[param.key], {});
  for (const entity of scene.entities) {
    const spec = TYPE_BY_ID[entity.type];
    /* A build still in flight when the scene gained an entity has no uniforms
       for it; the rebuild it queued behind will seat them. A permanent skip
       here means a typo'd depthParam.u, hence the warn. */
    if (spec.depthParam && !U[spec.depthParam.u]) {
      console.warn(`Firmament: no ${spec.depthParam.u} in this build; "${entity.type}" edits deferred to the rebuild.`);
      continue;
    }
    const ctx = uniformCtx(entity);
    for (const param of spec.params) {
      if (param.derived) continue;
      const value = getPath(ctx.params, param.key);
      if (value !== undefined) applyParam(U, param, value, ctx);
    }
    if (spec.depthParam && U[spec.depthParam.u]) U[spec.depthParam.u].value = entity.depth;
  }
}

/* Also the credits hook: it runs after every build, which is the only moment a
   shape asset (and its attribution) can have changed. */
host.onApplyUniforms = (sky) => {
  applyAll(sky);
  renderCredits();
};

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildPending = true;
  rebuildTimer = setTimeout(() => {
    /* A rebuild disposes the engine, which would pull the renderer out from
       under a capture's pending readback. Wait for the busy state to clear. */
    if (ui.busy) { scheduleRebuild(); return; }
    rebuildPending = false;
    host.apply(buildEngineConfig(scene)).catch(reportBootFailure);
  }, REBUILD_MS);
}

function rebuildNow() {
  clearTimeout(rebuildTimer);
  rebuildPending = false;
  return host.apply(buildEngineConfig(scene));
}

/* Small helpers */

function markDirty(on = true) {
  ui.dirty = on;
  dom.dirty.hidden = !on;
  dom.dirtyFiling.hidden = !on;
}

function say(message, tone = '') {
  dom.status.textContent = message;
  dom.status.dataset.tone = tone;
}

function reportBootFailure(err) {
  console.error('Firmament: the engine could not start.', err);
  say('The engine could not start. Try ?gl=1 to force WebGL2.', 'warn');
  dom.veil.classList.remove('is-dark');
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function saveUi() {
  try {
    localStorage.setItem(STORE_UI, JSON.stringify({
      tier: ui.tier, theme: ui.theme, collapsed: ui.collapsed, selected: ui.selected,
      filingOpen: ui.filingOpen, shotSize: ui.shotSize, camOpen: ui.camOpen,
      creditsOpen: ui.creditsOpen,
    }));
  } catch { /* storage blocked: session-only */ }
}

function loadUi() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_UI) ?? 'null');
    if (!raw) return;
    if (raw.tier === 1 || raw.tier === 2 || raw.tier === 3) ui.tier = raw.tier;
    if (UI_THEMES.some((t) => t.id === raw.theme)) ui.theme = raw.theme;
    if (TYPE_BY_ID[raw.selected]) ui.selected = raw.selected;
    if (CAPTURE_SIZES.some((c) => c.id === raw.shotSize)) ui.shotSize = raw.shotSize;
    ui.collapsed = raw.collapsed === true;
    ui.filingOpen = raw.filingOpen === true;
    ui.camOpen = raw.camOpen !== false;
    ui.creditsOpen = raw.creditsOpen === true;
  } catch { /* ignore a corrupt blob and keep defaults */ }
}

/* Themes */

function applyTheme() {
  if (ui.theme && ui.theme !== DEFAULT_THEME) document.documentElement.dataset.theme = ui.theme;
  else delete document.documentElement.dataset.theme;
  /* Jelly's canvas-painted controls cache resolved token colors; this is the
     bundle's own repaint signal */
  window.dispatchEvent(new CustomEvent('jelly-theme-change'));
}

/* Control factories */

function readoutText(param, value) {
  return formatValue(param, value) + (param.unit ? ` ${param.unit}` : '');
}

function sliderRow(param, value, keyAttr) {
  const id = `p-${keyAttr}-${param.key}`.replace(/[^\w-]/g, '_');
  if (param.kind === 'bool') {
    return `<div class="param param--bool" data-param="${param.key}">
      <span class="param__label">${param.label}</span>
      <jelly-checkbox size="small" data-role="param" data-key="${param.key}"
        label="${param.label}" ${value ? 'checked' : ''}></jelly-checkbox>
    </div>`;
  }
  if (param.kind === 'enum') {
    const options = param.options
      .map((o) => `<jelly-option value="${o.id}">${o.label}</jelly-option>`)
      .join('');
    return `<div class="param param--pick" data-param="${param.key}">
      <span class="param__label">${param.label}</span>
      <jelly-select size="small" data-role="param" data-key="${param.key}"
        label="${param.label}" value="${value}">${options}</jelly-select>
    </div>`;
  }
  return `<div class="param" data-param="${param.key}">
    <span class="param__label" title="${param.label}">${param.label}</span>
    <jelly-slider size="small" data-role="param" data-key="${param.key}" id="${id}"
      label="${param.label}" min="${param.min}" max="${param.max}"
      step="${param.step}" value="${value}"></jelly-slider>
    <output class="param__value" for="${id}">${readoutText(param, value)}</output>
  </div>`;
}

function groupKey(type, group) {
  return `${type}:${group}`;
}

function isGroupOpen(type, group, hasBasic) {
  const key = groupKey(type, group);
  if (ui.openGroups.has(`-${key}`)) return false;
  return ui.openGroups.has(key) || hasBasic;
}

/* Rendering */

/* Every render replaces a whole subtree, which parks the scroller at the top.
   Restoring in the same frame means the jump never paints. */
function keepScroll(paint) {
  const top = dom.body.scrollTop;
  paint();
  if (dom.body.scrollTop !== top) dom.body.scrollTop = top;
}

function renderSceneParams() {
  const visible = SCENE_PARAMS.filter((p) => p.tier <= ui.tier);
  dom.sceneParams.innerHTML = visible
    .map((p) => sliderRow(p, scene.grading[p.key], 'scene'))
    .join('');
}

function renderEntityList() {
  const ordered = sortEntities(scene.entities);
  const rows = ordered.map((entity, index) => {
    const spec = TYPE_BY_ID[entity.type];
    const current = entity.type === ui.selected;
    const grip = spec.pinned
      ? `<span class="grip" aria-hidden="true" title="Stars always sit farthest away">${PIN}</span>`
      /* The handle carries `draggable` of its own: a button inside a draggable
         row swallows the gesture rather than starting the row's drag. */
      : `<button class="grip" type="button" draggable="true" data-act="grip" data-type="${entity.type}"
          aria-label="Reorder ${spec.label}, ${index + 1} of ${ordered.length} from farthest. Arrow up moves it farther, arrow down nearer.">${GRIP}</button>`;
    return `<li class="entity ${current ? 'is-current' : ''} ${entity.hidden ? 'is-hidden' : ''}"
      data-type="${entity.type}" data-index="${index}" ${spec.pinned ? '' : 'draggable="true"'}>
      ${grip}
      <button class="icon-btn" type="button" data-act="visible" data-type="${entity.type}"
        aria-pressed="${!entity.hidden}" aria-label="${entity.hidden ? 'Show' : 'Hide'} ${spec.label}">
        ${entity.hidden ? EYE_OFF : EYE_ON}
      </button>
      <button class="entity__pick" type="button" data-act="select" data-type="${entity.type}"
        ${current ? 'aria-current="true"' : ''}>${spec.label}</button>
      <span class="seed">#${entity.seed}</span>
      <jelly-checkbox size="small" data-act="lock" data-type="${entity.type}"
        label="Lock ${spec.label} against a global reroll" ${entity.lock ? 'checked' : ''}></jelly-checkbox>
    </li>`;
  });
  keepScroll(() => { dom.list.innerHTML = HEAD_ROW + rows.join(''); });

  const present = new Set(scene.entities.map((e) => e.type));
  dom.adders.innerHTML = ENTITY_TYPES
    .filter((t) => !present.has(t.type))
    .map((t) => `<button class="btn" type="button" data-act="add" data-type="${t.type}">+ ${t.label}</button>`)
    .join('');
}

function renderEntityDetail() {
  const entity = scene.entities.find((e) => e.type === ui.selected);
  if (!entity) {
    dom.heading.textContent = 'Parameters';
    dom.detail.innerHTML = '<p class="hint">Select an entity to tune it, or add one from the list above.</p>';
    return;
  }
  const spec = TYPE_BY_ID[entity.type];
  dom.heading.textContent = spec.label;

  const head = `<div class="entity-head">
    <span class="entity-head__name">#${entity.seed}</span>
    <button class="icon-btn" type="button" data-act="reroll-entity" aria-label="Reroll this entity's seed">${DICE}</button>
    <button class="icon-btn" type="button" data-act="remove" aria-label="Remove ${spec.label} from the scene">${TRASH}</button>
  </div>`;

  const byGroup = new Map(spec.groups.map((g) => [g, []]));
  for (const param of spec.params) {
    if (param.tier > ui.tier) continue;
    byGroup.get(param.group)?.push(param);
  }
  if (spec.depthParam && ui.tier >= 3) {
    const bound = depthBounds(entity);
    /* Pinned between neighbors with zero travel, the dial would render a
       min === max range (NaN thumb); the row hides until a drag makes room. */
    if (bound.max - bound.min > 1e-9) {
      byGroup.get('Depth')?.push({
        ...DEPTH_PARAM, min: bound.min, max: bound.max, def: spec.depth ?? 0, group: 'Depth', tier: 3,
      });
    }
  }

  const eff = effectiveParams(entity);
  const groups = spec.groups.map((group) => {
    const list = byGroup.get(group) ?? [];
    if (!list.length) return '';
    const hasBasic = list.some((p) => p.tier === 1);
    const open = isGroupOpen(entity.type, group, hasBasic);
    const rows = list.map((param) => {
      let value;
      if (param.synthetic) value = entity.depth;
      else if (param.read) value = param.read(eff);
      else value = getPath(eff, param.key);
      return sliderRow(param, value, entity.type);
    }).join('');
    /* Depth holds one synthetic row and nothing the dice could roll */
    const dice = list.every((param) => param.synthetic) ? '' : `<button class="icon-btn" type="button" data-act="reroll-group" data-group="${group}"
      aria-label="Reroll the ${group} parameters">${DICE}</button>`;
    return `<details class="group" data-group="${group}" ${open ? 'open' : ''}>
      <summary class="group__summary">
        <span class="group__name">${group}</span>
        ${dice}
      </summary>
      <div class="params">${rows}</div>
    </details>`;
  }).join('');

  keepScroll(() => { dom.detail.innerHTML = head + groups; });
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ESCAPES[ch]);

/* Attribution is a license condition, so the sidecar's verbatim string prints
   exactly as supplied. Assets that ship none get their credit fields joined. */
function renderCredits() {
  const seen = new Set();
  const cards = [];
  for (const bag of host.instances?.shape ?? []) {
    const asset = bag.shpAsset;
    if (!asset || seen.has(asset)) continue;
    seen.add(asset);
    const credit = asset.credit ?? {};
    const line = asset.creditVerbatim
      || [credit.subject, credit.author, credit.license].filter(Boolean).join(' · ')
      || asset.name;
    const url = typeof credit.url === 'string' ? credit.url.trim() : '';
    cards.push(`<li class="credit">
      <p class="credit__line">${esc(line)}</p>
      ${asset.derivation ? `<p class="credit__note">${esc(asset.derivation)}</p>` : ''}
      ${credit.maskLicense ? `<p class="credit__note">Mask: ${esc(credit.maskLicense)}</p>` : ''}
      ${url ? `<a class="credit__link" href="${esc(url)}" target="_blank" rel="noopener">Source image</a>` : ''}
    </li>`);
  }
  dom.credits.hidden = cards.length === 0;
  dom.creditsList.innerHTML = cards.join('');
}

function renderHeaderState() {
  dom.name.value = scene.name;
  dom.seed.value = String(scene.seed);
  setSelectValue(dom.palette, scene.palette);
}

function renderAll() {
  renderHeaderState();
  renderCamera();
  renderSceneParams();
  renderEntityList();
  renderEntityDetail();
}

/* Icons kept as constants so the row templates stay readable */
const EYE_ON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M1.5 8S4 3.5 8 3.5c1.2 0 2.3.4 3.2.9M14.5 8s-2.5 4.5-6.5 4.5c-1.2 0-2.3-.4-3.2-.9M2.5 2.5l11 11"/></svg>';
const DICE = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.8" cy="5.8" r="1.1" fill="currentColor"/><circle cx="10.2" cy="10.2" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/></svg>';
const TRASH = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';
const GRIP = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g fill="currentColor"><circle cx="6" cy="3.4" r="1.25"/><circle cx="10" cy="3.4" r="1.25"/><circle cx="6" cy="8" r="1.25"/><circle cx="10" cy="8" r="1.25"/><circle cx="6" cy="12.6" r="1.25"/><circle cx="10" cy="12.6" r="1.25"/></g></svg>';
const PIN = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9.7 1.3 14.7 6.3l-1.3 1.3-1.1-.3-2.6 2.6.4 1.8-1.2 1.2-2.9-2.9-3.5 3.5-.8-.8 3.5-3.5-2.9-2.9L3.3 5.1l1.8.4L7.7 2.9l-.3-1.1z"/></svg>';
const LOCK = '<svg viewBox="0 0 16 16" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M5.15 7.5V5.1a2.85 2.85 0 0 1 5.7 0v2.4"/><rect x="2.7" y="7.4" width="10.6" height="7.1" rx="1.7" fill="currentColor"/><circle cx="8" cy="10.9" r="1.2" fill="#000"/></svg>';

/* Column header, not a row: the checkboxes carry no visible label of their own */
const HEAD_ROW = `<li class="entities__head" aria-hidden="true">
  <span class="lockmark" title="Lock against a global reroll">${LOCK}</span>
</li>`;

/* Parameter edits */

function findParam(spec, key) {
  return spec.params.find((p) => p.key === key);
}

/* The list owns rank, the dial owns magnitude: a depth is penned in between its
   neighbors' so an edit can never contradict the order on screen. */
function depthBounds(entity) {
  const max = TYPE_BY_ID[entity.type].depthParam?.max ?? 1;
  const ranked = sortEntities(scene.entities).filter((e) => !TYPE_BY_ID[e.type].pinned);
  const at = ranked.indexOf(entity);
  const floor = at > 0 ? ranked[at - 1].depth + DEPTH_GAP : DEPTH_GAP;
  /* Nothing above the last rank but its own ceiling, which it may reach */
  const ceiling = at >= 0 && at < ranked.length - 1 ? ranked[at + 1].depth - DEPTH_GAP : max;
  const min = Math.min(floor, max);
  return { min, max: Math.max(Math.min(ceiling, max), min) };
}

/* Returns false when nothing moved, so a component that echoes its own value
   back on upgrade cannot loop through the rebuild-and-repaint path. */
function commitParam(entity, param, value, live = false) {
  if (param.synthetic) {
    const bound = depthBounds(entity);
    entity.depth = Math.min(Math.max(value, bound.min), bound.max);
    const slot = host.uniforms?.[TYPE_BY_ID[entity.type].depthParam.u];
    if (slot) slot.value = entity.depth;
    return true;
  }
  /* Only a derived enum owns other keys; a plain one is an ordinary structural
     value and takes the path below. */
  if (param.kind === 'enum' && param.derived) {
    /* Write-then-compare, not read-compare: read() can lie once the dependent
       flags drift, and a redundant pick must still re-normalize them. */
    const deps = TYPE_BY_ID[entity.type].params.filter((q) => q.key.startsWith(`${param.key}.`));
    const before = deps.map((q) => getPath(entity.params, q.key));
    param.write(entity.params, value);
    if (deps.every((q, i) => getPath(entity.params, q.key) === before[i])) return false;
    scheduleRebuild();
    return true;
  }
  /* Structural edits rebuild on release only; every drag tick would otherwise
     queue a fresh engine rebuild and stutter the panel. The release repeats the
     last dragged value, so the rebuild has to be scheduled before that no-op
     guard, or a structural slider stores its ticks and never rebuilds. */
  if (param.structural) {
    if (!live) scheduleRebuild();
    if (getPath(entity.params, param.key) === value) return false;
    setPath(entity.params, param.key, value);
    return true;
  }
  setPath(entity.params, param.key, value);
  if (host.uniforms && !entity.hidden) applyParam(host.uniforms, param, value, uniformCtx(entity));
  else if (host.uniforms) applyAll({ uniforms: host.uniforms });
  return true;
}

function readControl(node, param) {
  if (param.kind === 'bool') return node.hasAttribute('checked') ? 1 : 0;
  if (param.kind === 'enum') return node.value || node.getAttribute('value') || param.options[0].id;
  const n = Number(node.value);
  return Number.isFinite(n) ? n : param.def;
}

function updateReadout(node, param, value) {
  const out = node.closest('.param')?.querySelector('.param__value');
  if (out) out.textContent = readoutText(param, value);
}

const DEPTH_PARAM = {
  key: '__depth', label: 'Layer distance', min: 0, max: 1, step: 0.01, def: 0, synthetic: true,
};

function onParamEvent(event) {
  const node = event.target.closest?.('[data-role="param"]');
  if (!node) return;
  const key = node.dataset.key;
  const entity = scene.entities.find((e) => e.type === ui.selected);

  if (node.closest('#scene-params')) {
    const param = SCENE_PARAMS.find((p) => p.key === key);
    if (!param) return;
    const value = readControl(node, param);
    scene.grading[key] = value;
    updateReadout(node, param, value);
    if (host.uniforms) applyParam(host.uniforms, param, value, {});
    host.requestRender();
    markDirty();
    return;
  }

  if (!entity) return;
  const param = key === DEPTH_PARAM.key ? DEPTH_PARAM : findParam(TYPE_BY_ID[entity.type], key);
  if (!param) return;
  const value = readControl(node, param);
  if (!commitParam(entity, param, value, event.type === 'input')) return;
  /* A control that writes its neighbors' state has to repaint them; the
     repaint destroys the focused node, so focus is re-seated by key. */
  if (param.refresh) {
    renderEntityDetail();
    dom.detail.querySelector(`[data-role="param"][data-key="${key}"]`)?.focus();
  }
  /* Read the committed value back: the dial's is clamped against its neighbors */
  else updateReadout(node, param, param.synthetic ? entity.depth : value);
  host.requestRender();
  markDirty();
}

/* Rerolls */

/* Triangular around the default rather than uniform across the range: a flat
   draw over 25 dials reliably produces mud, and this still reaches the edges. */
function rollValue(param) {
  if (param.kind === 'bool') return Math.random() < 0.5 ? 0 : 1;
  if (param.kind === 'enum') return param.options[Math.floor(Math.random() * param.options.length)].id;
  const span = (param.max - param.min) * 0.6;
  const jitter = (Math.random() + Math.random() - 1) * span * 0.5;
  const raw = param.def + jitter;
  const snapped = Math.round(raw / param.step) * param.step;
  return Math.min(Math.max(snapped, param.min), param.max);
}

function rerollGroup(entity, group) {
  const spec = TYPE_BY_ID[entity.type];
  let structural = false;
  /* A derived enum owns its dependent flags: the dice pick one of its presets
     instead of rolling the flags raw, or most rolls land on states no preset
     expresses (including an all-off invisible entity). */
  const owner = spec.params.find((p) => p.group === group && p.derived && p.options);
  for (const param of spec.params) {
    if (param.group !== group || param.derived) continue;
    if (owner && param.key.startsWith(`${owner.key}.`)) continue;
    const value = rollValue(param);
    setPath(entity.params, param.key, value);
    if (param.structural) structural = true;
  }
  if (owner) {
    owner.write(entity.params, owner.options[Math.floor(Math.random() * owner.options.length)].id);
    structural = true;
  }
  if (host.uniforms) applyAll({ uniforms: host.uniforms });
  if (structural) scheduleRebuild();
  host.requestRender();
  renderEntityDetail();
  markDirty();
  say(`Rerolled ${group.toLowerCase()}.`);
}

/* Camera

   A pad, not two sliders: pan is a single 2D quantity and a puck shows where
   you are in it. The range is bounded because an absolute pad needs an axis;
   composition never wants more than a couple of frames of travel. */

const CAM_STEP = 0.02;
const CAM_STEP_BIG = 0.12;
const PAD_KEYS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
};

const clampCam = (v) => Math.min(Math.max(v, -CAMERA_RANGE), CAMERA_RANGE);

function renderCamera() {
  const { x, y } = scene.camera;
  /* The pad's block axis grows downward and the camera's grows upward */
  dom.camPuck.style.setProperty('--px', `${(x / CAMERA_RANGE * 0.5 + 0.5) * 100}%`);
  dom.camPuck.style.setProperty('--py', `${(0.5 - y / CAMERA_RANGE * 0.5) * 100}%`);
  dom.camRead.textContent = `X ${x.toFixed(2)} · Y ${y.toFixed(2)}`;
}

function setCamera(x, y) {
  const nx = clampCam(x);
  const ny = clampCam(y);
  if (nx === scene.camera.x && ny === scene.camera.y) return;
  scene.camera.x = nx;
  scene.camera.y = ny;
  host.setCamera(nx, ny);
  renderCamera();
  markDirty();
}

function padToCamera(event) {
  const rect = dom.camPad.getBoundingClientRect();
  const nx = (event.clientX - rect.left) / rect.width;
  const ny = (event.clientY - rect.top) / rect.height;
  setCamera((nx * 2 - 1) * CAMERA_RANGE, (1 - ny * 2) * CAMERA_RANGE);
}

function onPadKey(event) {
  if (event.key === 'Home') {
    event.preventDefault();
    setCamera(0, 0);
    return;
  }
  const dir = PAD_KEYS[event.key];
  if (!dir) return;
  event.preventDefault();
  const step = event.shiftKey ? CAM_STEP_BIG : CAM_STEP;
  setCamera(scene.camera.x + dir[0] * step, scene.camera.y + dir[1] * step);
}

/* Reorder */

function applyDepths() {
  const U = host.uniforms;
  if (!U) return;
  for (const entity of scene.entities) {
    const slot = TYPE_BY_ID[entity.type].depthParam?.u;
    if (slot && U[slot]) U[slot].value = entity.depth;
  }
  host.requestRender();
}

function afterReorder(message) {
  applyDepths();
  renderEntityList();
  markDirty();
  say(message);
}

/* Restarting the animation needs the class gone and a layout flush between it
   and the re-add, or a second click inside one roll is a no-op. */
function spinDice(button) {
  if (!button) return;
  button.classList.remove('is-rolling');
  void button.offsetWidth;
  button.classList.add('is-rolling');
}

function clearDragMarks() {
  for (const row of dom.list.children) row.classList.remove('is-dragging', 'is-over');
}

async function veil(dark) {
  dom.veil.classList.toggle('is-dark', dark);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  await wait(VEIL_MS);
}

const FILE_BUTTONS = ['save', 'load', 'export', 'import', 'shot'];

function setBusy(on) {
  ui.busy = on;
  dom.reroll.toggleAttribute('disabled', on);
  for (const id of FILE_BUTTONS) el(id).disabled = on;
}

async function rerollCosmos() {
  if (ui.busy) return;
  setBusy(true);
  try {
    const seed = randomSeed();
    await veil(true);
    scene.seed = seed;
    for (const entity of scene.entities) {
      if (entity.lock) continue;
      entity.seed = deriveSeed(seed, TYPE_BY_ID[entity.type].salt);
    }
    syncSeedUrl();
    await rebuildNow();
    renderAll();
    markDirty();
    say(`Seed ${seed}.`);
  } catch (err) {
    reportBootFailure(err);
  } finally {
    await veil(false);
    setBusy(false);
  }
}

/* Persistence */

function slug(name) {
  return (name || 'sky').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sky';
}

function currentPreset() {
  return serialize(scene, host.timeSeconds);
}

function savePreset() {
  try {
    localStorage.setItem(STORE_PRESET, JSON.stringify(currentPreset()));
    markDirty(false);
    say(`Saved "${scene.name}" to this browser.`);
  } catch (err) {
    console.warn('Firmament: save failed.', err);
    say('Could not save: browser storage is unavailable.', 'warn');
  }
}

/* The seed stays in the URL so a sky in progress is still shareable */
function syncSeedUrl() {
  params.set('seed', String(scene.seed));
  history.replaceState(null, '', `?${params}`);
}

async function adoptPreset(raw, source) {
  const { scene: next, savedT, warnings } = deserialize(raw);
  scene = next;
  host.setTime(savedT);
  syncSeedUrl();
  await rebuildNow();
  renderAll();
  markDirty(false);
  say(warnings.length ? `${source}: ${warnings[0]}` : `Loaded "${scene.name}".`, warnings.length ? 'warn' : '');
  if (warnings.length > 1) console.warn('Firmament: preset warnings.', warnings);
}

async function loadPreset() {
  if (ui.busy) return;
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(STORE_PRESET) ?? 'null');
  } catch {
    raw = null;
  }
  if (!raw) { say('Nothing saved in this browser yet.', 'warn'); return; }
  setBusy(true);
  try {
    await adoptPreset(raw, 'Loaded');
  } catch (err) {
    console.warn('Firmament: load failed.', err);
    say(`Could not load: ${err.message}`, 'warn');
  } finally {
    setBusy(false);
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPreset() {
  const name = `${slug(scene.name)}.cosmos`;
  download(new Blob([JSON.stringify(currentPreset(), null, 2)], { type: 'application/json' }), name);
  markDirty(false);
  say(`Exported ${name}.`);
}

/* Capture

   Pixel counts are absolute, never multiplied by the window's DPR: a 3840×2160
   preset has to mean 3840×2160. A different aspect genuinely reframes the sky,
   which is the point of picking one. */

function captureSize() {
  const id = readSelect(dom.shotSize);
  if (id !== 'window') {
    const [w, h] = id.split('x').map(Number);
    return { w, h };
  }
  const rect = dom.stack.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  return {
    w: Math.max(2, Math.round(rect.width * ratio)),
    h: Math.max(2, Math.round(rect.height * ratio)),
  };
}

async function capturePng() {
  if (ui.busy || !host.ready) return;
  const { w, h } = captureSize();
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;
  setBusy(true);
  say(`Rendering ${w}×${h}…`);
  try {
    /* A queued structural rebuild would export the previous geometry */
    if (rebuildPending) await rebuildNow();
    const pixels = await host.capture(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('the browser refused to encode the PNG.');
    download(blob, `${slug(scene.name)}-${w}x${h}.png`);
    say(`Captured ${w}×${h}.`);
  } catch (err) {
    console.warn('Firmament: capture failed.', err);
    say(`Could not capture: ${err.message}`, 'warn');
  } finally {
    setBusy(false);
  }
}

async function importFile(file) {
  if (!file || ui.busy) return;
  setBusy(true);
  try {
    const raw = JSON.parse(await file.text());
    await adoptPreset(raw, 'Imported');
  } catch (err) {
    console.warn('Firmament: import failed.', err);
    say(`Could not import: ${err.message}`, 'warn');
  } finally {
    setBusy(false);
    dom.file.value = '';
  }
}

/* Transport */

function formatT(hours) {
  if (hours >= 48) return `T +${(hours / 24).toFixed(1)} d`;
  return `T +${hours.toFixed(1)} h`;
}

function syncTransport() {
  const hours = host.timeSeconds / 3600;
  if (hours > ui.scrubMax * 0.98 && ui.scrubMax < T_WRAP_H) {
    ui.scrubMax = Math.min(ui.scrubMax * 2, T_WRAP_H);
    dom.scrub.setAttribute('max', String(ui.scrubMax));
  }
  dom.tread.textContent = formatT(hours);
  if (ui.scrubBusy) return;
  /* Compared numerically: the getter returns the input's own string form, so a
     string compare never matches and the slider would repaint every tick */
  const next = Math.min(hours, ui.scrubMax);
  if (Math.abs(Number(dom.scrub.value) - next) > 0.02) dom.scrub.value = next.toFixed(2);
}

const PAUSE_GLYPH = '<path fill="currentColor" d="M4 3h3v10H4zM9 3h3v10H9z"/>';
const PLAY_GLYPH = '<path fill="currentColor" d="M5 3l8 5-8 5z"/>';

/* Reads back from the host: under reduced motion it refuses to play, and the
   button has to say so rather than lie about what it asked for. */
function syncPlayButton() {
  const on = host.playing;
  dom.play.disabled = host.frozen;
  dom.play.setAttribute('aria-pressed', String(on));
  dom.play.setAttribute('aria-label', on ? 'Pause evolution' : 'Resume evolution');
  dom.playIcon.innerHTML = on ? PAUSE_GLYPH : PLAY_GLYPH;
}

function setPlaying(on) {
  host.setPlaying(on);
  syncPlayButton();
}

/* Wiring */

/* jelly-select reads the host's `value` attribute first, options' `selected`
   second, syncing via MutationObserver; the `.value` setter runs before the
   options exist and clears the pick. The attribute is the only race-free path. */
/* scrollbar-color inherits through a shadow boundary but scrollbar-width does
   not, and Jelly exposes no ::part() for its listbox, so the thin bar has to be
   adopted into the shadow root itself. */
const SCROLL_SHEET = new CSSStyleSheet();
SCROLL_SHEET.replaceSync('.list { scrollbar-width: thin; }');

async function thinScrollbars(node) {
  await customElements.whenDefined(node.localName);
  const root = node.shadowRoot;
  if (!root || root.adoptedStyleSheets.includes(SCROLL_SHEET)) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, SCROLL_SHEET];
}

function fillSelect(node, options, current) {
  node.innerHTML = options
    .map((o) => `<jelly-option value="${o.id}">${o.label}</jelly-option>`)
    .join('');
  setSelectValue(node, current);
  thinScrollbars(node);
}

function setSelectValue(node, value) {
  node.setAttribute('value', String(value));
}

function readSelect(node) {
  return node.value || node.getAttribute('value') || '';
}

function setCollapsed(on) {
  ui.collapsed = on;
  dom.panel.classList.toggle('is-collapsed', on);
  dom.panel.inert = on;
  dom.panelOpen.hidden = !on;
  dom.panelClose.setAttribute('aria-expanded', String(!on));
  dom.panelOpen.setAttribute('aria-expanded', String(!on));
  if (on) dom.panelOpen.focus();
  else dom.panelClose.focus();
  saveUi();
}

function wire() {
  fillSelect(dom.palette, PALETTE_OPTIONS, scene.palette);
  fillSelect(dom.theme, UI_THEMES, ui.theme);
  fillSelect(dom.speed, SPEED_STEPS.map((s) => ({ id: s, label: `${s}×` })), host.speed);
  fillSelect(dom.shotSize, CAPTURE_SIZES, ui.shotSize);

  dom.tier.addEventListener('change', () => {
    const next = Number(dom.tier.getAttribute('value'));
    if (![1, 2, 3].includes(next) || next === ui.tier) return;
    ui.tier = next;
    renderSceneParams();
    renderEntityDetail();
    saveUi();
  });

  dom.panelClose.addEventListener('click', () => setCollapsed(true));
  dom.panelOpen.addEventListener('click', () => setCollapsed(false));

  dom.name.addEventListener('input', () => {
    scene.name = dom.name.value.slice(0, 80);
    markDirty();
  });

  dom.seed.addEventListener('change', async () => {
    const next = Number.parseInt(dom.seed.value, 10);
    if (!Number.isFinite(next) || next < 0) { dom.seed.value = String(scene.seed); return; }
    scene.seed = next;
    for (const entity of scene.entities) {
      if (entity.lock) continue;
      entity.seed = deriveSeed(next, TYPE_BY_ID[entity.type].salt);
    }
    syncSeedUrl();
    await rebuildNow().catch(reportBootFailure);
    renderEntityList();
    renderEntityDetail();
    markDirty();
  });

  dom.palette.addEventListener('change', () => {
    scene.palette = readSelect(dom.palette);
    /* sky2d forces SCNR 0.7 under SHO; mirror it so the dial tells the truth */
    if (scene.palette === 'sho' && scene.grading.scnr === 0) scene.grading.scnr = 0.7;
    if (host.uniforms) { applyPalette(host.uniforms); applyAll({ uniforms: host.uniforms }); }
    renderSceneParams();
    host.requestRender();
    markDirty();
  });

  dom.theme.addEventListener('change', () => {
    ui.theme = readSelect(dom.theme);
    applyTheme();
    saveUi();
  });

  dom.sceneParams.addEventListener('input', onParamEvent);
  dom.sceneParams.addEventListener('change', onParamEvent);
  dom.detail.addEventListener('input', onParamEvent);
  dom.detail.addEventListener('change', onParamEvent);

  dom.detail.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const entity = scene.entities.find((e) => e.type === ui.selected);
    if (!entity) return;
    /* The render replaces the button that was clicked, so the roll starts on
       its replacement rather than on the node about to be dropped. */
    if (button.dataset.act === 'reroll-group') {
      event.preventDefault();
      event.stopPropagation();
      const group = button.dataset.group;
      rerollGroup(entity, group);
      spinDice(dom.detail.querySelector(`[data-act="reroll-group"][data-group="${group}"]`));
      return;
    }
    if (button.dataset.act === 'reroll-entity') {
      entity.seed = randomSeed();
      rebuildNow().catch(reportBootFailure);
      renderEntityList();
      renderEntityDetail();
      spinDice(dom.detail.querySelector('[data-act="reroll-entity"]'));
      markDirty();
      say(`${TYPE_BY_ID[entity.type].label} reseeded.`);
      return;
    }
    if (button.dataset.act === 'remove') {
      scene.entities = scene.entities.filter((e) => e.type !== entity.type);
      normalizeOrder(scene.entities);
      ui.selected = sortEntities(scene.entities)[0]?.type ?? '';
      rebuildNow().catch(reportBootFailure);
      renderAll();
      markDirty();
      say(`${TYPE_BY_ID[entity.type].label} removed.`);
    }
  });

  dom.detail.addEventListener('animationend', (event) => {
    event.target.closest?.('.is-rolling')?.classList.remove('is-rolling');
  });

  /* Remembering which groups the user opened survives a tier switch */
  dom.detail.addEventListener('toggle', (event) => {
    const details = event.target;
    if (!details.classList?.contains('group')) return;
    const key = groupKey(ui.selected, details.dataset.group);
    ui.openGroups.delete(key);
    ui.openGroups.delete(`-${key}`);
    ui.openGroups.add(details.open ? key : `-${key}`);
  }, true);

  dom.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const type = button.dataset.type;
    if (button.dataset.act === 'select') {
      ui.selected = type;
      renderEntityList();
      renderEntityDetail();
      saveUi();
      return;
    }
    if (button.dataset.act === 'visible') {
      const entity = scene.entities.find((e) => e.type === type);
      if (!entity) return;
      entity.hidden = !entity.hidden;
      if (host.uniforms) applyAll({ uniforms: host.uniforms });
      host.requestRender();
      renderEntityList();
      if (type === ui.selected) renderEntityDetail();
      markDirty();
    }
  });

  dom.camPad.addEventListener('pointerdown', (event) => {
    dom.camPad.setPointerCapture(event.pointerId);
    dom.camPad.focus();
    padToCamera(event);
  });
  dom.camPad.addEventListener('pointermove', (event) => {
    if (dom.camPad.hasPointerCapture(event.pointerId)) padToCamera(event);
  });
  dom.camPad.addEventListener('keydown', onPadKey);
  dom.camCenter.addEventListener('click', () => {
    setCamera(0, 0);
    dom.camPad.focus();
  });

  dom.list.addEventListener('keydown', (event) => {
    const grip = event.target.closest?.('[data-act="grip"]');
    if (!grip) return;
    const delta = { ArrowUp: -1, ArrowDown: 1 }[event.key] ?? 0;
    if (!delta) return;
    event.preventDefault();
    const type = grip.dataset.type;
    if (!moveEntity(scene.entities, type, delta)) return;
    afterReorder(`${TYPE_BY_ID[type].label} moved ${delta < 0 ? 'farther' : 'nearer'}.`);
    dom.list.querySelector(`[data-act="grip"][data-type="${type}"]`)?.focus();
  });

  /* Firefox can float a native drag ghost off a flung slider; only the entity
     list legitimately drags, so everything else in the panel refuses to */
  dom.panel.addEventListener('dragstart', (event) => {
    if (!event.target.closest?.('#entity-list')) event.preventDefault();
  });

  dom.list.addEventListener('dragstart', (event) => {
    const row = event.target.closest?.('li.entity');
    if (!row || TYPE_BY_ID[row.dataset.type]?.pinned) { event.preventDefault(); return; }
    dragType = row.dataset.type;
    /* Firefox will not start a drag without a payload on the transfer */
    event.dataTransfer.setData('text/plain', dragType);
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('is-dragging');
  });

  dom.list.addEventListener('dragover', (event) => {
    const row = event.target.closest?.('li.entity');
    if (!dragType || !row || TYPE_BY_ID[row.dataset.type]?.pinned) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const node of dom.list.children) node.classList.toggle('is-over', node === row);
  });

  dom.list.addEventListener('drop', (event) => {
    const row = event.target.closest?.('li.entity');
    if (!dragType || !row) return;
    event.preventDefault();
    const type = dragType;
    const index = Number(row.dataset.index);
    dragType = null;
    if (placeEntity(scene.entities, type, index)) {
      afterReorder(`${TYPE_BY_ID[type].label} moved to position ${index + 1}.`);
    } else {
      clearDragMarks();
    }
  });

  /* Fires after drop, and on a canceled drag where drop never does */
  dom.list.addEventListener('dragend', () => {
    dragType = null;
    clearDragMarks();
  });

  dom.list.addEventListener('change', (event) => {
    const box = event.target.closest?.('[data-act="lock"]');
    if (!box) return;
    const entity = scene.entities.find((e) => e.type === box.dataset.type);
    if (!entity) return;
    entity.lock = box.hasAttribute('checked');
    markDirty();
  });

  dom.adders.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act="add"]');
    if (!button) return;
    const type = button.dataset.type;
    if (scene.entities.some((e) => e.type === type)) return;
    scene.entities.push(makeEntity(type, scene.seed));
    normalizeOrder(scene.entities);
    ui.selected = type;
    rebuildNow().catch(reportBootFailure);
    renderAll();
    markDirty();
    say(`${TYPE_BY_ID[type].label} added.`);
  });

  dom.scrub.addEventListener('input', () => {
    ui.scrubBusy = true;
    const hours = Number(dom.scrub.value);
    if (!Number.isFinite(hours)) return;
    host.setTime(hours * 3600);
    dom.tread.textContent = formatT(hours);
  });
  dom.scrub.addEventListener('change', () => { ui.scrubBusy = false; });
  dom.scrub.addEventListener('focusin', () => { ui.scrubBusy = true; });
  dom.scrub.addEventListener('focusout', () => { ui.scrubBusy = false; });

  dom.speed.addEventListener('change', () => {
    host.setSpeed(Number(readSelect(dom.speed)) || 1);
  });

  dom.play.addEventListener('click', () => setPlaying(!host.playing));
  host.onMotionPreference = () => {
    syncPlayButton();
    if (host.frozen) say('Reduced motion is on: evolution is frozen. Scrub time by hand.');
  };

  dom.filing.open = ui.filingOpen;
  dom.filing.addEventListener('toggle', () => {
    ui.filingOpen = dom.filing.open;
    saveUi();
  });
  dom.camBlock.open = ui.camOpen;
  dom.camBlock.addEventListener('toggle', () => {
    ui.camOpen = dom.camBlock.open;
    saveUi();
  });
  dom.credits.open = ui.creditsOpen;
  dom.credits.addEventListener('toggle', () => {
    ui.creditsOpen = dom.credits.open;
    saveUi();
  });
  dom.shotSize.addEventListener('change', () => {
    ui.shotSize = readSelect(dom.shotSize);
    saveUi();
  });
  el('shot').addEventListener('click', capturePng);

  dom.reroll.addEventListener('click', rerollCosmos);
  el('save').addEventListener('click', savePreset);
  el('load').addEventListener('click', loadPreset);
  el('export').addEventListener('click', exportPreset);
  el('import').addEventListener('click', () => dom.file.click());
  dom.file.addEventListener('change', () => importFile(dom.file.files?.[0]));

  setInterval(syncTransport, 250);
}

/* Boot */

async function boot() {
  loadUi();
  wire();
  applyTheme();
  dom.tier.setAttribute('value', String(ui.tier));
  if (ui.collapsed) {
    dom.panel.classList.add('is-collapsed');
    dom.panel.inert = true;
    dom.panelOpen.hidden = false;
    dom.panelClose.setAttribute('aria-expanded', 'false');
    dom.panelOpen.setAttribute('aria-expanded', 'false');
  }
  if (!scene.entities.some((e) => e.type === ui.selected)) ui.selected = scene.entities[0]?.type ?? '';
  renderAll();

  const sky2d = await import('/engine/render/sky2d.js');
  paletteRows = sky2d.PALETTES;

  await host.apply(buildEngineConfig(scene));
  say(`Rendering on ${host.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}.`);
  syncPlayButton();
  if (host.frozen) say('Reduced motion is on: evolution is frozen. Scrub time by hand.');

  /* The dark veil has to visibly paint before it lifts, or boot reads as a pop */
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  dom.veil.classList.remove('is-dark');
  syncTransport();
}

boot().catch(reportBootFailure);
