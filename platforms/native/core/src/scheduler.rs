//! Which plane rebakes this frame, and which band of it. One plane per frame is
//! a hard cap: after a respan every plane is dirty at once.

pub const REBAKE_EPS: f32 = 0.01;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bake {
    pub plane: usize,
    pub band: u32,
    pub bands: u32,
    /// The tev this bake started at. Later bands of a banded bake carry the first
    /// band's value, so a plane never blends two evolution moments across a seam.
    pub tev: f32,
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
    dirty: bool,
    baked_tev: Option<f32>,
    band: u32,
    bake_tev: f32,
}

#[derive(Debug)]
pub struct Scheduler {
    planes: Vec<Plane>,
    bands: u32,
    active: Option<usize>,
}

impl Scheduler {
    /// `bands` spreads one plane's bake across that many frames; 1 bakes it whole.
    pub fn new(scores: &[f32], bands: u32) -> Scheduler {
        Scheduler {
            planes: scores
                .iter()
                .map(|&score| Plane {
                    score,
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

    /// The stalest plane by `|ΔTev| × score`, advanced one band. At most one per frame.
    pub fn next(&mut self, tev: f32) -> Option<Bake> {
        let starting = self.active.is_none();
        let index = match self.active {
            Some(index) => index,
            None => self.stalest(tev)?,
        };
        let bands = self.bands;
        let plane = &mut self.planes[index];
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

    fn stalest(&self, tev: f32) -> Option<usize> {
        self.planes
            .iter()
            .enumerate()
            .filter_map(|(index, plane)| {
                let staleness = plane.staleness(tev);
                (plane.dirty || staleness >= REBAKE_EPS).then_some((index, staleness))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(index, _)| index)
    }
}

impl Plane {
    fn staleness(&self, tev: f32) -> f32 {
        match self.baked_tev {
            Some(baked) if !self.dirty => (tev - baked).abs() * self.score,
            _ => f32::INFINITY,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let mut scheduler = Scheduler::new(&[0.26, 1.30], 3);
        let first = scheduler.next(0.5).unwrap();
        for band in 1..3 {
            let bake = scheduler.next(0.9).unwrap();
            assert_eq!(bake.plane, first.plane);
            assert_eq!(bake.band, band);
            assert_eq!(bake.tev, first.tev, "a band drifted off the bake's tev");
        }
        let next = scheduler.next(0.5).unwrap();
        assert_ne!(next.plane, first.plane);
    }
}
