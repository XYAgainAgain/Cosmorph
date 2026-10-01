//! Rebake crossfades, mirroring `renderBaked` and its constants in sky2d.js: a plane keeps
//! its outgoing and incoming bakes as two layers and eases between them on wall time.

/// Blend floor after a scheduled rebake; also the length for spin-priced planes and while the rate is unknown.
pub const CROSSFADE_MS: f64 = 2000.0;
/// Longest blend: a slow morph earns a longer one, but past this the pause between dissolves is too slow to catch.
pub const FADE_MAX_MS: f64 = 12000.0;
/// Per-frame cap, so a long stall resumes as a quick blend instead of a cut.
pub const MAX_FADE_STEP: f64 = 1.0 / 6.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlaneFade {
    /// Weight of the front layer; 1 means the back layer contributes nothing.
    pub weight: f64,
    pub front: usize,
    pub back: usize,
    start_ms: Option<f64>,
    duration_ms: f64,
}

impl Default for PlaneFade {
    fn default() -> PlaneFade {
        PlaneFade {
            weight: 1.0,
            front: 0,
            back: 1,
            start_ms: None,
            duration_ms: CROSSFADE_MS,
        }
    }
}

impl PlaneFade {
    pub fn active(&self) -> bool {
        self.start_ms.is_some()
    }

    /// The freshly baked back layer goes on screen at weight 0, which shows the
    /// outgoing layer alone, so the swap itself is invisible.
    pub fn begin(&mut self, wall_ms: f64, duration_ms: f64) {
        std::mem::swap(&mut self.front, &mut self.back);
        self.weight = 0.0;
        self.duration_ms = duration_ms.max(1.0);
        self.start_ms = Some(wall_ms);
    }

    /// A hard bake overwrites the front layer, so whatever was blending is moot.
    pub fn cancel(&mut self) {
        self.start_ms = None;
        self.weight = 1.0;
    }

    /// Smoothstep easing: a linear ramp starts and stops with a velocity kick,
    /// which reads as a tick when fades chain back-to-back.
    pub fn advance(&mut self, wall_ms: f64) {
        let Some(start) = self.start_ms else { return };
        let lin = ((wall_ms - start) / self.duration_ms).clamp(0.0, 1.0);
        let target = lin * lin * (3.0 - 2.0 * lin);
        // The floor only matters if the host's clock steps backward; the blend never reverses.
        self.weight = (self.weight + MAX_FADE_STEP).min(target).min(1.0).max(self.weight);
        if self.weight >= 1.0 {
            self.start_ms = None;
        }
    }
}

/// Fade over the plane's predicted time-to-stale, so the next bake lands as the
/// blend finishes. Spin-priced planes go stale on displacement, not on tev, so they take the floor.
pub fn duration_ms(score: f32, tev_per_ms: f64, spins: bool) -> f64 {
    if spins || tev_per_ms <= 0.0 || score <= 0.0 {
        return CROSSFADE_MS;
    }
    let stale_ms = crate::scheduler::REBAKE_EPS / (score as f64 * tev_per_ms);
    stale_ms.clamp(CROSSFADE_MS, FADE_MAX_MS)
}

/// Evolution speed in tev per wall millisecond, measured frame to frame: the
/// engine only ever sees the tev values it is handed, never the host's rate.
#[derive(Debug, Clone, Copy, Default)]
pub struct TevRate {
    last: Option<(f64, f64)>,
    pub per_ms: f64,
}

impl TevRate {
    pub fn observe(&mut self, tev: f64, wall_ms: f64) {
        if let Some((last_tev, last_wall)) = self.last {
            if wall_ms > last_wall {
                self.per_ms = (tev - last_tev).abs() / (wall_ms - last_wall);
            }
        }
        self.last = Some((tev, wall_ms));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fade_swaps_layers_and_starts_on_the_outgoing_generation() {
        let mut fade = PlaneFade::default();
        fade.begin(1000.0, 4000.0);
        assert_eq!((fade.front, fade.back, fade.weight), (1, 0, 0.0));
        assert!(fade.active());
        fade.begin(9000.0, 4000.0);
        assert_eq!((fade.front, fade.back), (0, 1), "consecutive rebakes alternate layers");
    }

    #[test]
    fn weights_rise_monotonically_and_land_exactly_on_one() {
        let mut fade = PlaneFade::default();
        fade.begin(0.0, 3000.0);
        let mut last = 0.0;
        let mut wall = 0.0;
        while fade.active() {
            wall += 1000.0 / 60.0;
            fade.advance(wall);
            assert!(fade.weight >= last && fade.weight <= 1.0);
            last = fade.weight;
        }
        assert_eq!(fade.weight, 1.0);
        assert!((wall - 3000.0).abs() <= 1000.0 / 60.0, "finished at {wall} ms");
    }

    #[test]
    fn a_long_stall_still_resumes_one_capped_step_at_a_time() {
        let mut fade = PlaneFade::default();
        fade.begin(0.0, 2000.0);
        fade.advance(60_000.0);
        assert!((fade.weight - MAX_FADE_STEP).abs() < 1e-12);
        // Six sixths sum to just under 1 in f64, as they do in the browser, so a seventh lands it.
        for _ in 0..6 {
            fade.advance(60_000.0);
        }
        assert_eq!(fade.weight, 1.0);
        assert!(!fade.active());
    }

    #[test]
    fn the_midpoint_is_half_weight() {
        let mut fade = PlaneFade::default();
        fade.begin(0.0, 2000.0);
        let mut wall = 0.0;
        while wall < 1000.0 {
            wall += 10.0;
            fade.advance(wall);
        }
        assert!((fade.weight - 0.5).abs() < 1e-9, "{}", fade.weight);
    }

    #[test]
    fn cancel_settles_on_the_front_layer() {
        let mut fade = PlaneFade::default();
        fade.begin(0.0, 2000.0);
        fade.cancel();
        assert_eq!((fade.weight, fade.active(), fade.front), (1.0, false, 1));
    }

    #[test]
    fn duration_tracks_time_to_stale_within_the_clamp() {
        // 1.25 score at 1e-6 tev/ms goes stale in 8 s.
        assert!((duration_ms(1.25, 1e-6, false) - 8000.0).abs() < 1e-6);
        assert_eq!(duration_ms(1.25, 1.0, false), CROSSFADE_MS);
        assert_eq!(duration_ms(1.25, 1e-12, false), FADE_MAX_MS);
        assert_eq!(duration_ms(1.25, 1e-6, true), CROSSFADE_MS);
        assert_eq!(duration_ms(1.25, 0.0, false), CROSSFADE_MS);
    }

    #[test]
    fn the_rate_ignores_a_frame_with_no_wall_time() {
        let mut rate = TevRate::default();
        rate.observe(1.0, 100.0);
        assert_eq!(rate.per_ms, 0.0);
        rate.observe(1.5, 600.0);
        assert!((rate.per_ms - 0.001).abs() < 1e-12);
        rate.observe(9.0, 600.0);
        assert!((rate.per_ms - 0.001).abs() < 1e-12);
    }
}
