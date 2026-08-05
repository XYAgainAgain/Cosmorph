/* Engine lifecycle: WebGPU→WebGL2 boot, frame cap, evolution clock, rebuilds.
   A rebuild drops the old canvas only after the new one's first frame lands. */

/* 0 = uncapped: the editor renders at panel refresh; caps belong to wallpaper hosts */
const FRAME_MS = 0;
const MAX_THROW = 14; // css px of cursor parallax at full deflection
/* Matches engine/core/evolution.js: keeps shader time inside float32 */
const T_WRAP = 4096 * 3600;

export function createSkyHost({ mount, forceGL = false }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let sky = null;
  let canvasEl = null;
  let rafId = 0;
  let onceId = 0;
  let lastFrame = 0;
  let lastNow = 0;
  let disposed = false;
  let evolutionRate = 1;
  let afterBuild = null;
  let onMotion = null;

  let queued = null;
  let chain = Promise.resolve();
  let capturing = false;

  const target = { x: 0, y: 0 };
  const cursor = { x: 0, y: 0 };
  /* clock.playing is the effective state; wantsPlay is what the user asked for,
     so turning reduced motion off restores their choice instead of forcing play */
  let wantsPlay = true;
  const clock = {
    baseT: 0, anchor: performance.now(), speed: 1, playing: !reduceMotion.matches,
  };

  function timeSeconds() {
    if (!clock.playing) return clock.baseT % T_WRAP;
    const elapsed = ((performance.now() - clock.anchor) / 1000) * clock.speed;
    return (clock.baseT + elapsed) % T_WRAP;
  }

  const tev = () => (timeSeconds() / 3600) * evolutionRate;

  /* Every clock mutation rebases under the OLD state before switching, so T
     stays savedT + (now − anchor) and never jumps across a pause or a speed
     change. Reading timeSeconds() after the flip would lose the elapsed time. */
  function rebase(playing = clock.playing) {
    clock.baseT = timeSeconds();
    clock.anchor = performance.now();
    clock.playing = playing;
  }

  function sizeToMount() {
    if (!sky) return false;
    const rect = mount.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    sky.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    return true;
  }

  function drawFrame() {
    if (!sky) return;
    sky.render(tev(), cursor.x, cursor.y);
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (now - lastFrame < FRAME_MS) return;
    const dt = Math.min((now - lastNow) / 1000, 0.25);
    lastFrame = now;
    lastNow = now;

    /* Exponential damping toward the pointer, framerate-independent */
    const k = 1 - Math.exp(-dt * 3.5);
    cursor.x += (target.x - cursor.x) * k;
    cursor.y += (target.y - cursor.y) * k;

    drawFrame();
  }

  function start() {
    if (rafId || !sky || disposed || reduceMotion.matches) return;
    lastFrame = 0;
    lastNow = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* Single coalesced repaint, for edits made while the loop is parked */
  function requestRender() {
    if (rafId || onceId || !sky || disposed) return;
    onceId = requestAnimationFrame(() => {
      onceId = 0;
      drawFrame();
    });
  }

  function freshCanvas() {
    const c = document.createElement('canvas');
    c.className = 'sky__canvas';
    c.setAttribute('aria-hidden', 'true');
    mount.append(c);
    return c;
  }

  /* A canvas holds one context type for life, so each attempt gets its own */
  async function create(config) {
    const { createSky2D } = await import('/engine/render/sky2d.js');
    if (!forceGL) {
      const c = freshCanvas();
      try {
        return { sky: await createSky2D({ canvas: c, config, maxParallaxPx: MAX_THROW }), canvas: c };
      } catch (err) {
        console.warn('Firmament: WebGPU path failed, retrying on WebGL2.', err);
        c.remove();
      }
    }
    const c = freshCanvas();
    try {
      const made = await createSky2D({ canvas: c, config, forceWebGL: true, maxParallaxPx: MAX_THROW });
      return { sky: made, canvas: c };
    } catch (err) {
      c.remove();
      throw err;
    }
  }

  async function build(config) {
    const made = await create(config);
    if (disposed) {
      made.sky.dispose();
      made.canvas.remove();
      return;
    }

    const prevSky = sky;
    const prevCanvas = canvasEl;
    sky = made.sky;
    canvasEl = made.canvas;
    evolutionRate = config.evolution?.rate ?? 1;

    sizeToMount();
    afterBuild?.(sky);
    drawFrame();

    prevSky?.dispose();
    prevCanvas?.remove();
    start();
  }

  /* Coalescing queue: rapid structural edits collapse to one rebuild, and
     every caller's await settles after the build that superseded theirs. */
  function apply(config) {
    queued = config;
    chain = chain.then(async () => {
      const cfg = queued;
      if (!cfg || disposed) return;
      queued = null;
      await build(cfg);
    });
    return chain;
  }

  let resizeTimer = 0;
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      /* An export resizes the renderer out from under the mount on purpose */
      if (capturing || !sizeToMount()) return;
      /* resize() re-seats aspect-scaled framed positions from build-time
         params, so live overrides have to go back on after it */
      afterBuild?.(sky);
      requestRender();
    }, 120);
  });
  observer.observe(mount);

  function onPointerMove(e) {
    if (reduceMotion.matches) return;
    target.x = ((e.clientX / window.innerWidth) * 2 - 1) * MAX_THROW;
    target.y = ((e.clientY / window.innerHeight) * 2 - 1) * MAX_THROW;
  }
  mount.addEventListener('pointermove', onPointerMove, { passive: true });

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }
  document.addEventListener('visibilitychange', onVisibility);

  const onMotionChange = () => {
    rebase(wantsPlay && !reduceMotion.matches);
    if (clock.playing) start();
    else { stop(); requestRender(); }
    onMotion?.();
  };
  reduceMotion.addEventListener('change', onMotionChange);

  return {
    apply,
    start,
    stop,
    requestRender,
    resize: () => { if (sizeToMount()) requestRender(); },
    get uniforms() { return sky?.uniforms ?? null; },
    /* Per-instance bags, which is where a loaded shape asset's credit rides */
    get instances() { return sky?.instances ?? null; },
    get backend() { return sky?.backend ?? null; },
    get ready() { return sky !== null; },
    get frozen() { return reduceMotion.matches; },
    setCamera(x, y) {
      sky?.setCamera(x, y);
      requestRender();
    },
    /* Renders one frame at an exact pixel size and hands back RGBA bytes. The
       loop is parked first so nothing paints the export framing to the canvas. */
    async capture(width, height) {
      if (!sky) throw new Error('The engine is not running.');
      capturing = true;
      stop();
      cancelAnimationFrame(onceId);
      onceId = 0;
      try {
        return await sky.capture({
          width, height, tev: tev(), onResize: () => afterBuild?.(sky),
        });
      } finally {
        capturing = false;
        sizeToMount();
        afterBuild?.(sky);
        drawFrame();
        start();
      }
    },
    /* Called after every build and every resize to re-seat live overrides */
    set onApplyUniforms(fn) { afterBuild = fn; },
    get timeSeconds() { return timeSeconds(); },
    get speed() { return clock.speed; },
    get playing() { return clock.playing; },
    /* Fires when the reduced-motion preference flips, so the host page can
       re-sync its transport controls */
    set onMotionPreference(fn) { onMotion = fn; },
    setTime(seconds) {
      clock.baseT = Math.max(0, seconds) % T_WRAP;
      clock.anchor = performance.now();
      requestRender();
    },
    setSpeed(mult) {
      rebase();
      clock.speed = mult;
    },
    setPlaying(on) {
      wantsPlay = on;
      rebase(on && !reduceMotion.matches);
      if (clock.playing) start();
      else requestRender();
    },
    dispose() {
      disposed = true;
      stop();
      cancelAnimationFrame(onceId);
      clearTimeout(resizeTimer);
      observer.disconnect();
      mount.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      reduceMotion.removeEventListener('change', onMotionChange);
      sky?.dispose();
      canvasEl?.remove();
      sky = null;
      canvasEl = null;
    },
  };
}
