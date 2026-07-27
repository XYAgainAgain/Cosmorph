/* Evolution clock: T = savedT + (now − sessionStart), persisted across sessions.
   Never accumulate frame deltas; they drift and jitter at wallpaper frame rates. */
/* Wrap keeps shader time domains inside float32 precision; one visible
   re-seed of the drift every ~170 days is the accepted cost. */
const T_WRAP = 4096 * 3600;

/* A seed change means a new storage key, which is what resets T to 0 */
export function createEvolutionClock(storageKey) {
  let savedT = 0;
  try {
    const stored = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored >= 0) savedT = stored % T_WRAP;
  } catch { /* storage blocked: run session-only */ }

  const sessionStart = performance.now();

  /* Seconds of accumulated evolution time */
  const now = () => (savedT + (performance.now() - sessionStart) / 1000) % T_WRAP;

  function persist() {
    try { localStorage.setItem(storageKey, String(now())); } catch { /* ditto */ }
  }

  return { now, persist };
}
