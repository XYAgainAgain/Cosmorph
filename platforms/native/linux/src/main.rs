//! Boot order, the frame loop, and shutdown for the desktop wallpaper host.

mod egl;
mod occlusion;
mod pointer;
mod state;
mod x11;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use cosmorph_native_core::bundle::Bundle;
use cosmorph_native_core::cadence::{self, Pacer, State};
use cosmorph_native_core::clock::Clock;
use cosmorph_native_core::frame::{Engine, FrameInput, Rect};
use glow::HasContext;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

const USAGE: &str = "cosmorph-wallpaper [options]
  --bundle <path>       bundle.json, or the directory holding it (default: beside the binary)
  --throw <css px>      cursor parallax at full deflection (default: the scene's)
  --dpr <ratio>         device pixel ratio (default: $GDK_SCALE, else 1)
  --swap-interval <n>   eglSwapInterval (default 0: the compositor owns the flip)
  --bake-bands <n>      spread each plane's rebake across n frames (default 1)
  --bench               print frame times, bake counts, and cadence on exit";

/// Matches `site/sky.js`: framerate-independent exponential damping, and a dt clamp
/// so a stalled frame cannot teleport the parallax.
const DAMPING: f32 = 3.5;
const MAX_DT: f64 = 0.25;
const PERSIST_MS: f64 = 60_000.0;
/// Every dumped value is harvested at DPR 1, so a pinned member is true only there.
const DUMP_DPR: f32 = 1.0;
/// Far past any real frame: a fence still unsignaled here means a wedged GPU, and
/// waiting forever would take the shutdown path with it.
const FENCE_TIMEOUT_NS: i32 = 1_000_000_000;
/// ~4.6 hours of 60 Hz samples. A bench run is minutes; this only stops a forgotten
/// `--bench` from growing without bound.
const BENCH_SAMPLES: usize = 1_000_000;
/// A respan is two asynchronous acknowledgements deep (window manager, then driver).
/// Long enough for a slow hotplug, short enough that a stuck one still redraws.
const RESPAN_ACK_TIMEOUT: Duration = Duration::from_millis(500);
const RESPAN_ACK_POLL: Duration = Duration::from_millis(4);
/// Golden and silver ratios, matching `TWINKLE_RATES` in sky2d.js: irrational
/// multiples of the base rate never re-align, so the scintillation never loops.
const TWINKLE_RATES: [f64; 3] = [1.0, 1.618_033_988_7, 2.414_213_562_4];

fn main() {
    if let Err(err) = run() {
        eprintln!("cosmorph-wallpaper: {err}");
        std::process::exit(1);
    }
}

#[derive(Debug)]
struct Args {
    bundle: Option<PathBuf>,
    throw: Option<f32>,
    dpr: Option<f32>,
    swap_interval: Option<i32>,
    bake_bands: u32,
    bench: bool,
}

fn parse_args() -> Result<Args> {
    parse(std::env::args().skip(1).collect())
}

fn parse(argv: Vec<String>) -> Result<Args> {
    let value = |i: usize| -> Result<&String> {
        argv.get(i + 1)
            .ok_or_else(|| format!("{} needs a value", argv[i]).into())
    };

    let mut args = Args {
        bundle: None,
        throw: None,
        dpr: None,
        swap_interval: None,
        bake_bands: 1,
        bench: false,
    };
    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--bundle" => args.bundle = Some(PathBuf::from(value(i)?)),
            "--throw" => args.throw = Some(value(i)?.parse()?),
            "--dpr" => args.dpr = Some(value(i)?.parse()?),
            "--swap-interval" => args.swap_interval = Some(value(i)?.parse()?),
            "--bake-bands" => args.bake_bands = value(i)?.parse()?,
            "--bench" => {
                args.bench = true;
                i += 1;
                continue;
            }
            "--help" | "-h" => {
                println!("{USAGE}");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument '{other}'\n{USAGE}").into()),
        }
        i += 2;
    }

    if let Some(dpr) = args.dpr {
        if !(dpr.is_finite() && dpr > 0.0) {
            return Err(format!("--dpr {dpr} is not a positive number").into());
        }
    }
    if let Some(throw) = args.throw {
        if !(throw.is_finite() && throw >= 0.0) {
            return Err(format!("--throw {throw} is not a distance in pixels").into());
        }
    }
    if args.bake_bands == 0 {
        return Err("--bake-bands 0 would never finish a bake".into());
    }
    if args.swap_interval.is_some_and(|n| n < 0) {
        return Err("--swap-interval cannot be negative".into());
    }
    Ok(args)
}

/// `--bundle` accepts either the manifest or its directory; the install layout puts
/// both files beside the binary.
fn bundle_paths(arg: Option<&Path>) -> Result<(PathBuf, PathBuf)> {
    let dir = match arg {
        Some(path) if path.extension().is_some_and(|e| e == "json") => path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."))
            .to_path_buf(),
        Some(path) => path.to_path_buf(),
        None => std::env::current_exe()?
            .parent()
            .ok_or("this binary has no directory to hold a bundle")?
            .to_path_buf(),
    };
    Ok((dir.join("bundle.json"), dir.join("bundle.bin")))
}

fn dpr_from_env() -> f32 {
    std::env::var("GDK_SCALE")
        .ok()
        .and_then(|raw| raw.trim().parse::<f32>().ok())
        .filter(|dpr| dpr.is_finite() && *dpr > 0.0)
        .unwrap_or(1.0)
}

fn span_rect(r: x11::Rect) -> Rect {
    Rect { x: r.x, y: r.y, w: r.w, h: r.h }
}

/// Bit per monitor rect, all set. Rects past 63 are always drawn, so they never
/// contribute a bit and can never make the span read as fully covered.
fn rect_mask(count: usize) -> u64 {
    if count >= 64 {
        u64::MAX
    } else {
        (1u64 << count) - 1
    }
}

fn log_cover_changes(monitors: &[x11::Monitor], was: u64, now: u64) {
    for (index, monitor) in monitors.iter().take(64).enumerate() {
        let bit = 1u64 << index;
        if (was ^ now) & bit != 0 {
            let verb = if now & bit != 0 { "covered" } else { "uncovered" };
            println!("Cosmorph: {} {verb}", monitor.name);
        }
    }
}

/// The active rects' scissors, flattened into the `x, y, w, h` quads EGL wants.
fn damage_rects(scissors: &[(i32, i32, i32, i32)], active: u64) -> Vec<i32> {
    scissors
        .iter()
        .enumerate()
        .filter(|(index, _)| *index >= 64 || active & (1 << index) != 0)
        .flat_map(|(_, (x, y, w, h))| [*x, *y, *w, *h])
        .collect()
}

/// Blocks until X's configure and EGL's surface both match the new span; polls
/// `GetGeometry`, not `ConfigureNotify`, which the pointer thread would eat first.
fn acknowledged_span(window: &x11::DesktopWindow, display: &egl::Egl, span: x11::Rect) -> Result<Rect> {
    window.set_geometry(span)?;
    let deadline = Instant::now() + RESPAN_ACK_TIMEOUT;
    loop {
        let server = window.size()?;
        // Round-trips the Xlib connection EGL was opened on, so the driver has seen the
        // same configure before its surface is measured.
        display.sync();
        let surface = display.surface_size()?;
        if server == (span.w, span.h) && surface == (span.w, span.h) {
            return Ok(span_rect(span));
        }
        if Instant::now() >= deadline {
            eprintln!(
                "Cosmorph: the respan to {}x{} was not acknowledged (X {}x{}, EGL {}x{}); \
                 drawing at the surface's size instead",
                span.w, span.h, server.0, server.1, surface.0, surface.1
            );
            return Ok(Rect { x: span.x, y: span.y, w: surface.0, h: surface.1 });
        }
        std::thread::sleep(RESPAN_ACK_POLL);
    }
}

fn run() -> Result<()> {
    let args = parse_args()?;
    x11::refuse_wayland()?;
    let shutdown = state::install_signal_handlers();
    let dpr = args.dpr.unwrap_or_else(dpr_from_env);

    let (manifest_path, blob_path) = bundle_paths(args.bundle.as_deref())?;
    let manifest = fs::read(&manifest_path)
        .map_err(|e| format!("could not read {}: {e}", manifest_path.display()))?;
    let blobs =
        fs::read(&blob_path).map_err(|e| format!("could not read {}: {e}", blob_path.display()))?;

    // Parsed before a single X call so a bad bundle costs no window.
    let bundle = Bundle::load(&manifest, blobs.clone())?;
    println!("cosmorph-wallpaper: {bundle:?}");
    let scene = &bundle.manifest.scene;
    let pinned = &bundle.manifest.dpr_pinned;
    if !pinned.is_empty() && dpr != DUMP_DPR {
        return Err(format!(
            "this bundle pins {} to DPR {DUMP_DPR}, so it cannot run at DPR {dpr}; re-run the dumper",
            pinned.join(", ")
        )
        .into());
    }
    let clock_key = scene.clock_key.clone();
    let evolution_rate = scene.evolution_rate;
    let twinkle_rate = scene.twinkle_rate;
    let twinkling = scene.twinkle_active && scene.twinkle_rate > 0.0;
    let throw = args.throw.unwrap_or(scene.max_parallax_px);
    if throw > scene.max_parallax_px {
        eprintln!(
            "Cosmorph: --throw {throw} exceeds the {} px the bakes were margined for; \
             the span edges will sample past the overscan",
            scene.max_parallax_px
        );
    }
    let resumed = state::load(&clock_key);
    let clock = Clock::new(resumed.unwrap_or(scene.saved_t));
    println!(
        "evolution {} at {:.2} s, key {clock_key}",
        if resumed.is_some() { "resumed" } else { "seeded from savedT" },
        clock.saved_t()
    );
    drop(bundle);

    let mut display = egl::Egl::open()?;
    let window = x11::DesktopWindow::create(display.visual_id())?;
    println!(
        "span {}x{} at ({}, {}) across {} monitors",
        window.span.w,
        window.span.h,
        window.span.x,
        window.span.y,
        window.monitors.len()
    );

    // The window must exist server-side before EGL binds its XID.
    display.sync();
    display.create_surface(window.window)?;
    if let Some(interval) = args.swap_interval {
        display.set_swap_interval(interval)?;
    }

    let gl = display.load_gl();
    let mut engine = unsafe { Engine::new(&gl, &manifest, &blobs) }?;
    if args.bake_bands > 1 {
        engine.set_bands(args.bake_bands);
    }
    let mut layout = pointer::Layout {
        span: window.span,
        monitors: window.monitors.clone(),
    };
    let mut rects: Vec<Rect> = layout.monitors.iter().map(|m| span_rect(m.rect)).collect();
    unsafe { engine.resize(&gl, span_rect(layout.span), &rects, dpr) }?;

    let session = Instant::now();
    let warm = FrameInput {
        tev: clock.tev(0.0, evolution_rate),
        twinkle_phase: [0.0; 3],
        parallax: [0.0, 0.0],
        active_rects: FrameInput::ALL_RECTS,
    };
    unsafe { engine.warm_start(&gl, warm) }?;

    // Presented twice: drivers that accept an unmapped swap show it before the map;
    // drivers that no-op that swap need the post-map one instead.
    if let Err(err) = display.swap_buffers() {
        eprintln!("Cosmorph: the pre-map present was refused ({err}); the post-map one carries it");
    }
    // A swap leaves the back buffer undefined. warm_start left no plane dirty, so this
    // redraw is the compose pass alone.
    unsafe { engine.render(&gl, warm) }?;

    // Empty before the map, so there is no instant in which the wallpaper eats a click.
    window.apply_input_shape()?;
    window.map()?;
    display.swap_buffers()?;
    window.lower()?;

    let pointer_state = pointer::PointerState::new(window.span, window.monitors.clone());
    let poller = pointer::spawn(
        Arc::clone(&window.conn),
        window.root,
        window.window,
        Arc::clone(&pointer_state),
        shutdown,
    );

    let mut target = (0.0f32, 0.0f32);
    let mut cursor = (0.0f32, 0.0f32);
    let mut last_input_ms = 0.0f64;
    let mut last_now_ms = 0.0f64;
    let mut last_persist_ms = 0.0f64;
    let mut covered = 0u64;
    // The pre-map frames were presented whole; the first loop frame is too, because a
    // resume or a respan leaves the compositor holding a stale copy of the whole span.
    let mut full_damage = true;
    // One burst interval in the past, so the first frame is due the moment the
    // window maps rather than a cap later.
    let mut pacer = Pacer::new(-cadence::BURST_MS);
    let mut frame_ms: Vec<f64> = Vec::new();
    let mut cadence_counts = [0u64; 4];

    // One closure so a mid-loop failure still lands on the orderly teardown below:
    // the clock is persisted, the GL objects go, and EGL outlives the X connection.
    let outcome = (|| -> Result<()> {
        while !shutdown.load(Ordering::Relaxed) {
            let now_ms = session.elapsed().as_secs_f64() * 1000.0;

            let (nx, ny) = pointer_state.position();
            let next = (nx * throw, ny * throw);
            if (next.0 - target.0).hypot(next.1 - target.1) > cadence::SETTLE_PX {
                last_input_ms = now_ms;
            }
            target = next;

            // Ahead of the cadence gate, and counted as input: a respan dirties every
            // plane, and rebaking them at the 2 Hz idle rate would take a second and a half.
            if pointer_state.take_respan() {
                layout = pointer_state.layout();
                rects = layout.monitors.iter().map(|m| span_rect(m.rect)).collect();
                let span = acknowledged_span(&window, &display, layout.span)?;
                unsafe { engine.resize(&gl, span, &rects, dpr) }?;
                last_input_ms = now_ms;
                full_damage = true;
                // Monitor indices moved, so the old mask names nothing; re-adopt silently.
                covered = pointer_state.covered() & rect_mask(rects.len());
            }

            // Counted as input too: an uncover has to burst to damp the parallax back to
            // wherever the pointer went while nothing was being drawn.
            let now_covered = pointer_state.covered() & rect_mask(rects.len());
            if now_covered != covered {
                log_cover_changes(&layout.monitors, covered, now_covered);
                covered = now_covered;
                last_input_ms = now_ms;
                full_damage = true;
            }
            let active = !covered & rect_mask(rects.len());
            let occluded = !rects.is_empty() && active == 0;

            let cadence_state = cadence::state(
                now_ms,
                last_input_ms,
                cadence::settled(cursor, target),
                twinkling,
                occluded,
            );
            let due = pacer.last_frame_ms() + cadence_state.interval_ms();
            if now_ms < due {
                // Re-evaluated on every wake: a twitch during an idle wait promotes the
                // cadence to burst, which pulls the deadline into the past.
                pointer_state.wait(Duration::from_secs_f64((due - now_ms) / 1000.0));
                continue;
            }

            let dt = ((now_ms - last_now_ms) / 1000.0).clamp(0.0, MAX_DT);
            last_now_ms = now_ms;
            pacer.next_deadline(now_ms, cadence_state.interval_ms());

            let k = 1.0 - (-dt as f32 * DAMPING).exp();
            cursor.0 += (target.0 - cursor.0) * k;
            cursor.1 += (target.1 - cursor.1) * k;

            let elapsed_s = now_ms / 1000.0;
            // Nothing is on screen while occluded, so the heartbeat only advances the
            // clock and re-reads the state. The planes stay baked, so a resume is instant.
            if cadence_state.draws() {
                let input = FrameInput {
                    tev: clock.tev(elapsed_s, evolution_rate),
                    // Session time, not tev: twinkle is atmospheric, so a fast evolution
                    // rate must not speed it up.
                    twinkle_phase: twinkle_phase(elapsed_s, twinkle_rate),
                    parallax: [cursor.0 * dpr, cursor.1 * dpr],
                    active_rects: active,
                };
                unsafe { engine.render(&gl, input) }?;
                if full_damage {
                    display.swap_buffers()?;
                    full_damage = false;
                } else {
                    display.swap_damaged(&damage_rects(engine.scissors(), active))?;
                }

                // One frame queued ahead at most; with eglSwapInterval(0) this fence is
                // the only thing keeping the software cadence honest.
                let fence = unsafe { gl.fence_sync(glow::SYNC_GPU_COMMANDS_COMPLETE, 0) }?;
                unsafe {
                    gl.client_wait_sync(fence, glow::SYNC_FLUSH_COMMANDS_BIT, FENCE_TIMEOUT_NS);
                    gl.delete_sync(fence);
                }
            }

            if args.bench {
                cadence_counts[match cadence_state {
                    State::Burst => 0,
                    State::Twinkling => 1,
                    State::Static => 2,
                    State::Occluded => 3,
                }] += 1;
                if frame_ms.len() < BENCH_SAMPLES {
                    frame_ms.push(session.elapsed().as_secs_f64() * 1000.0 - now_ms);
                }
            }

            if now_ms - last_persist_ms >= PERSIST_MS {
                last_persist_ms = now_ms;
                persist(&clock, &clock_key, elapsed_s);
            }
        }
        Ok(())
    })();

    persist(&clock, &clock_key, session.elapsed().as_secs_f64());
    if args.bench {
        report(&mut frame_ms, cadence_counts, &engine);
    }

    shutdown.store(true, Ordering::Relaxed);
    let _ = poller.join();
    unsafe { engine.delete(&gl) };
    // EGL resources must go before the connection that owns the window they bind.
    drop(display);
    outcome
}

/// Each octave wraps on its own, exactly as `tickTwinkle()` does: wrapping one
/// phase and scaling it in the shader would jump at every wrap.
fn twinkle_phase(elapsed_s: f64, rate: f32) -> [f32; 3] {
    let t = elapsed_s / 3600.0 * rate as f64;
    TWINKLE_RATES.map(|r| ((t * r) % 1.0) as f32)
}

/// A failed write costs continuity, never the session: the wallpaper keeps running.
fn persist(clock: &Clock, key: &str, elapsed_s: f64) {
    if let Err(err) = state::save(key, clock.now(elapsed_s)) {
        eprintln!("Cosmorph: could not persist the evolution clock: {err}");
    }
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[(((sorted.len() - 1) as f64) * q).round() as usize]
}

fn report(frame_ms: &mut [f64], cadence_counts: [u64; 4], engine: &Engine) {
    frame_ms.sort_by(f64::total_cmp);
    println!(
        "frames {}  p50 {:.2} ms  p95 {:.2} ms  p99 {:.2} ms  max {:.2} ms",
        frame_ms.len(),
        percentile(frame_ms, 0.50),
        percentile(frame_ms, 0.95),
        percentile(frame_ms, 0.99),
        percentile(frame_ms, 1.0)
    );
    println!(
        "cadence: burst {}, twinkling {}, static {}, occluded {}",
        cadence_counts[0], cadence_counts[1], cadence_counts[2], cadence_counts[3]
    );
    let bakes: Vec<String> = engine
        .bundle()
        .manifest
        .planes
        .iter()
        .zip(engine.bake_counts())
        .map(|(plane, count)| format!("{} {count}", plane.name))
        .collect();
    println!("bakes: {}", bakes.join(", "));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(line: &str) -> Vec<String> {
        line.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn flags_with_values_survive_a_bare_flag_between_them() {
        let args = parse(argv("--dpr 1 --bench --bake-bands 4 --throw 25")).unwrap();
        assert_eq!(args.dpr, Some(1.0));
        assert_eq!(args.bake_bands, 4);
        assert_eq!(args.throw, Some(25.0));
        assert!(args.bench);
        assert!(parse(argv("--dpr")).is_err(), "a value-less flag has to name itself");
        assert!(parse(argv("--dpr 0")).is_err());
        assert!(parse(argv("--bake-bands 0")).is_err());
        assert!(parse(argv("--nonsense")).is_err());
    }

    #[test]
    fn the_bundle_path_takes_a_manifest_or_its_directory() {
        let from_file = bundle_paths(Some(Path::new("/opt/cosmorph/bundle.json"))).unwrap();
        let from_dir = bundle_paths(Some(Path::new("/opt/cosmorph"))).unwrap();
        assert_eq!(from_file, from_dir);
        assert_eq!(from_file.1, PathBuf::from("/opt/cosmorph/bundle.bin"));
        assert_eq!(
            bundle_paths(Some(Path::new("bundle.json"))).unwrap().0,
            PathBuf::from("./bundle.json")
        );
    }

    #[test]
    fn damage_carries_only_the_rects_still_being_drawn() {
        assert_eq!(rect_mask(0), 0);
        assert_eq!(rect_mask(3), 0b111);
        assert_eq!(rect_mask(64), u64::MAX);
        assert_eq!(rect_mask(70), u64::MAX);

        let scissors = [(0, 1120, 2560, 1440), (2560, 1120, 2560, 1440), (5120, 0, 1440, 2560)];
        // Middle panel covered: its quad drops out and the other two keep their order.
        assert_eq!(
            damage_rects(&scissors, 0b101),
            vec![0, 1120, 2560, 1440, 5120, 0, 1440, 2560]
        );
        assert!(damage_rects(&scissors, 0).is_empty());
    }

    #[test]
    fn percentiles_index_the_sorted_samples() {
        let samples = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(percentile(&samples, 0.5), 3.0);
        assert_eq!(percentile(&samples, 1.0), 5.0);
        assert_eq!(percentile(&[], 0.99), 0.0);
    }
}
