//! Frame pacing, pure. Burst while the pointer is live, twinkle rate while it
//! idles, near-stop when nothing moves at all, heartbeat when nothing is visible.

pub const BURST_MS: f64 = 1000.0 / 60.0;
pub const TWINKLE_MS: f64 = 1000.0 / 30.0;
pub const STATIC_MS: f64 = 500.0;
pub const HEARTBEAT_MS: f64 = 1000.0;
pub const STILL_MS: f64 = 1000.0;
pub const SETTLE_PX: f32 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Burst,
    Twinkling,
    Static,
    /// Every monitor is behind a window. The host draws nothing at all here.
    Occluded,
}

impl State {
    pub fn interval_ms(self) -> f64 {
        match self {
            State::Burst => BURST_MS,
            State::Twinkling => TWINKLE_MS,
            State::Static => STATIC_MS,
            State::Occluded => HEARTBEAT_MS,
        }
    }

    pub fn draws(self) -> bool {
        !matches!(self, State::Occluded)
    }
}

/// Occlusion outranks everything: a pointer moving over the window that covers the
/// last monitor still reveals nothing, and the uncover transition bursts to catch up.
pub fn state(
    now_ms: f64,
    last_input_ms: f64,
    settled: bool,
    twinkling: bool,
    occluded: bool,
) -> State {
    if occluded {
        State::Occluded
    } else if now_ms - last_input_ms < STILL_MS || !settled {
        State::Burst
    } else if twinkling {
        State::Twinkling
    } else {
        State::Static
    }
}

pub fn settled(cursor: (f32, f32), target: (f32, f32)) -> bool {
    (target.0 - cursor.0).hypot(target.1 - cursor.1) <= SETTLE_PX
}

#[derive(Debug, Clone, Copy)]
pub struct Pacer {
    last_frame_ms: f64,
}

impl Pacer {
    pub fn new(now_ms: f64) -> Pacer {
        Pacer {
            last_frame_ms: now_ms,
        }
    }

    pub fn last_frame_ms(&self) -> f64 {
        self.last_frame_ms
    }

    /// Call after rendering at `now_ms`; returns the next frame's deadline. The
    /// remainder carry is what makes a capped cadence average its true rate.
    pub fn next_deadline(&mut self, now_ms: f64, cap_ms: f64) -> f64 {
        let cap = if cap_ms > 0.0 { cap_ms } else { BURST_MS };
        self.last_frame_ms = now_ms - (now_ms - self.last_frame_ms) % cap;
        self.last_frame_ms + cap
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_covers_live_input_and_unsettled_damping() {
        assert_eq!(state(1500.0, 900.0, true, true, false), State::Burst);
        assert_eq!(state(5000.0, 0.0, false, true, false), State::Burst);
        assert_eq!(state(5000.0, 0.0, true, true, false), State::Twinkling);
        assert_eq!(state(5000.0, 0.0, true, false, false), State::Static);
    }

    #[test]
    fn a_fully_covered_span_heartbeats_whatever_else_is_happening() {
        for (settled, twinkling) in [(true, true), (false, true), (true, false), (false, false)] {
            let occluded = state(1500.0, 1499.0, settled, twinkling, true);
            assert_eq!(occluded, State::Occluded);
            assert_eq!(occluded.interval_ms(), HEARTBEAT_MS);
            assert!(!occluded.draws());
        }
        assert!(state(5000.0, 0.0, true, true, false).draws());
    }

    #[test]
    fn settle_threshold_is_the_hypotenuse() {
        assert!(settled((0.0, 0.0), (0.03, 0.03)));
        assert!(!settled((0.0, 0.0), (0.0, 0.06)));
    }

    #[test]
    fn a_late_frame_carries_its_remainder() {
        let mut pacer = Pacer::new(0.0);
        assert_eq!(pacer.next_deadline(250.0, 100.0), 300.0);
        assert_eq!(pacer.last_frame_ms(), 200.0);
    }
}
