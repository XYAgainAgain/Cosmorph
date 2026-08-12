//! Evolution clock arithmetic, pure. Elapsed seconds arrive from the host, so
//! nothing here can read a clock source or accumulate a frame delta.

/// Keeps shader time domains inside float32 precision, matching `evolution.js`.
pub const T_WRAP: f64 = 4096.0 * 3600.0;

#[derive(Debug, Clone, Copy)]
pub struct Clock {
    saved_t: f64,
}

impl Clock {
    /// Mirrors `createEvolutionClock`: a non-finite or non-positive seed starts at zero.
    pub fn new(saved_t: f64) -> Clock {
        let saved_t = if saved_t.is_finite() && saved_t > 0.0 {
            saved_t % T_WRAP
        } else {
            0.0
        };
        Clock { saved_t }
    }

    pub fn saved_t(&self) -> f64 {
        self.saved_t
    }

    /// Evolution seconds after `elapsed` seconds of this session.
    pub fn now(&self, elapsed: f64) -> f64 {
        (self.saved_t + elapsed.max(0.0)) % T_WRAP
    }

    pub fn tev(&self, elapsed: f64, rate: f32) -> f32 {
        (self.now(elapsed) / 3600.0 * rate as f64) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_from_saved_t_and_wraps_at_4096_hours() {
        let clock = Clock::new(1736.27);
        assert_eq!(clock.now(0.0), 1736.27);
        assert!((clock.now(T_WRAP - 1736.27 + 5.0) - 5.0).abs() < 1e-6);
        assert_eq!(Clock::new(T_WRAP + 10.0).saved_t(), 10.0);
        assert_eq!(Clock::new(f64::NAN).saved_t(), 0.0);
    }

    #[test]
    fn tev_is_hours_times_rate() {
        let clock = Clock::new(0.0);
        assert_eq!(clock.tev(3600.0, 1.0), 1.0);
        assert_eq!(clock.tev(1800.0, 2.0), 1.0);
    }
}
