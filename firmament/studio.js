/* Firmament studio: panel state, controls, and the preset→uniform bridge.
   Slider drags poke uniforms; build-time values go through a debounced rebuild. */

import { createSkyHost } from './sky-host.js';
import {
  ENTITY_TYPES, TYPE_BY_ID, SCENE_PARAMS, PALETTE_OPTIONS, UI_THEMES, SPEED_STEPS,
  DEFAULT_THEME, CAMERA_RANGE, CAPTURE_SIZES, GROUP_GATES,
  getPath, setPath, formatValue,
} from './spec.js';
import {
  createScene, buildEngineConfig, serialize, deserialize, sortEntities,
  makeEntity, randomSeed, effectiveParams, normalizeOrder, placeEntity, moveEntity,
  entitySeed, instanceCap, DEPTH_GAP, DEFAULT_SEED,
} from './preset.js';

const STORE_PRESET = 'cosmorph:firmament:preset';
const STORE_UI = 'cosmorph:firmament:ui';
const STORE_AUTO = 'cosmorph:firmament:autosave';
const AUTOSAVE_MS = 60000;
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
  hud: el('hud'),
  hudTab: el('hud-tab'),
  flyHome: el('fly-home'),
  dock: el('dock'),
  alpha: el('panel-alpha'),
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
  dock: 'end',
  /* null means "never touched": the themes' own glass defaults still apply */
  panelAlpha: null,
  collapsed: false,
  /* The selected entity object itself, so a reorder cannot slide the selection
     onto a neighbor; `selectedRef` is its (type, k) mirror, for storage only. */
  selected: null,
  selectedRef: { type: 'emission', k: 0 },
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
let dragEntity = null;

const host = createSkyHost({ mount: dom.stack, forceGL });

/* Instance identity

   An entity is named by (type, k), where k counts same-type rows in list order.
   That is the index sky2d gives its per-type uniform bags, and the letter the
   row wears. buildEngineConfig emits in list order to keep the two agreed. */

const LETTERS = 'ABC';

function* instanceRows() {
  const seen = new Map();
  for (const entity of sortEntities(scene.entities)) {
    const k = seen.get(entity.type) ?? 0;
    seen.set(entity.type, k + 1);
    yield { entity, k };
  }
}

function instanceIndex(entity) {
  for (const row of instanceRows()) if (row.entity === entity) return row.k;
  return -1;
}

function entityAt(type, k) {
  for (const row of instanceRows()) if (row.entity.type === type && row.k === k) return row.entity;
  return null;
}

const typeCount = (type) => scene.entities.reduce((n, e) => n + (e.type === type ? 1 : 0), 0);

/* Only a multiplied type earns a letter: a lone reflection nebula stays
   "Reflection nebula", not "Reflection nebula A". */
function labelFor(entity, k = instanceIndex(entity), count = typeCount(entity.type)) {
  const { label } = TYPE_BY_ID[entity.type];
  return count > 1 ? `${label} ${LETTERS[k] ?? k + 1}` : label;
}

const scopeKey = (entity) => `${entity.type}#${instanceIndex(entity)}`;

const selectedEntity = () => (scene.entities.includes(ui.selected) ? ui.selected : null);

function selectEntity(entity) {
  ui.selected = entity ?? null;
  ui.selectedRef = entity ? { type: entity.type, k: instanceIndex(entity) } : null;
}

/* Re-seats the selection after the scene is replaced or an entity leaves: the
   stored (type, k) is the only way back once the object is gone. */
function resolveSelection() {
  if (selectedEntity()) return;
  const ref = ui.selectedRef;
  const found = ref ? entityAt(ref.type, ref.k) ?? entityAt(ref.type, 0) : null;
  selectEntity(found ?? sortEntities(scene.entities)[0] ?? null);
}

/* State to uniforms */

/* Instance 0's bag IS sky.uniforms, so a singleton type routes exactly as it
   did before the engine started multiplying entities. */
const bagFor = (sky, type, k) => sky.instances?.[type]?.[k] ?? sky.uniforms;

function entityBag(entity) {
  if (!host.uniforms) return null;
  return host.instances?.[entity.type]?.[instanceIndex(entity)] ?? host.uniforms;
}

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
function applyAll(sky = { uniforms: host.uniforms, instances: host.instances }) {
  const U = sky?.uniforms;
  if (!U) return;
  applyPalette(U);
  for (const param of SCENE_PARAMS) {
    if (!param.scene) applyParam(U, param, scene.grading[param.key], {});
  }
  for (const { entity, k } of instanceRows()) {
    const spec = TYPE_BY_ID[entity.type];
    const bag = bagFor(sky, entity.type, k);
    /* A build still in flight when the scene gained an entity has no uniforms
       for it; the rebuild it queued behind will seat them. A permanent skip
       here means a typo'd depthParam.u, hence the warn. */
    if (spec.depthParam && !bag[spec.depthParam.u]) {
      console.warn(`Firmament: no ${spec.depthParam.u} in this build; "${entity.type}"[${k}] edits deferred to the rebuild.`);
      continue;
    }
    const ctx = uniformCtx(entity);
    for (const param of spec.params) {
      if (param.derived) continue;
      const value = getPath(ctx.params, param.key);
      if (value !== undefined) applyParam(bag, param, value, ctx);
    }
    if (spec.depthParam && bag[spec.depthParam.u]) bag[spec.depthParam.u].value = entity.depth;
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
      tier: ui.tier, theme: ui.theme, collapsed: ui.collapsed, selected: ui.selectedRef,
      filingOpen: ui.filingOpen, shotSize: ui.shotSize, camOpen: ui.camOpen,
      creditsOpen: ui.creditsOpen, dock: ui.dock, panelAlpha: ui.panelAlpha,
    }));
  } catch { /* storage blocked: session-only */ }
}

function loadUi() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_UI) ?? 'null');
    if (!raw) return;
    if (raw.tier === 1 || raw.tier === 2 || raw.tier === 3) ui.tier = raw.tier;
    if (UI_THEMES.some((t) => t.id === raw.theme)) ui.theme = raw.theme;
    /* Blobs written before entities could repeat store a bare type string */
    const ref = typeof raw.selected === 'string' ? { type: raw.selected, k: 0 } : raw.selected;
    if (ref && TYPE_BY_ID[ref.type]) {
      ui.selectedRef = { type: ref.type, k: Math.max(0, Math.trunc(Number(ref.k)) || 0) };
    }
    if (CAPTURE_SIZES.some((c) => c.id === raw.shotSize)) ui.shotSize = raw.shotSize;
    if (raw.dock === 'start' || raw.dock === 'end') ui.dock = raw.dock;
    if (Number.isFinite(raw.panelAlpha)) ui.panelAlpha = clampAlpha(raw.panelAlpha);
    ui.collapsed = raw.collapsed === true;
    ui.filingOpen = raw.filingOpen === true;
    ui.camOpen = raw.camOpen !== false;
    ui.creditsOpen = raw.creditsOpen === true;
  } catch { /* ignore a corrupt blob and keep defaults */ }
}

/* Themes and studio chrome */

const ALPHA_MIN = 0.2;
const clampAlpha = (v) => Math.min(Math.max(v, ALPHA_MIN), 1);

function applyDock() {
  document.body.dataset.dock = ui.dock;
}

function applyPanelAlpha() {
  const style = document.documentElement.style;
  if (ui.panelAlpha === null) style.removeProperty('--panel-alpha');
  else style.setProperty('--panel-alpha', String(ui.panelAlpha));
}

/* Themes carry their own glass default, so an untouched slider has to read the
   computed value rather than the base theme's. */
function effectiveAlpha() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--panel-alpha');
  const value = Number.parseFloat(raw.trim());
  return Number.isFinite(value) ? value : 0.64;
}

function syncAlphaControl() {
  dom.alpha.setAttribute('value', String(ui.panelAlpha ?? effectiveAlpha()));
}

function applyTheme() {
  if (ui.theme && ui.theme !== DEFAULT_THEME) document.documentElement.dataset.theme = ui.theme;
  else delete document.documentElement.dataset.theme;
  if (ui.panelAlpha === null) syncAlphaControl();
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
  if (param.kind === 'link') {
    return `<div class="param param--bool param--link" data-param="${param.key}">
      <span class="param__label">${param.label}</span>
      <button class="icon-btn link-btn" type="button" data-role="param" data-key="${param.key}"
        aria-pressed="${value ? 'true' : 'false'}" aria-label="${param.label}"
        title="${param.label}">${value ? CHAIN_ON : CHAIN_OFF}</button>
    </div>`;
  }
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

/* Scope is "scene" or one entity's "type#k", so two copies of a type remember
   their open groups apart. */
function groupKey(scope, group) {
  return `${scope}:${group}`;
}

function isGroupOpen(scope, group, hasBasic) {
  const key = groupKey(scope, group);
  if (ui.openGroups.has(`-${key}`)) return false;
  return ui.openGroups.has(key) || hasBasic;
}

/* Remembering which groups the user opened survives a tier switch */
function rememberGroup(scope, details) {
  if (!details.classList?.contains('group')) return;
  const key = groupKey(scope, details.dataset.group);
  ui.openGroups.delete(key);
  ui.openGroups.delete(`-${key}`);
  ui.openGroups.add(details.open ? key : `-${key}`);
}

/* Conditional visibility

   An unchecked build gate makes its group's dials inert, so they come off the
   panel; the gate control itself never hides. A gate no control at the current
   tier can reach is ignored, which is what guarantees every hidden row has a
   visible control that brings it back. */

function gateList(type, group) {
  const entry = GROUP_GATES[type]?.[group];
  if (!entry) return null;
  return Array.isArray(entry) ? entry : [entry];
}

const bareKey = (raw) => (raw.startsWith('!') ? raw.slice(1) : raw);

/* A `look.*` flag row is Expert-only while the enum that writes it is not, so an
   out-of-tier gate falls back to the tier of the row that owns its prefix. */
function gateTier(gate, key, params) {
  if (gate.tier <= ui.tier) return gate.tier;
  const dot = key.indexOf('.');
  if (dot < 0) return gate.tier;
  return params.find((q) => q.key === key.slice(0, dot))?.tier ?? gate.tier;
}

function gateOpen(keys, params, values) {
  return keys.every((raw) => {
    const key = bareKey(raw);
    const gate = params.find((q) => q.key === key);
    if (!gate || gateTier(gate, key, params) > ui.tier) return true;
    return !!getPath(values, key) !== raw.startsWith('!');
  });
}

const isGateRow = (keys, key) => keys.some((raw) => bareKey(raw) === key);

const gateKeyCache = new Map();

/* Every key that can flip a group's visibility for this type, so an edit to one
   knows to repaint the panel rather than only its own row. */
function gateKeys(type) {
  let keys = gateKeyCache.get(type);
  if (keys) return keys;
  keys = new Set();
  for (const entry of Object.values(GROUP_GATES[type] ?? {})) {
    for (const raw of (Array.isArray(entry) ? entry : [entry])) keys.add(bareKey(raw));
  }
  gateKeyCache.set(type, keys);
  return keys;
}

/* Every `gate` predicate on this type, as one signature. A live uniform can still
   decide whether its chain compiles at all, so only a flip here needs a rebuild. */
function gateState(entity) {
  const eff = effectiveParams(entity);
  return TYPE_BY_ID[entity.type].params
    .filter((param) => param.gate)
    .map((param) => (param.gate(eff) ? 1 : 0))
    .join('');
}

/* True when muting this type writes a build-gated key, which no live poke can
   reach: the starcloud's rift tau is the only one so far. */
function mutesStructural(type) {
  const spec = TYPE_BY_ID[type];
  const muted = Object.keys(spec.mute ?? {});
  return spec.params.some((p) => p.structural && muted.includes(p.key));
}

/* Rendering */

/* Every render replaces a whole subtree, which parks the scroller at the top.
   Restoring in the same frame means the jump never paints. */
function keepScroll(paint) {
  const top = dom.body.scrollTop;
  paint();
  if (dom.body.scrollTop !== top) dom.body.scrollTop = top;
}

/* Grouped the same way entity params are, and in first-appearance order, so the
   lensing dials do not land as twenty unlabeled rows under the grading ones. */
function renderSceneParams() {
  const byGroup = new Map();
  for (const param of SCENE_PARAMS) {
    if (param.tier > ui.tier) continue;
    const group = param.group ?? 'Grading';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(param);
  }

  dom.sceneParams.innerHTML = [...byGroup].map(([group, list]) => {
    const keys = gateList('scene', group);
    const gated = keys ? !gateOpen(keys, SCENE_PARAMS, scene.grading) : false;
    const shown = gated ? list.filter((p) => isGateRow(keys, p.key)) : list;
    if (!shown.length) return '';
    const open = isGroupOpen('scene', group, shown.some((p) => p.tier === 1));
    const rows = shown.map((p) => sliderRow(p, p.scene ? scene[p.key] : scene.grading[p.key], 'scene')).join('');
    return `<details class="group" data-group="${group}" ${gated ? 'data-gated' : ''} ${open ? 'open' : ''}>
      <summary class="group__summary">
        <span class="group__name">${group}</span>
      </summary>
      <div class="params">${rows}</div>
    </details>`;
  }).join('');
}

function renderEntityList() {
  const listed = [...instanceRows()];
  const counts = new Map();
  for (const { entity } of listed) counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);

  const rows = listed.map(({ entity, k }, index) => {
    const spec = TYPE_BY_ID[entity.type];
    const name = labelFor(entity, k, counts.get(entity.type));
    const id = `data-type="${entity.type}" data-k="${k}"`;
    const current = entity === ui.selected;
    const grip = spec.pinned
      ? `<span class="grip" aria-hidden="true" title="Stars always sit farthest away">${PIN}</span>`
      /* The handle carries `draggable` of its own: a button inside a draggable
         row swallows the gesture rather than starting the row's drag. */
      : `<button class="grip" type="button" draggable="true" data-act="grip" ${id}
          aria-label="Reorder ${name}, ${index + 1} of ${listed.length} from farthest. Arrow up moves it farther, arrow down nearer.">${GRIP}</button>`;
    return `<li class="entity ${current ? 'is-current' : ''} ${entity.hidden ? 'is-hidden' : ''} ${entity.lock ? 'is-locked' : ''}"
      ${id} data-index="${index}" ${spec.pinned ? '' : 'draggable="true"'}>
      ${grip}
      <button class="icon-btn" type="button" data-act="visible" ${id}
        aria-pressed="${!entity.hidden}" aria-label="${entity.hidden ? 'Show' : 'Hide'} ${name}">
        ${entity.hidden ? EYE_OFF : EYE_ON}
      </button>
      <button class="entity__pick" type="button" data-act="select" ${id}
        ${current ? 'aria-current="true"' : ''}>${name}</button>
      <span class="seedcell">
        <span class="entity__lock" aria-hidden="true">${LOCK}</span>
        <span class="seed">#${entity.seed}</span>
      </span>
      <jelly-checkbox size="small" data-act="lock" ${id}
        label="Lock ${name}: keep this seed through Reroll Cosmos" ${entity.lock ? 'checked' : ''}></jelly-checkbox>
    </li>`;
  });
  keepScroll(() => { dom.list.innerHTML = HEAD_ROW + rows.join(''); });

  dom.adders.innerHTML = ENTITY_TYPES
    .filter((t) => (counts.get(t.type) ?? 0) < instanceCap(t.type))
    .map((t) => `<button class="btn" type="button" data-act="add" data-type="${t.type}">+ ${t.label}</button>`)
    .join('');
}

function renderEntityDetail() {
  const entity = selectedEntity();
  if (!entity) {
    dom.heading.textContent = 'Parameters';
    dom.detail.innerHTML = '<p class="hint">Select an entity to tune it, or add one from the list above.</p>';
    return;
  }
  const spec = TYPE_BY_ID[entity.type];
  const k = instanceIndex(entity);
  const name = labelFor(entity, k);
  const scope = `${entity.type}#${k}`;
  dom.heading.textContent = name;

  const head = `<div class="entity-head">
    <span class="entity-head__name">#${entity.seed}</span>
    <button class="icon-btn" type="button" data-act="reroll-entity" aria-label="Reroll this entity's seed">${DICE}</button>
    <button class="icon-btn" type="button" data-act="remove" aria-label="Remove ${name} from the scene">${TRASH}</button>
  </div>`;

  /* Say the demotion out loud: only two galaxies swirl live in the composite,
     and the rest turn in steps whenever their plane next rebakes. */
  const bag = host.instances?.[entity.type]?.[k];
  const demoted = bag?.gxSpins && !bag.gxSwirl
    ? '<p class="hint">Spin frozen into the bake: two galaxies swirl live at most, so this one turns in visible steps on rebake, at a floored interval.</p>'
    : '';

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
    const keys = gateList(entity.type, group);
    const gated = keys ? !gateOpen(keys, spec.params, eff) : false;
    const full = byGroup.get(group) ?? [];
    const list = gated ? full.filter((p) => isGateRow(keys, p.key)) : full;
    if (!list.length) return '';
    const hasBasic = list.some((p) => p.tier === 1);
    const open = isGroupOpen(scope, group, hasBasic);
    const rows = list.map((param) => {
      let value;
      if (param.synthetic) value = entity.depth;
      else if (param.read) value = param.read(eff);
      else value = getPath(eff, param.key);
      return sliderRow(param, value, `${entity.type}-${k}`);
    }).join('');
    /* Depth holds one synthetic row and nothing the dice could roll, and a gated
       group has nothing on show but the gate itself */
    const dice = gated || list.every((param) => param.synthetic) ? '' : `<button class="icon-btn" type="button" data-act="reroll-group" data-group="${group}"
      aria-label="Reroll the ${group} parameters">${DICE}</button>`;
    return `<details class="group" data-group="${group}" ${gated ? 'data-gated' : ''} ${open ? 'open' : ''}>
      <summary class="group__summary">
        <span class="group__name">${group}</span>
        ${dice}
      </summary>
      <div class="params">${rows}</div>
    </details>`;
  }).join('');

  keepScroll(() => { dom.detail.innerHTML = head + demoted + groups; });
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
  /* Standing credit: the galaxy dust-lane math derives from Petr Chekushkin's
     SpiralForge studies, shared with permission. Condition of the arrangement. */
  cards.push(`<li class="credit">
    <p class="credit__line">Galaxy dust-lane techniques studied from SpiralForge by Petr Chekushkin, with the author's permission.</p>
  </li>`);
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
const CHAIN_ON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M6.3 9.7 9.7 6.3M5.2 7.4 3.7 8.9a2.6 2.6 0 0 0 3.7 3.7l1.5-1.5M10.8 8.6l1.5-1.5a2.6 2.6 0 0 0-3.7-3.7L7.1 4.9"/></svg>';
const CHAIN_OFF = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4.6 8 3.1 9.5a2.6 2.6 0 0 0 3.7 3.7l1.5-1.5M11.4 8l1.5-1.5a2.6 2.6 0 0 0-3.7-3.7L7.7 4.3M6.9 11.6l-.6 1.9M9.1 4.4l.6-1.9"/></svg>';

/* Column header, not a row: the checkboxes carry no visible label of their own,
   and the caption is what names the scope the padlock exempts a row from */
const HEAD_ROW = `<li class="entities__head" aria-hidden="true">
  <span class="entities__cap">Reroll scope</span>
  <span class="lockmark">${LOCK}</span>
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

/* Asset-intrinsic seeds (tau, glow) follow an asset pick, but only while the
   user has not touched them: tuned sliders survive a swap. */
const shapeSeeds = new WeakMap();

async function reseedShapeAsset(entity) {
  const spec = TYPE_BY_ID.shape;
  /* Sidecars resolve against the repo root, matching the engine loader */
  const url = new URL(`../${entity.params.asset}`, import.meta.url);
  let meta;
  try { meta = await (await fetch(url)).json(); } catch { return; }
  const tauP = findParam(spec, 'tau');
  const glowP = findParam(spec, 'glow');
  const mode = meta.densityMode === 'emission' || meta.densityMode === 'extinction'
    ? meta.densityMode
    : (meta.polarity === 'bright' ? 'emission' : 'extinction');
  const rawTau = Number(meta.suggestedTau) > 0 ? Number(meta.suggestedTau)
    : Number(meta.densityScale) > 0 ? Number(meta.densityScale) * 4 : tauP.def;
  const seeds = {
    tau: Math.min(Math.max(Math.round(rawTau / tauP.step) * tauP.step, tauP.min), tauP.max),
    /* A dark-polarity emission bake has glow = 1 everywhere outside the polygon,
       which lights the whole frame; mirror the engine's shapeBag gate. */
    glow: mode === 'emission' && meta.polarity === 'bright' ? 0.9 : 0,
  };
  const prev = shapeSeeds.get(entity) ?? { tau: tauP.def, glow: glowP.def };
  let changed = false;
  for (const [key, seed] of Object.entries(seeds)) {
    if (getPath(entity.params, key) !== prev[key]) continue;
    if (seed === prev[key]) continue;
    setPath(entity.params, key, seed);
    changed = true;
  }
  shapeSeeds.set(entity, seeds);
  if (!changed) return;
  /* glow is build-gated, and the pick's own rebuild may already have run */
  scheduleRebuild();
  renderEntityDetail();
  markDirty();
}

/* Returns false when nothing moved, so a component that echoes its own value
   back on upgrade cannot loop through the rebuild-and-repaint path. */
function commitParam(entity, param, value, live = false) {
  if (param.synthetic) {
    const bound = depthBounds(entity);
    entity.depth = Math.min(Math.max(value, bound.min), bound.max);
    const slot = entityBag(entity)?.[TYPE_BY_ID[entity.type].depthParam.u];
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
    if (entity.type === 'shape' && param.key === 'asset') reseedShapeAsset(entity);
    return true;
  }
  const gatesBefore = param.gate ? gateState(entity) : null;
  setPath(entity.params, param.key, value);
  const bag = entityBag(entity);
  if (bag && !entity.hidden) applyParam(bag, param, value, uniformCtx(entity));
  else if (bag) applyAll();
  if (gatesBefore !== null && gateState(entity) !== gatesBefore) scheduleRebuild();
  return true;
}

function readControl(node, param) {
  if (param.kind === 'link') return node.getAttribute('aria-pressed') === 'true' ? 1 : 0;
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
  /* A checkbox's native input event is composed, so it escapes the shadow root
     ahead of the component reflecting its `checked` attribute: read that early
     and every toggle reports the state it just left. Only change is truthful. */
  if (event.type === 'input' && node.localName === 'jelly-checkbox') return;
  const key = node.dataset.key;
  const entity = selectedEntity();

  if (node.closest('#scene-params')) {
    const param = SCENE_PARAMS.find((p) => p.key === key);
    if (!param) return;
    const value = readControl(node, param);
    const values = param.scene ? scene : scene.grading;
    const moved = values[key] !== value;
    values[key] = value;
    updateReadout(node, param, value);
    if (param.scene) host.setEvolutionRate(value);
    else if (host.uniforms) applyParam(host.uniforms, param, value, {});
    /* A build gate (the lensing warp, its sub-halo count) changes the compose
       graph, so it cannot be poked; it has to go back through a rebuild. */
    if (param.structural) scheduleRebuild();
    /* A gate also decides which rows exist, and the repaint drops the node the
       event came from, so focus is re-seated by key. */
    if (moved && gateKeys('scene').has(key)) {
      renderSceneParams();
      dom.sceneParams.querySelector(`[data-role="param"][data-key="${key}"]`)?.focus();
    }
    host.requestRender();
    markDirty();
    return;
  }

  if (!entity) return;
  const param = key === DEPTH_PARAM.key ? DEPTH_PARAM : findParam(TYPE_BY_ID[entity.type], key);
  if (!param) return;
  const value = readControl(node, param);
  if (!commitParam(entity, param, value, event.type === 'input')) return;
  /* A control that writes its neighbors' state, or gates whether they show at
     all, has to repaint them; the repaint destroys the focused node, so focus
     is re-seated by key. */
  if (param.refresh || gateKeys(entity.type).has(key)) {
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
  const gatesBefore = gateState(entity);
  let structural = false;
  /* A derived enum owns its dependent flags: the dice pick one of its presets
     instead of rolling the flags raw, or most rolls land on states no preset
     expresses (including an all-off invisible entity). */
  const owner = spec.params.find((p) => p.group === group && p.derived && p.options);
  for (const param of spec.params) {
    if (param.group !== group || param.derived || param.noRoll) continue;
    if (owner && param.key.startsWith(`${owner.key}.`)) continue;
    const value = rollValue(param);
    setPath(entity.params, param.key, value);
    if (param.structural) structural = true;
  }
  if (owner) {
    owner.write(entity.params, owner.options[Math.floor(Math.random() * owner.options.length)].id);
    structural = true;
  }
  applyAll();
  if (structural || gateState(entity) !== gatesBefore) scheduleRebuild();
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
  if (!host.uniforms) return;
  const sky = { uniforms: host.uniforms, instances: host.instances };
  for (const { entity, k } of instanceRows()) {
    const slot = TYPE_BY_ID[entity.type].depthParam?.u;
    const bag = bagFor(sky, entity.type, k);
    if (slot && bag[slot]) bag[slot].value = entity.depth;
  }
  host.requestRender();
}

/* Dragging one copy past another of its own type permutes which engine bag
   belongs to which row, and only a rebuild re-seats them. A cross-type move
   cannot change any instance index, so it stays a live depth poke. */
function afterReorder(message, swapped = false) {
  if (swapped) scheduleRebuild();
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
    for (const { entity, k } of instanceRows()) {
      if (entity.lock) continue;
      entity.seed = entitySeed(seed, entity.type, k);
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

/* Autosave

   A crash used to cost the whole session, so the live scene goes to its own
   slot on a timer. It is never the Save button's slot and it never touches the
   dirty dot: this is a crash net, not a save. */

function autosave(force = false) {
  if (!host.ready || (document.hidden && !force)) return;
  try {
    localStorage.setItem(STORE_AUTO, JSON.stringify(currentPreset()));
  } catch (err) {
    console.warn('Firmament: autosave failed.', err);
  }
}

/* Without a flush the net is only as good as the last tick; pagehide is the one
   teardown event bfcache does not skip, and hiding usually precedes the close. */
window.addEventListener('pagehide', () => autosave(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) autosave(true);
});

function readAutosave() {
  try {
    return JSON.parse(localStorage.getItem(STORE_AUTO) ?? 'null');
  } catch {
    return null;
  }
}

/* The seed stays in the URL so a sky in progress is still shareable */
function syncSeedUrl() {
  params.set('seed', String(scene.seed));
  history.replaceState(null, '', `?${params}`);
}

async function adoptPreset(raw, source) {
  const { scene: next, warnings } = deserialize(raw);
  scene = next;
  ui.selected = null;
  resolveSelection();
  host.setTime(0);
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

/* The studio tray

   Hover and keyboard focus both open it through CSS alone, so the only jobs
   here are keeping aria-expanded honest and giving a coarse pointer, which has
   no hover to give, a tap that latches it open. */
function wireHud() {
  const coarse = window.matchMedia('(hover: none)');

  const syncHud = () => {
    const open = dom.hud.classList.contains('is-open')
      || dom.hud.matches(':hover, :focus-within');
    dom.hudTab.setAttribute('aria-expanded', String(open));
  };
  /* Read after the event settles: :focus-within still matches during focusout */
  const sync = () => requestAnimationFrame(syncHud);
  for (const type of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) {
    dom.hud.addEventListener(type, sync);
  }

  /* A tap is the touch stand-in for hover, and Safari does not focus a button on
     one, so the latch cannot lean on :focus-within. The pointer type is read as
     well as the media query: a hybrid laptop reports hover and still gets taps. */
  let tapped = false;
  dom.hudTab.addEventListener('pointerdown', (event) => {
    tapped = event.pointerType === 'touch' || event.pointerType === 'pen';
  });
  dom.hudTab.addEventListener('click', () => {
    const latch = coarse.matches || tapped;
    tapped = false;
    if (!latch) return;
    dom.hud.classList.toggle('is-open');
    syncHud();
  });
  dom.hud.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    dom.hud.classList.remove('is-open');
    /* Focusing the tab would leave :focus-within matching and hold the tray
       open, so focus leaves the hud entirely instead. */
    document.activeElement?.blur?.();
    syncHud();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!dom.hud.classList.contains('is-open') || dom.hud.contains(event.target)) return;
    dom.hud.classList.remove('is-open');
    syncHud();
  });

  dom.flyHome.addEventListener('click', (event) => {
    if (!ui.dirty) return;
    const go = window.confirm('This sky has unsaved changes. Fly home anyway?');
    if (!go) event.preventDefault();
  });

  dom.dock.addEventListener('change', () => {
    const next = dom.dock.getAttribute('value');
    if ((next !== 'start' && next !== 'end') || next === ui.dock) return;
    ui.dock = next;
    applyDock();
    saveUi();
  });

  dom.alpha.addEventListener('input', () => {
    const value = Number(dom.alpha.value);
    if (!Number.isFinite(value)) return;
    ui.panelAlpha = clampAlpha(value);
    applyPanelAlpha();
  });
  /* Stored on release, not per drag tick */
  dom.alpha.addEventListener('change', saveUi);
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
    for (const { entity, k } of instanceRows()) {
      if (entity.lock) continue;
      entity.seed = entitySeed(next, entity.type, k);
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
    if (host.uniforms) { applyPalette(host.uniforms); applyAll(); }
    renderSceneParams();
    host.requestRender();
    markDirty();
  });

  dom.theme.addEventListener('change', () => {
    ui.theme = readSelect(dom.theme);
    applyTheme();
    saveUi();
  });

  wireHud();

  dom.sceneParams.addEventListener('input', onParamEvent);
  dom.sceneParams.addEventListener('change', onParamEvent);
  dom.detail.addEventListener('input', onParamEvent);
  dom.detail.addEventListener('change', onParamEvent);

  dom.detail.addEventListener('click', (event) => {
    /* The chain toggle is a button, so its state flip happens here and the
       commit rides the same change path every other control uses. */
    const link = event.target.closest('button.link-btn[data-role="param"]');
    if (link) {
      const on = link.getAttribute('aria-pressed') !== 'true';
      link.setAttribute('aria-pressed', on ? 'true' : 'false');
      link.innerHTML = on ? CHAIN_ON : CHAIN_OFF;
      link.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const entity = selectedEntity();
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
      say(`${labelFor(entity)} reseeded.`);
      return;
    }
    if (button.dataset.act === 'remove') {
      const name = labelFor(entity);
      /* The row that slid up into the gap takes the selection, so removing a
         middle copy does not throw the panel back to the top of the list. */
      const at = sortEntities(scene.entities).indexOf(entity);
      scene.entities = scene.entities.filter((e) => e !== entity);
      normalizeOrder(scene.entities);
      const rest = sortEntities(scene.entities);
      selectEntity(rest[Math.min(at, rest.length - 1)] ?? null);
      rebuildNow().catch(reportBootFailure);
      renderAll();
      markDirty();
      say(`${name} removed.`);
    }
  });

  dom.detail.addEventListener('animationend', (event) => {
    event.target.closest?.('.is-rolling')?.classList.remove('is-rolling');
  });

  dom.detail.addEventListener('toggle', (e) => {
    const entity = selectedEntity();
    if (entity) rememberGroup(scopeKey(entity), e.target);
  }, true);
  dom.sceneParams.addEventListener('toggle', (e) => rememberGroup('scene', e.target), true);

  dom.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const entity = entityAt(button.dataset.type, Number(button.dataset.k));
    if (!entity) return;
    if (button.dataset.act === 'select') {
      selectEntity(entity);
      renderEntityList();
      renderEntityDetail();
      saveUi();
      return;
    }
    if (button.dataset.act === 'visible') {
      entity.hidden = !entity.hidden;
      applyAll();
      /* A structural mute key cannot be poked, so hiding the band would leave
         its rift extinction in the graph at full strength. Rebuild instead. */
      if (mutesStructural(entity.type)) scheduleRebuild();
      host.requestRender();
      renderEntityList();
      if (entity === ui.selected) renderEntityDetail();
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
    const from = Number(grip.dataset.k);
    const entity = entityAt(grip.dataset.type, from);
    if (!moveEntity(scene.entities, entity, delta)) return;
    /* The move can trade letters with the row it passed, so focus chases the
       entity's new index rather than the one the grip was rendered with. */
    const to = instanceIndex(entity);
    afterReorder(`${labelFor(entity)} moved ${delta < 0 ? 'farther' : 'nearer'}.`, to !== from);
    dom.list.querySelector(`[data-act="grip"][data-type="${entity.type}"][data-k="${to}"]`)?.focus();
  });

  /* Firefox can float a native drag ghost off a flung slider; only the entity
     list legitimately drags, so everything else in the panel refuses to */
  dom.panel.addEventListener('dragstart', (event) => {
    if (!event.target.closest?.('#entity-list')) event.preventDefault();
  });

  dom.list.addEventListener('dragstart', (event) => {
    const row = event.target.closest?.('li.entity');
    if (!row || TYPE_BY_ID[row.dataset.type]?.pinned) { event.preventDefault(); return; }
    dragEntity = entityAt(row.dataset.type, Number(row.dataset.k));
    if (!dragEntity) { event.preventDefault(); return; }
    /* Firefox will not start a drag without a payload on the transfer */
    event.dataTransfer.setData('text/plain', dragEntity.type);
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('is-dragging');
  });

  dom.list.addEventListener('dragover', (event) => {
    const row = event.target.closest?.('li.entity');
    if (!dragEntity || !row || TYPE_BY_ID[row.dataset.type]?.pinned) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const node of dom.list.children) node.classList.toggle('is-over', node === row);
  });

  dom.list.addEventListener('drop', (event) => {
    const row = event.target.closest?.('li.entity');
    if (!dragEntity || !row) return;
    event.preventDefault();
    const entity = dragEntity;
    const index = Number(row.dataset.index);
    const from = instanceIndex(entity);
    dragEntity = null;
    if (placeEntity(scene.entities, entity, index)) {
      afterReorder(`${labelFor(entity)} moved to position ${index + 1}.`, instanceIndex(entity) !== from);
    } else {
      clearDragMarks();
    }
  });

  /* Fires after drop, and on a canceled drag where drop never does */
  dom.list.addEventListener('dragend', () => {
    dragEntity = null;
    clearDragMarks();
  });

  dom.list.addEventListener('change', (event) => {
    const box = event.target.closest?.('[data-act="lock"]');
    if (!box) return;
    const entity = entityAt(box.dataset.type, Number(box.dataset.k));
    if (!entity) return;
    entity.lock = box.hasAttribute('checked');
    /* Marked on the row rather than through a repaint, which would replace the
       checkbox the user just clicked and drop its focus */
    box.closest('li.entity')?.classList.toggle('is-locked', entity.lock);
    markDirty();
  });

  dom.adders.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act="add"]');
    if (!button) return;
    const type = button.dataset.type;
    const k = typeCount(type);
    if (k >= instanceCap(type)) return;
    /* The copy's seed derives off its own index, so B never renders as A */
    const entity = makeEntity(type, scene.seed, null, k);
    scene.entities.push(entity);
    normalizeOrder(scene.entities);
    selectEntity(entity);
    rebuildNow().catch(reportBootFailure);
    renderAll();
    markDirty();
    say(`${labelFor(entity)} added.`);
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
  /* Pointing at the global dice paints its scope onto the list, which is the
     only place the padlocks say what they actually exempt a row from */
  const scope = (on) => dom.list.classList.toggle('is-scoping', on);
  dom.reroll.addEventListener('pointerenter', () => scope(true));
  dom.reroll.addEventListener('pointerleave', () => scope(false));
  dom.reroll.addEventListener('focusin', () => scope(true));
  dom.reroll.addEventListener('focusout', () => scope(false));
  el('save').addEventListener('click', savePreset);
  el('load').addEventListener('click', loadPreset);
  el('export').addEventListener('click', exportPreset);
  el('import').addEventListener('click', () => dom.file.click());
  dom.file.addEventListener('change', () => importFile(dom.file.files?.[0]));

  setInterval(syncTransport, 250);
}

/* Boot */

/* Boot precedence: an autosave wins, because it is the session the user was in
   the middle of. An explicit ?seed that disagrees with it wins over that: the
   URL always carries the current seed, so only a pasted, different one is a
   real request for another sky. */
/* Returns the restore's warnings, or null when nothing was restored: a restore
   that quietly dropped entities has to say so, exactly as a load does. */
function restoreAutosave() {
  const raw = readAutosave();
  if (!raw) return null;
  if (Number.isFinite(urlSeed) && urlSeed !== raw.seed) return null;
  try {
    const { scene: next, savedT, warnings } = deserialize(raw);
    scene = next;
    host.setTime(savedT);
    return warnings;
  } catch (err) {
    console.warn('Firmament: the autosave could not be read.', err);
    return null;
  }
}

async function boot() {
  loadUi();
  wire();
  applyTheme();
  applyDock();
  applyPanelAlpha();
  dom.tier.setAttribute('value', String(ui.tier));
  dom.dock.setAttribute('value', ui.dock);
  syncAlphaControl();
  const restored = restoreAutosave();
  if (restored) syncSeedUrl();
  if (ui.collapsed) {
    dom.panel.classList.add('is-collapsed');
    dom.panel.inert = true;
    dom.panelOpen.hidden = false;
    dom.panelClose.setAttribute('aria-expanded', 'false');
    dom.panelOpen.setAttribute('aria-expanded', 'false');
  }
  resolveSelection();
  renderAll();

  const sky2d = await import('/engine/render/sky2d.js');
  paletteRows = sky2d.PALETTES;

  await host.apply(buildEngineConfig(scene));
  const backend = host.backend === 'webgpu' ? 'WebGPU' : 'WebGL2';
  if (restored?.length) {
    say(`Restored your last sky: ${restored[0]}`, 'warn');
    if (restored.length > 1) console.warn('Firmament: autosave warnings.', restored);
  } else {
    say(restored ? `Restored your last sky. Rendering on ${backend}.` : `Rendering on ${backend}.`);
  }
  setInterval(autosave, AUTOSAVE_MS);
  syncPlayButton();
  if (host.frozen) say('Reduced motion is on: evolution is frozen. Scrub time by hand.');

  /* The dark veil has to visibly paint before it lifts, or boot reads as a pop */
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  dom.veil.classList.remove('is-dark');
  syncTransport();
}

boot().catch(reportBootFailure);
