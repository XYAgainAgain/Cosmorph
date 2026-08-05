/* Debug HUD + hotkeys, loaded by sky.js only under ?debug=1.
   [C] toggles baked/live; plane rows flash when a rebake lands. */

let api = null;
let hud = null;
let prevFrames = 0;
let prevT = 0;
let fps = 0;
const prevPlaneBakes = {};
const flashUntil = {};

function line(text, cls = '') {
  const el = document.createElement('span');
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function planeRow(p, stats, now) {
  const n = stats?.planeBakes?.[p.name] ?? 0;
  if (p.name in prevPlaneBakes && n !== prevPlaneBakes[p.name]) {
    flashUntil[p.name] = now + 900;
  }
  prevPlaneBakes[p.name] = n;
  const flash = now < (flashUntil[p.name] ?? 0);
  return line(
    `${p.name.padEnd(8)} d ${p.depth.toFixed(2)} · rate ${p.score.toFixed(2)} · bakes ${n}`,
    flash ? 'is-flash' : '',
  );
}

function update() {
  const state = api.getState();
  const now = performance.now();
  const dt = (now - prevT) / 1000;
  if (dt > 0) fps = (state.drawnFrames - prevFrames) / dt;
  prevFrames = state.drawnFrames;
  prevT = now;

  const idleFps = (1000 / state.idleMs).toFixed(0);
  const hz = state.refreshHz ? state.refreshHz.toFixed(0) : '…';
  const rows = [
    line(`${state.mode} · ${state.backend ?? '—'} · ${fps.toFixed(1)} fps`, 'is-mode'),
    line(`cadence ${state.bursting ? 'BURST' : 'idle'} · idle ${idleFps} fps · panel ${hz} Hz`),
    line(`twinkle ${state.twinkle ? 'on' : 'off'} · [C] baked/live`),
    ...state.planes.map((p) => planeRow(p, state.stats, now)),
  ];
  if (state.stats) rows.push(line(`bakes ${state.stats.bakes} · composites ${state.stats.frames}`));
  hud.replaceChildren(...rows);
}

function onKey(e) {
  if (e.key.toLowerCase() !== 'c') return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const t = e.target;
  if (t instanceof HTMLElement
    && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
  api.toggleMode();
}

export function initDebug(hostApi) {
  api = hostApi;
  hud = document.createElement('div');
  hud.className = 'debug-hud';
  document.body.append(hud);
  prevT = performance.now();
  window.addEventListener('keydown', onKey);
  setInterval(update, 250);
  update();
}
