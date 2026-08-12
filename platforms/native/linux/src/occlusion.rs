//! Which monitors a window is covering, so the host can stop drawing them.
//!
//! Re-evaluated on the X thread when `_NET_CLIENT_LIST_STACKING`, `_NET_ACTIVE_WINDOW`,
//! or the RandR layout changes. Nothing here runs on the render thread.
//!
//! ponytail: those three are the only triggers, so a window moved or unmaximized without
//! also being raised leaves a stale mask. Select `SubstructureNotify` on the root, rate
//! limited, if that ever shows up as a frozen wallpaper.

use x11rb::cookie::Cookie;
use x11rb::errors::ConnectionError;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, GetPropertyReply, MapState, Window};
use x11rb::rust_connection::RustConnection;

use crate::x11::Rect;
use crate::Result;

/// A window has to tile a monitor to hide it, because the wallpaper shows through
/// any gap. Not 100%: a shadow, a rounded corner, or a one-pixel gutter is not a gap.
const COVER_FRACTION: f32 = 0.95;
/// Fullscreen or fully maximized is the window manager's own statement that the window
/// owns its monitor, so its geometry only has to land there rather than tile it.
const FLAGGED_FRACTION: f32 = 0.5;
/// A property read long enough for any `_NET_WM_STATE`/`_NET_WM_WINDOW_TYPE` list.
const ATOM_LIST_LEN: u32 = 64;

/// One candidate occluder: frame geometry in root coordinates, plus whether the window
/// manager marked it fullscreen or fully maximized.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Occluder {
    pub rect: Rect,
    pub flagged: bool,
}

fn span(a0: i32, a1: i32, b0: i32, b1: i32) -> i64 {
    i64::from(a1.min(b1) - a0.max(b0)).max(0)
}

/// How much of `monitor` the window's frame sits over, 0..1.
fn coverage(window: Rect, monitor: Rect) -> f32 {
    let area = i64::from(monitor.w) * i64::from(monitor.h);
    if area <= 0 {
        return 0.0;
    }
    let w = span(window.x, window.x + window.w, monitor.x, monitor.x + monitor.w);
    let h = span(window.y, window.y + window.h, monitor.y, monitor.y + monitor.h);
    (w * h) as f32 / area as f32
}

/// Bit `i` set means some window covers `monitors[i]`. Monitors past 63 never set a bit,
/// so they stay drawn.
///
/// ponytail: one window has to cover a monitor by itself; two tiled halves read as
/// uncovered. Accumulate a union region here if that ever costs real frames.
pub fn covered_mask(occluders: &[Occluder], monitors: &[Rect]) -> u64 {
    let mut mask = 0u64;
    for (index, monitor) in monitors.iter().take(64).enumerate() {
        let hidden = occluders.iter().any(|o| {
            let fraction = coverage(o.rect, *monitor);
            fraction >= COVER_FRACTION || (o.flagged && fraction >= FLAGGED_FRACTION)
        });
        if hidden {
            mask |= 1 << index;
        }
    }
    mask
}

pub struct Occlusion {
    client_list_stacking: u32,
    active_window: u32,
    wm_state: u32,
    hidden: u32,
    fullscreen: u32,
    maximized_vert: u32,
    maximized_horz: u32,
    window_type: u32,
    desktop: u32,
    dock: u32,
    frame_extents: u32,
}

impl Occlusion {
    pub fn new(conn: &RustConnection) -> Result<Occlusion> {
        let atom = |name: &str| -> Result<u32> {
            Ok(conn.intern_atom(false, name.as_bytes())?.reply()?.atom)
        };
        Ok(Occlusion {
            client_list_stacking: atom("_NET_CLIENT_LIST_STACKING")?,
            active_window: atom("_NET_ACTIVE_WINDOW")?,
            wm_state: atom("_NET_WM_STATE")?,
            hidden: atom("_NET_WM_STATE_HIDDEN")?,
            fullscreen: atom("_NET_WM_STATE_FULLSCREEN")?,
            maximized_vert: atom("_NET_WM_STATE_MAXIMIZED_VERT")?,
            maximized_horz: atom("_NET_WM_STATE_MAXIMIZED_HORZ")?,
            window_type: atom("_NET_WM_WINDOW_TYPE")?,
            desktop: atom("_NET_WM_WINDOW_TYPE_DESKTOP")?,
            dock: atom("_NET_WM_WINDOW_TYPE_DOCK")?,
            frame_extents: atom("_NET_FRAME_EXTENTS")?,
        })
    }

    /// The root properties whose change can alter what is covering what.
    pub fn watches(&self, atom: u32) -> bool {
        atom == self.client_list_stacking || atom == self.active_window
    }

    pub fn scan(
        &self,
        conn: &RustConnection,
        root: Window,
        own: Window,
        monitors: &[Rect],
    ) -> Result<u64> {
        let clients = conn
            .get_property(
                false,
                root,
                self.client_list_stacking,
                AtomEnum::WINDOW,
                0,
                u32::from(u16::MAX),
            )?
            .reply()?;
        let occluders: Vec<Occluder> = clients
            .value32()
            .into_iter()
            .flatten()
            .filter(|window| *window != own)
            .filter_map(|window| self.occluder(conn, root, window))
            .collect();
        Ok(covered_mask(&occluders, monitors))
    }

    /// `None` for anything that cannot hide the wallpaper, including a window that was
    /// destroyed mid-scan — its requests error, and a vanished window occludes nothing.
    fn occluder(&self, conn: &RustConnection, root: Window, window: Window) -> Option<Occluder> {
        // Every request goes out before the first reply is read, so a window costs one
        // round trip rather than six.
        let attributes = conn.get_window_attributes(window).ok()?;
        let geometry = conn.get_geometry(window).ok()?;
        let translated = conn.translate_coordinates(window, root, 0, 0).ok()?;
        let state = self
            .list(conn, window, self.wm_state, AtomEnum::ATOM, ATOM_LIST_LEN)
            .ok()?;
        let kind = self
            .list(conn, window, self.window_type, AtomEnum::ATOM, ATOM_LIST_LEN)
            .ok()?;
        let extents = self
            .list(conn, window, self.frame_extents, AtomEnum::CARDINAL, 4)
            .ok()?;

        if attributes.reply().ok()?.map_state != MapState::VIEWABLE {
            return None;
        }
        let geometry = geometry.reply().ok()?;
        let translated = translated.reply().ok()?;
        let state = values(state);
        let kind = values(kind);
        let extents = values(extents);

        let has = |list: &[u32], atom: u32| list.contains(&atom);
        if has(&state, self.hidden) || has(&kind, self.desktop) || has(&kind, self.dock) {
            return None;
        }

        // Decorations occlude too, so the frame is the client rect grown by the extents
        // the window manager reports; a window without them reports none.
        let (left, right, top, bottom) = match extents[..] {
            [l, r, t, b] => (l as i32, r as i32, t as i32, b as i32),
            _ => (0, 0, 0, 0),
        };
        let border = i32::from(geometry.border_width);
        let rect = Rect {
            x: i32::from(translated.dst_x) - left - border,
            y: i32::from(translated.dst_y) - top - border,
            w: i32::from(geometry.width) + left + right + 2 * border,
            h: i32::from(geometry.height) + top + bottom + 2 * border,
        };
        let flagged = has(&state, self.fullscreen)
            || (has(&state, self.maximized_vert) && has(&state, self.maximized_horz));
        Some(Occluder { rect, flagged })
    }

    fn list<'c>(
        &self,
        conn: &'c RustConnection,
        window: Window,
        property: u32,
        ty: AtomEnum,
        len: u32,
    ) -> std::result::Result<Cookie<'c, RustConnection, GetPropertyReply>, ConnectionError> {
        conn.get_property(false, window, property, ty, 0, len)
    }
}

/// A missing or wrong-typed property reads as no values, which is what an absent
/// `_NET_WM_STATE` or `_NET_FRAME_EXTENTS` means anyway.
fn values(cookie: Cookie<'_, RustConnection, GetPropertyReply>) -> Vec<u32> {
    match cookie.reply() {
        Ok(reply) => reply.value32().into_iter().flatten().collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LANDSCAPE: Rect = Rect { x: 0, y: 0, w: 2560, h: 1440 };
    const PORTRAIT: Rect = Rect { x: 5120, y: 0, w: 1440, h: 2560 };

    fn plain(x: i32, y: i32, w: i32, h: i32) -> Occluder {
        Occluder { rect: Rect { x, y, w, h }, flagged: false }
    }

    #[test]
    fn the_threshold_is_ninety_five_percent_of_the_monitor() {
        // 2560x1368 = 95.0% exactly; one row less misses.
        assert_eq!(covered_mask(&[plain(0, 0, 2560, 1368)], &[LANDSCAPE]), 1);
        assert_eq!(covered_mask(&[plain(0, 0, 2560, 1367)], &[LANDSCAPE]), 0);
        // Off-monitor entirely, and covering a neighbor instead.
        assert_eq!(covered_mask(&[plain(2560, 0, 2560, 1440)], &[LANDSCAPE]), 0);
    }

    #[test]
    fn a_rotated_portrait_monitor_uses_its_own_area() {
        // A dock along the bottom leaves 2432 of 2560 rows = 95%.
        assert_eq!(covered_mask(&[plain(5120, 0, 1440, 2432)], &[PORTRAIT]), 1);
        assert_eq!(covered_mask(&[plain(5120, 0, 1440, 2431)], &[PORTRAIT]), 0);
        // A landscape-shaped window that would tile a landscape panel does not tile this one.
        assert_eq!(covered_mask(&[plain(5120, 0, 2560, 1440)], &[PORTRAIT]), 0);
    }

    #[test]
    fn a_flagged_window_only_has_to_land_on_its_monitor() {
        let maximized = Occluder { rect: Rect { x: 0, y: 40, w: 2560, h: 1200 }, flagged: true };
        // 83% of the panel: under the geometric bar, over the flagged one.
        assert_eq!(covered_mask(&[maximized], &[LANDSCAPE]), 1);
        assert_eq!(covered_mask(&[Occluder { flagged: false, ..maximized }], &[LANDSCAPE]), 0);
        // Flagged is not a free pass: a window mostly off this monitor still leaves it visible.
        let elsewhere = Occluder { rect: Rect { x: 2200, y: 0, w: 2560, h: 1440 }, flagged: true };
        assert_eq!(covered_mask(&[elsewhere], &[LANDSCAPE]), 0);
    }

    #[test]
    fn each_monitor_gets_its_own_bit_from_whichever_window_covers_it() {
        let monitors = [LANDSCAPE, Rect { x: 2560, y: 0, w: 2560, h: 1440 }, PORTRAIT];
        let windows = [
            plain(-8, -8, 2576, 1456),
            plain(2560, 0, 400, 300),
            Occluder { rect: Rect { x: 5120, y: 0, w: 1440, h: 2560 }, flagged: true },
        ];
        assert_eq!(covered_mask(&windows, &monitors), 0b101);

        // Two windows tiling one monitor is the documented ceiling: neither covers alone.
        let halves = [plain(0, 0, 1280, 1440), plain(1280, 0, 1280, 1440)];
        assert_eq!(covered_mask(&halves, &[LANDSCAPE]), 0);
    }

    #[test]
    fn monitors_past_the_mask_width_stay_drawn() {
        let monitors = vec![LANDSCAPE; 70];
        let covering = plain(0, 0, 2560, 1440);
        assert_eq!(covered_mask(&[covering], &monitors), u64::MAX);
    }
}
