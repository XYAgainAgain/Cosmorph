//! Raw-X desktop-layer window: the GTK `desktop.rs` recipe, property for property.
//!
//! Golden diff against `.dev/patches/native-host/xprop-golden.txt` (captured from the
//! Tauri host): `_NET_WM_WINDOW_TYPE`, `_NET_WM_STATE`, and `_NET_WM_DESKTOP` must match
//! it exactly, atom order included. Only two differences are understood and expected:
//! `WM_HINTS` reads `input: False` here and carries no GTK icon or group-leader fields,
//! and `WM_PROTOCOLS` lists only `WM_DELETE_WINDOW` where GTK advertised four.
//! Stacking acceptance is being **first** in `_NET_CLIENT_LIST_STACKING` (bottom-most).

use std::env;
use std::sync::Arc;

use x11rb::connection::{Connection, RequestConnection};
use x11rb::protocol::randr::{self, NotifyMask};
use x11rb::protocol::shape::{self, ConnectionExt as _, SK, SO};
use x11rb::protocol::xproto::{
    AtomEnum, ChangeWindowAttributesAux, ClipOrdering, ColormapAlloc, ConfigureWindowAux,
    ConnectionExt as _, CreateWindowAux, EventMask, PropMode, StackMode, Window, WindowClass,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;

use crate::Result;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    fn union(self, other: Rect) -> Rect {
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        let right = (self.x + self.w).max(other.x + other.w);
        let bottom = (self.y + self.h).max(other.y + other.h);
        Rect { x, y, w: right - x, h: bottom - y }
    }
}

/// A RandR monitor: its rect in root coordinates, and the name RandR gives it, which
/// is what a cover or uncover line has to say out loud.
#[derive(Clone, Debug)]
pub struct Monitor {
    pub rect: Rect,
    pub name: String,
}

/// X type hints are ignored under Wayland, and GDK reports `GdkX11Display` under
/// Xwayland, so the environment is the only honest check.
pub fn refuse_wayland() -> Result<()> {
    let wayland = env::var_os("WAYLAND_DISPLAY").is_some()
        || env::var("XDG_SESSION_TYPE").map(|v| v == "wayland").unwrap_or(false);
    if wayland {
        return Err("Cosmorph's Linux host is X11-only for now".into());
    }
    Ok(())
}

pub struct DesktopWindow {
    pub conn: Arc<RustConnection>,
    pub root: Window,
    pub window: Window,
    pub span: Rect,
    pub monitors: Vec<Monitor>,
}

impl DesktopWindow {
    /// Creates the window unmapped, on the visual EGL named, with every property the
    /// window manager reads set before the first map.
    pub fn create(visual_id: u32) -> Result<DesktopWindow> {
        let (conn, screen_num) = RustConnection::connect(None)?;
        let setup = conn.setup().clone();
        let screen = setup
            .roots
            .get(screen_num)
            .ok_or("X11 connection reported no default screen")?;
        let root = screen.root;

        if conn.extension_information(shape::X11_EXTENSION_NAME)?.is_none() {
            return Err("the X server has no SHAPE extension, so clicks could not pass through".into());
        }
        if conn.extension_information(randr::X11_EXTENSION_NAME)?.is_none() {
            return Err("the X server has no RANDR extension, so the monitor span is unknowable".into());
        }

        let depth = setup
            .roots
            .get(screen_num)
            .and_then(|s| {
                s.allowed_depths
                    .iter()
                    .find(|d| d.visuals.iter().any(|v| v.visual_id == visual_id))
            })
            .map(|d| d.depth)
            .ok_or_else(|| format!("EGL named visual 0x{visual_id:x}, which this screen does not offer"))?;
        if depth != 24 {
            return Err(format!(
                "EGL's visual 0x{visual_id:x} is {depth}-bit; a 32-bit ARGB visual would make the \
                 compositor alpha-blend the wallpaper"
            )
            .into());
        }

        let (span, monitors) = read_monitors(&conn, root)?;

        let colormap = conn.generate_id()?;
        conn.create_colormap(ColormapAlloc::NONE, colormap, root, visual_id)?;

        let window = conn.generate_id()?;
        conn.create_window(
            depth,
            window,
            root,
            span.x as i16,
            span.y as i16,
            span.w as u16,
            span.h as u16,
            0,
            WindowClass::INPUT_OUTPUT,
            visual_id,
            &CreateWindowAux::new()
                .background_pixel(0)
                .border_pixel(0)
                .colormap(colormap)
                .event_mask(EventMask::STRUCTURE_NOTIFY),
        )?;

        let win = DesktopWindow { conn: Arc::new(conn), root, window, span, monitors };
        win.set_properties()?;
        win.conn.flush()?;
        Ok(win)
    }

    fn set_properties(&self) -> Result<()> {
        let conn = &*self.conn;
        let atom = |name: &str| -> Result<u32> {
            Ok(conn.intern_atom(false, name.as_bytes())?.reply()?.atom)
        };

        let window_type = atom("_NET_WM_WINDOW_TYPE")?;
        let desktop_type = atom("_NET_WM_WINDOW_TYPE_DESKTOP")?;
        conn.change_property32(
            PropMode::REPLACE,
            self.window,
            window_type,
            AtomEnum::ATOM,
            &[desktop_type],
        )?;

        // Written in the golden's order so the xprop diff stays empty.
        let state = atom("_NET_WM_STATE")?;
        let states = [
            atom("_NET_WM_STATE_SKIP_PAGER")?,
            atom("_NET_WM_STATE_SKIP_TASKBAR")?,
            atom("_NET_WM_STATE_BELOW")?,
            atom("_NET_WM_STATE_STICKY")?,
        ];
        conn.change_property32(PropMode::REPLACE, self.window, state, AtomEnum::ATOM, &states)?;

        let desktop = atom("_NET_WM_DESKTOP")?;
        conn.change_property32(
            PropMode::REPLACE,
            self.window,
            desktop,
            AtomEnum::CARDINAL,
            &[0xFFFF_FFFF],
        )?;

        // flags = InputHint | StateHint, input = False, initial state Normal; GTK's
        // icon and group-leader fields are deliberately absent.
        conn.change_property32(
            PropMode::REPLACE,
            self.window,
            AtomEnum::WM_HINTS,
            AtomEnum::WM_HINTS,
            &[3, 0, 1, 0, 0, 0, 0, 0, 0],
        )?;

        let protocols = atom("WM_PROTOCOLS")?;
        let delete_window = atom("WM_DELETE_WINDOW")?;
        conn.change_property32(
            PropMode::REPLACE,
            self.window,
            protocols,
            AtomEnum::ATOM,
            &[delete_window],
        )?;
        Ok(())
    }

    /// Maps and returns once the map has landed. Called before the pointer thread
    /// exists, so nothing else can drain the MapNotify this waits on.
    pub fn map(&self) -> Result<()> {
        self.conn.map_window(self.window)?;
        self.conn.flush()?;
        loop {
            match self.conn.wait_for_event()? {
                Event::MapNotify(event) if event.window == self.window => break,
                _ => {}
            }
        }
        Ok(())
    }

    /// Sinks beneath `nemo-desktop`'s icon windows. Only works after the map lands:
    /// the window manager restacks fresh maps on top, so lowering earlier does nothing.
    pub fn lower(&self) -> Result<()> {
        self.conn.configure_window(
            self.window,
            &ConfigureWindowAux::new().stack_mode(StackMode::BELOW),
        )?;
        self.conn.flush()?;
        Ok(())
    }

    /// The server's own view of the window, for confirming a configure landed. A reply
    /// rather than an event, so the pointer thread's event drain cannot swallow it.
    pub fn size(&self) -> Result<(i32, i32)> {
        let geometry = self.conn.get_geometry(self.window)?.reply()?;
        Ok((i32::from(geometry.width), i32::from(geometry.height)))
    }

    /// Requests the new span after a RandR change. Nothing is drawn until
    /// `main::acknowledged_span` sees both X and EGL agree on the result.
    pub fn set_geometry(&self, span: Rect) -> Result<()> {
        self.conn.configure_window(
            self.window,
            &ConfigureWindowAux::new()
                .x(span.x)
                .y(span.y)
                .width(span.w as u32)
                .height(span.h as u32),
        )?;
        self.conn.flush()?;
        Ok(())
    }

    /// Empty input region: clicks fall through to whatever owns the desktop below.
    pub fn apply_input_shape(&self) -> Result<()> {
        self.conn.shape_rectangles(
            SO::SET,
            SK::INPUT,
            ClipOrdering::UNSORTED,
            self.window,
            0,
            0,
            &[],
        )?;
        self.conn.flush()?;
        Ok(())
    }
}

/// Span and per-monitor rects in device pixels, honoring `xrandr --setmonitor`.
pub fn read_monitors(conn: &RustConnection, root: Window) -> Result<(Rect, Vec<Monitor>)> {
    let reply = randr::get_monitors(conn, root, true)?.reply()?;
    let mut monitors = Vec::with_capacity(reply.monitors.len());
    for m in &reply.monitors {
        let rect = Rect {
            x: i32::from(m.x),
            y: i32::from(m.y),
            w: i32::from(m.width),
            h: i32::from(m.height),
        };
        if rect.w <= 0 || rect.h <= 0 {
            continue;
        }
        // An unnameable monitor is still a monitor; only the log line suffers.
        let name = conn
            .get_atom_name(m.name)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .map(|reply| String::from_utf8_lossy(&reply.name).into_owned())
            .unwrap_or_else(|| format!("monitor {}", monitors.len()));
        monitors.push(Monitor { rect, name });
    }
    let span = monitors
        .iter()
        .map(|m| m.rect)
        .reduce(Rect::union)
        .ok_or("RandR reported no active monitors")?;
    Ok((span, monitors))
}

/// Root property changes announce stacking/active-window moves; substructure events
/// catch what they miss (a minimize unmaps without touching either root property).
pub fn select_property_events(conn: &RustConnection, root: Window) -> Result<()> {
    conn.change_window_attributes(
        root,
        &ChangeWindowAttributesAux::new()
            .event_mask(EventMask::PROPERTY_CHANGE | EventMask::SUBSTRUCTURE_NOTIFY),
    )?;
    conn.flush()?;
    Ok(())
}

pub fn select_monitor_events(conn: &RustConnection, root: Window) -> Result<()> {
    randr::select_input(
        conn,
        root,
        NotifyMask::SCREEN_CHANGE | NotifyMask::CRTC_CHANGE | NotifyMask::OUTPUT_CHANGE,
    )?;
    conn.flush()?;
    Ok(())
}
