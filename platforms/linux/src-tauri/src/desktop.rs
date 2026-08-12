//! Drops the render window into the X11 desktop layer. Unlike Windows there is
//! a supported path: _NET_WM_WINDOW_TYPE_DESKTOP, which Muffin keeps at the bottom.

use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;

use gtk::prelude::*;
use gtk::{cairo, gdk};
use serde::Serialize;
use tauri::{Emitter, WebviewWindow};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::ConnectionExt;

const CURSOR_EVENT: &str = "cosmorph://cursor-position";
const CURSOR_POLL_INTERVAL: Duration = Duration::from_micros(33_333);
const X11_RECONNECT_DELAY: Duration = Duration::from_secs(1);

#[derive(Clone, Copy)]
struct DesktopBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

impl DesktopBounds {
    // QueryPointer replies in device pixels while GDK rectangles are application
    // pixels; X11 has one global scale, so publish device-pixel bounds.
    fn scaled(bounds: gdk::Rectangle, scale: i32) -> Self {
        Self {
            x: bounds.x() * scale,
            y: bounds.y() * scale,
            width: bounds.width() * scale,
            height: bounds.height() * scale,
        }
    }
}

#[derive(Clone, Copy, Serialize)]
struct CursorPosition {
    x: f64,
    y: f64,
}

/// Type-hint the window as a desktop, span every monitor, then let clicks fall through.
pub fn attach_to_desktop(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let gtk_win = window.gtk_window()?;

    let display = gdk::Display::default().ok_or("no GDK display")?;
    // Wayland ignores X type hints; that host needs gtk-layer-shell and does not exist yet.
    if display.type_().name() == "GdkWaylandDisplay" {
        return Err("Cosmorph's Linux host is X11-only for now".into());
    }

    // Must land before the first map; a mapped window re-hints unreliably across WMs.
    gtk_win.set_type_hint(gdk::WindowTypeHint::Desktop);
    gtk_win.stick();
    gtk_win.set_keep_below(true);
    gtk_win.set_accept_focus(false);
    gtk_win.set_skip_taskbar_hint(true);
    gtk_win.set_skip_pager_hint(true);

    let initial_bounds = span_monitors(&gtk_win, &display)?;
    let shared_bounds = Arc::new(RwLock::new(DesktopBounds::scaled(
        initial_bounds,
        gtk_win.scale_factor(),
    )));

    // Hotplug, rotation, or rearrangement mid-run would otherwise leave stale bounds.
    let screen = WidgetExt::screen(&gtk_win).ok_or("window has no GDK screen")?;
    let win = gtk_win.clone();
    let respan_display = display.clone();
    let respan_bounds = Arc::clone(&shared_bounds);
    screen.connect_monitors_changed(move |_| match span_monitors(&win, &respan_display) {
        Ok(bounds) => match respan_bounds.write() {
            Ok(mut current) => *current = DesktopBounds::scaled(bounds, win.scale_factor()),
            Err(_) => eprintln!("Cosmorph: cursor bounds lock was poisoned"),
        },
        Err(err) => eprintln!("Cosmorph: could not respan after a monitor change: {err}"),
    });

    // nemo-desktop's ARGB icon windows share the desktop layer; sink beneath them so
    // icons stay visible. Muffin restacks fresh maps on top, so lower on map, not at show.
    gtk_win.connect_map_event(|win, _| {
        if let Some(gdk_win) = win.window() {
            gdk_win.lower();
        }
        gtk::glib::Propagation::Proceed
    });

    window.show()?;

    // Empty input shape: clicks pass through to whatever owns the desktop below.
    gtk_win.input_shape_combine_region(Some(&cairo::Region::create()));
    start_cursor_poll(window.clone(), shared_bounds);
    Ok(())
}

/// Move and size the window to the union of every monitor's geometry.
fn span_monitors(
    gtk_win: &gtk::ApplicationWindow,
    display: &gdk::Display,
) -> Result<gdk::Rectangle, Box<dyn std::error::Error>> {
    let mut bounds: Option<gdk::Rectangle> = None;
    for i in 0..display.n_monitors() {
        if let Some(monitor) = display.monitor(i) {
            let geo = monitor.geometry();
            bounds = Some(match bounds {
                Some(b) => b.union(&geo),
                None => geo,
            });
        }
    }
    let bounds = bounds.ok_or("no monitors reported by GDK")?;
    gtk_win.move_(bounds.x(), bounds.y());
    gtk_win.resize(bounds.width(), bounds.height());
    Ok(bounds)
}

fn start_cursor_poll(window: WebviewWindow, bounds: Arc<RwLock<DesktopBounds>>) {
    thread::spawn(move || loop {
        if let Err(err) = poll_cursor(&window, &bounds) {
            eprintln!("Cosmorph: X11 cursor poll failed; reconnecting: {err}");
            thread::sleep(X11_RECONNECT_DELAY);
        }
    });
}

fn poll_cursor(
    window: &WebviewWindow,
    bounds: &RwLock<DesktopBounds>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (connection, screen_index) = x11rb::connect(None)?;
    let root = connection
        .setup()
        .roots
        .get(screen_index)
        .ok_or("X11 connection reported no default screen")?
        .root;

    // Emit failures log once per streak; at 30 Hz a persistent fault would flood otherwise.
    let mut emit_failing = false;
    loop {
        let pointer = connection.query_pointer(root)?.reply()?;
        let bounds = *bounds
            .read()
            .map_err(|_| "cursor bounds lock was poisoned")?;

        if bounds.width > 0 && bounds.height > 0 {
            let x = normalize_axis(i32::from(pointer.root_x), bounds.x, bounds.width);
            let y = normalize_axis(i32::from(pointer.root_y), bounds.y, bounds.height);
            match window.emit(CURSOR_EVENT, CursorPosition { x, y }) {
                Ok(()) => emit_failing = false,
                Err(err) => {
                    if !emit_failing {
                        eprintln!("Cosmorph: could not emit cursor position: {err}");
                    }
                    emit_failing = true;
                }
            }
        }

        thread::sleep(CURSOR_POLL_INTERVAL);
    }
}

fn normalize_axis(position: i32, start: i32, length: i32) -> f64 {
    let unit = (f64::from(position - start) / f64::from(length)).clamp(0.0, 1.0);
    unit * 2.0 - 1.0
}
