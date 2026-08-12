//! The X thread: pointer polling and RandR changes into atomics, plus a condvar the
//! render loop waits on so an idle host still wakes within a frame of the first twitch.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{ConnectionExt as _, Window};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

use crate::occlusion::Occlusion;
use crate::x11::{read_monitors, select_monitor_events, select_property_events, Monitor, Rect};
use crate::Result;

const POLL_INTERVAL: Duration = Duration::from_micros(16_666);
// A root-property firehose must not starve pointer, coverage, or shutdown checks.
const MAX_EVENTS_PER_PASS: usize = 256;
// Substructure events arrive in bursts during drags; coalesce scans to this floor.
const SCAN_MIN_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Clone, Debug)]
pub struct Layout {
    pub span: Rect,
    pub monitors: Vec<Monitor>,
}

pub struct PointerState {
    packed: AtomicU64,
    respan: AtomicBool,
    covered: AtomicU64,
    layout: Mutex<Layout>,
    woken: Mutex<bool>,
    condvar: Condvar,
}

impl PointerState {
    pub fn new(span: Rect, monitors: Vec<Monitor>) -> Arc<PointerState> {
        Arc::new(PointerState {
            packed: AtomicU64::new(pack(0.0, 0.0)),
            respan: AtomicBool::new(false),
            covered: AtomicU64::new(0),
            layout: Mutex::new(Layout { span, monitors }),
            woken: Mutex::new(false),
            condvar: Condvar::new(),
        })
    }

    /// Bit `i` set means a window covers monitor `i`, indexed as `layout().monitors` is.
    pub fn covered(&self) -> u64 {
        self.covered.load(Ordering::Acquire)
    }

    /// Cursor position normalized to −1..1 across the span, as `sky.js` expects it.
    pub fn position(&self) -> (f32, f32) {
        unpack(self.packed.load(Ordering::Relaxed))
    }

    pub fn take_respan(&self) -> bool {
        self.respan.swap(false, Ordering::Acquire)
    }

    pub fn layout(&self) -> Layout {
        self.layout.lock().expect("layout lock poisoned").clone()
    }

    pub fn wait(&self, timeout: Duration) {
        let mut woken = self.woken.lock().expect("wake lock poisoned");
        if !*woken {
            let (guard, _) = self
                .condvar
                .wait_timeout(woken, timeout)
                .expect("wake lock poisoned");
            woken = guard;
        }
        *woken = false;
    }

    fn notify(&self) {
        let mut woken = self.woken.lock().expect("wake lock poisoned");
        *woken = true;
        self.condvar.notify_one();
    }
}

pub fn spawn(
    conn: Arc<RustConnection>,
    root: Window,
    own: Window,
    state: Arc<PointerState>,
    stop: &'static AtomicBool,
) -> JoinHandle<()> {
    thread::spawn(move || {
        if let Err(err) = poll(&conn, root, own, &state, stop) {
            eprintln!("Cosmorph: the X pointer thread stopped: {err}");
        }
    })
}

fn poll(
    conn: &RustConnection,
    root: Window,
    own: Window,
    state: &PointerState,
    stop: &AtomicBool,
) -> Result<()> {
    select_monitor_events(conn, root)?;
    select_property_events(conn, root)?;
    let occlusion = Occlusion::new(conn)?;
    let mut last = (i16::MIN, i16::MIN);
    // The desktop may already be buried when the host starts.
    let mut recheck_cover = true;
    let mut last_scan = std::time::Instant::now() - SCAN_MIN_INTERVAL;

    while !stop.load(Ordering::Relaxed) {
        let mut respanned = false;
        let mut drained = 0;
        while drained < MAX_EVENTS_PER_PASS {
            let Some(event) = conn.poll_for_event()? else { break };
            drained += 1;
            match event {
                Event::RandrNotify(_) | Event::RandrScreenChangeNotify(_) => respanned = true,
                Event::PropertyNotify(e) if e.window == root && occlusion.watches(e.atom) => {
                    recheck_cover = true
                }
                // Minimize/close/move change no root property; substructure fills that gap
                Event::UnmapNotify(_) | Event::MapNotify(_) | Event::DestroyNotify(_)
                | Event::ConfigureNotify(_) => recheck_cover = true,
                _ => {}
            }
        }
        // A hotplug can leave RandR momentarily unable to describe any monitor; that
        // must not end the thread, or parallax and every later respan die with it.
        let mut publish_respan = false;
        if respanned {
            match read_monitors(conn, root) {
                Ok((span, monitors)) => {
                    *state.layout.lock().expect("layout lock poisoned") = Layout { span, monitors };
                    publish_respan = true;
                    recheck_cover = true;
                }
                Err(err) => eprintln!("Cosmorph: ignoring an undescribable monitor change: {err}"),
            }
        }

        let mut mask_changed = false;
        if recheck_cover && (publish_respan || last_scan.elapsed() >= SCAN_MIN_INTERVAL) {
            recheck_cover = false;
            last_scan = std::time::Instant::now();
            let monitors: Vec<Rect> = state
                .layout
                .lock()
                .expect("layout lock poisoned")
                .monitors
                .iter()
                .map(|m| m.rect)
                .collect();
            match occlusion.scan(conn, root, own, &monitors) {
                Ok(mask) => mask_changed = state.covered.swap(mask, Ordering::Release) != mask,
                Err(err) => eprintln!("Cosmorph: could not read the window stack: {err}"),
            }
        }

        // The mask is rescanned against the new monitors before respan becomes visible,
        // so the render thread can never pair fresh indices with stale coverage bits.
        if publish_respan {
            state.respan.store(true, Ordering::Release);
            state.notify();
        } else if mask_changed {
            state.notify();
        }

        let pointer = conn.query_pointer(root)?.reply()?;
        // QueryPointer replies in whole device pixels, so any change already clears
        // SETTLE_PX (0.05) and no sub-threshold notify is possible.
        if (pointer.root_x, pointer.root_y) != last {
            last = (pointer.root_x, pointer.root_y);
            let span = state.layout.lock().expect("layout lock poisoned").span;
            if span.w > 0 && span.h > 0 {
                let x = normalize_axis(i32::from(pointer.root_x), span.x, span.w);
                let y = normalize_axis(i32::from(pointer.root_y), span.y, span.h);
                state.packed.store(pack(x, y), Ordering::Relaxed);
                state.notify();
            }
        }

        thread::sleep(POLL_INTERVAL);
    }
    Ok(())
}

fn normalize_axis(position: i32, start: i32, length: i32) -> f32 {
    let unit = ((position - start) as f32 / length as f32).clamp(0.0, 1.0);
    unit * 2.0 - 1.0
}

fn pack(x: f32, y: f32) -> u64 {
    (u64::from(x.to_bits()) << 32) | u64::from(y.to_bits())
}

fn unpack(packed: u64) -> (f32, f32) {
    (
        f32::from_bits((packed >> 32) as u32),
        f32::from_bits(packed as u32),
    )
}
