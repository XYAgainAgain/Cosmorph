//! Which plane rebakes this frame, and which band of it. One plane per frame is
//! a hard cap: after a respan every plane is dirty at once.

pub const REBAKE_EPS: f64 = 0.01;
/// Predicted pixels of spin displacement that buy a rebake. Mirrors
/// `SPIN_REBAKE_PX` in engine/shaders/tsl/spin.js.
pub const SPIN_REBAKE_PX: f32 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bake {
    pub plane: usize,
    pub band: u32,
    pub bands: u32,
    /// The tev this bake started at. Later bands of a banded bake carry the first
    /// band's value, so a plane never blends two evolution moments across a seam.
    pub tev: f64,
}

impl Bake {
    pub fn is_last(&self) -> bool {
        self.band + 1 >= self.bands
    }

    /// Scissor `(y, height)` for this band, bottom-left origin. Integer division
    /// on both edges is what makes the bands tile without a seam or an overlap.
    pub fn rows(&self, height: i32) -> (i32, i32) {
        let h = height.max(0) as i64;
        let bands = self.bands.max(1) as i64;
        let y0 = h * self.band as i64 / bands;
        let y1 = h * (self.band as i64 + 1) / bands;
        (y0 as i32, (y1 - y0) as i32)
    }
}

#[derive(Debug)]
struct Plane {
    score: f32,
    /// Compose warps this plane between rebakes, which forces a whole-plane bake.
    swirl: bool,
    dirty: bool,
    baked_tev: Option<f64>,
    band: u32,
    bake_tev: f64,
}

#[derive(Debug)]
pub struct Scheduler {
    planes: Vec<Plane>,
    bands: u32,
    active: Option<usize>,
}

impl Scheduler {
    /// `bands` spreads one plane's bake across that many frames; 1 bakes it whole.
    /// `swirl` is parallel to `scores` and marks the planes compose warps.
    pub fn new(scores: &[f32], swirl: &[bool], bands: u32) -> Scheduler {
        Scheduler {
            planes: scores
                .iter()
                .enumerate()
                .map(|(index, &score)| Plane {
                    score,
                    swirl: swirl.get(index).copied().unwrap_or(false),
                    dirty: true,
                    baked_tev: None,
                    band: 0,
                    bake_tev: 0.0,
                })
                .collect(),
            bands: bands.max(1),
            active: None,
        }
    }

    pub fn bands(&self) -> u32 {
        self.bands
    }

    pub fn mark_all_dirty(&mut self) {
        for plane in &mut self.planes {
            plane.dirty = true;
        }
        self.active = None;
    }

    /// The stalest plane by `|ΔTev| × score`, or one whose `spin_px` clears
    /// `SPIN_REBAKE_PX` however fresh its score. Advanced one band, at most one per frame.
    pub fn next(&mut self, tev: f64, spin_px: &[f32]) -> Option<Bake> {
        let starting = self.active.is_none();
        let index = match self.active {
            Some(index) => index,
            None => self.stalest(tev, spin_px)?,
        };
        let plane = &mut self.planes[index];
        // Single band while a plane carries live swirl: an intermediate band
        // would mix strips at the new tev with a plane_baked_tev still holding
        // the old one, double-displacing the strips already finished. The real
        // fix is a two-generation handoff.
        let bands = if plane.swirl { 1 } else { self.bands };
        if starting {
            plane.bake_tev = tev;
            plane.band = 0;
        }
        let bake = Bake {
            plane: index,
            band: plane.band,
            bands,
            tev: plane.bake_tev,
        };
        plane.band += 1;
        let done = plane.band >= bands;
        if done {
            plane.baked_tev = Some(plane.bake_tev);
            plane.dirty = false;
        }
        self.active = if done { None } else { Some(index) };
        Some(bake)
    }

    fn stalest(&self, tev: f64, spin_px: &[f32]) -> Option<usize> {
        self.planes
            .iter()
            .enumerate()
            .filter_map(|(index, plane)| {
                let staleness = plane.staleness(tev);
                let spin = spin_px.get(index).copied().unwrap_or(0.0);
                let spun = spin >= SPIN_REBAKE_PX;
                let priority = staleness.max(
                    (spin as f64 / SPIN_REBAKE_PX as f64) * REBAKE_EPS,
                );
                (plane.dirty || spun || staleness >= REBAKE_EPS).then_some((index, priority))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(index, _)| index)
    }
}

impl Plane {
    fn staleness(&self, tev: f64) -> f64 {
        match self.baked_tev {
            Some(baked) if !self.dirty => (tev - baked).abs() * self.score as f64,
            _ => f64::INFINITY,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::SpinSpec;

    fn demoted(rigid: f32) -> SpinSpec {
        SpinSpec {
            radius: 0.4,
            rigid,
            rate: rigid as f64,
            phase_uniform: String::new(),
            bake_phase_uniform: String::new(),
            lead: 0.0,
            sat_ramp: 512.0,
            wrap: 4096.0,
            swirl: false,
        }
    }

    #[test]
    fn bands_tile_the_target_exactly() {
        let mut covered = 0;
        for band in 0..4 {
            let (y, h) = Bake {
                plane: 0,
                band,
                bands: 4,
                tev: 0.0,
            }
            .rows(2561);
            assert_eq!(y, covered);
            covered += h;
        }
        assert_eq!(covered, 2561);
    }

    #[test]
    fn a_banded_bake_holds_one_plane_and_one_tev_across_its_frames() {
        let mut scheduler = Scheduler::new(&[0.26, 1.30], &[false, false], 3);
        let first = scheduler.next(0.5, &[]).unwrap();
        for band in 1..3 {
            let bake = scheduler.next(0.9, &[]).unwrap();
            assert_eq!(bake.plane, first.plane);
            assert_eq!(bake.band, band);
            assert_eq!(bake.tev, first.tev, "a band drifted off the bake's tev");
        }
        let next = scheduler.next(0.5, &[]).unwrap();
        assert_ne!(next.plane, first.plane);
    }

    /// A plane whose only motion is a demoted galaxy's rigid spin has no morph
    /// score at all, so scores alone would bake it once and freeze it.
    #[test]
    fn a_demoted_galaxys_spin_still_buys_rebakes_on_a_zero_morph_plane() {
        let spin = demoted(0.024_544);
        let mut scheduler = Scheduler::new(&[0.0], &[false], 1);
        let first = scheduler.next(0.0, &[0.0]).unwrap();
        assert!(first.is_last());
        let mut baked = first.tev;

        let px_per_unit = 2560.0;
        let mut rebakes = 0;
        let mut tev = 0.0f64;
        for _ in 0..600 {
            tev += 0.01;
            let drift = spin.drift_px(tev, baked, px_per_unit);
            assert_eq!(
                (drift > 0.0),
                (tev - baked) >= 0.05,
                "the demoted rebake floor is not holding at tev {tev}"
            );
            if let Some(bake) = scheduler.next(tev, &[drift]) {
                rebakes += 1;
                baked = bake.tev;
            }
        }
        assert!(rebakes > 0, "a demoted galaxy's plane never rebaked");
    }

    #[test]
    fn spin_only_plane_is_not_starved_by_a_morphing_plane() {
        let mut scheduler = Scheduler::new(&[1.0, 0.0], &[false, false], 1);
        scheduler.next(0.0, &[0.0, 0.0]).unwrap();
        scheduler.next(0.0, &[0.0, 0.0]).unwrap();

        let mut spin_drift = 0.0;
        for step in 1..=100 {
            spin_drift += SPIN_REBAKE_PX * 0.25;
            let bake = scheduler.next(step as f64 * REBAKE_EPS, &[0.0, spin_drift]);
            if bake.is_some_and(|bake| bake.plane == 1) {
                spin_drift = 0.0;
            }
            assert!(
                spin_drift <= SPIN_REBAKE_PX * 2.0,
                "spin-only plane drift reached {spin_drift}px under contention"
            );
        }
    }

    #[test]
    fn a_swirl_plane_never_bakes_in_bands() {
        let mut scheduler = Scheduler::new(&[1.0, 1.0], &[true, false], 4);
        let first = scheduler.next(0.0, &[]).unwrap();
        let want = if first.plane == 0 { 1 } else { 4 };
        assert_eq!(first.bands, want);
        // Drain the banded plane's remaining frames before reading the other.
        let mut bake = first;
        while !bake.is_last() {
            bake = scheduler.next(0.0, &[]).unwrap();
        }
        let other = scheduler.next(0.0, &[]).unwrap();
        assert_ne!(other.plane, first.plane);
        assert_eq!(other.bands, if other.plane == 0 { 1 } else { 4 });
    }
}
