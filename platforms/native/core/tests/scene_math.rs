//! Scene arithmetic against the hero's real numbers: clock wrap, cadence states,
//! bake periods, and the bright-star rescale over the dumped instance buffers.

use std::path::PathBuf;

use cosmorph_native_core::bundle::Bundle;
use cosmorph_native_core::cadence::{self, Pacer, State, BURST_MS, TWINKLE_MS};
use cosmorph_native_core::clock::{Clock, T_WRAP};
use cosmorph_native_core::scheduler::Scheduler;
use cosmorph_native_core::stars::{rescale_aspect, rescale_dpr, BRIGHT_OVERSCAN};

const HERO_SAVED_T: f64 = 1736.27;
const HERO_RATE: f32 = 1.0;
const DUMP_ASPECT: f32 = 2.5625;
const OTHER_ASPECT: f32 = 2.0;
const SCORE_DEEP: f32 = 0.26;
const SCORE_DISTANT: f32 = 1.30;
const SCORE_CLOSE: f32 = 0.18;
const TOL: f32 = 1e-6;

#[test]
fn the_clock_wraps_at_4096_hours_and_never_accumulates() {
    let clock = Clock::new(HERO_SAVED_T);
    assert_eq!(clock.now(0.0), HERO_SAVED_T);
    assert!((clock.now(T_WRAP) - HERO_SAVED_T).abs() < 1e-6);
    assert!((clock.now(T_WRAP - HERO_SAVED_T + 12.5) - 12.5).abs() < 1e-6);
    assert!((clock.tev(3600.0 - HERO_SAVED_T, HERO_RATE) - 1.0).abs() < 1e-6);

    let dts = vec![1.0 / 240.0_f64; 1000];
    let mut elapsed = 0.0;
    let mut stepped = 0.0;
    for dt in &dts {
        elapsed += dt;
        stepped = clock.now(elapsed);
    }
    assert_eq!(stepped, clock.now(dts.iter().sum::<f64>()));
}

#[test]
fn cadence_bursts_on_input_and_falls_back_to_the_twinkle_rate() {
    let live = cadence::state(1_000.0, 500.0, true, true, false);
    assert_eq!(live.interval_ms(), BURST_MS);

    let unsettled =
        cadence::state(9_000.0, 0.0, cadence::settled((0.0, 0.0), (0.2, 0.0)), true, false);
    assert_eq!(unsettled, State::Burst);

    let idle =
        cadence::state(9_000.0, 0.0, cadence::settled((0.0, 0.0), (0.01, 0.01)), true, false);
    assert_eq!(idle.interval_ms(), TWINKLE_MS);
    // Pinned literal: 60 FPS is the visible floor, so even a still sky ticks at it.
    assert_eq!(
        cadence::state(9_000.0, 0.0, true, false, false).interval_ms(),
        1_000.0 / 60.0
    );

    // A buried span heartbeats even while the pointer is live, and draws nothing.
    let buried = cadence::state(1_000.0, 500.0, true, true, true);
    assert_eq!(buried, State::Occluded);
    assert_eq!(buried.interval_ms(), 1_000.0);
    assert!(!buried.draws());

    // A frame that lands late must not push the whole cadence late with it.
    let mut pacer = Pacer::new(0.0);
    let deadline = pacer.next_deadline(BURST_MS * 3.0 + 5.0, BURST_MS);
    assert!((deadline - BURST_MS * 4.0).abs() < 1e-9, "{deadline}");
}

#[test]
fn the_scheduler_holds_the_hero_rebake_periods_and_bakes_one_plane_a_frame() {
    let clock = Clock::new(HERO_SAVED_T);
    let mut scheduler = Scheduler::new(&[SCORE_DEEP, SCORE_DISTANT, SCORE_CLOSE], &[false; 3], 1);
    let mut bakes: Vec<Vec<f64>> = vec![Vec::new(); 3];

    let frames = 60 * 1200;
    for frame in 0..frames {
        let elapsed = frame as f64 / 60.0;
        let tev = clock.tev(elapsed, HERO_RATE);
        if let Some(bake) = scheduler.next(tev, &[]) {
            bakes[bake.plane].push(elapsed);
            assert!(bake.is_last(), "unbanded bakes finish in one frame");
        }
    }

    let period = |samples: &[f64]| {
        assert!(samples.len() > 3, "too few bakes to measure a period");
        (samples[samples.len() - 1] - samples[1]) / (samples.len() - 2) as f64
    };
    let distant = period(&bakes[1]);
    let deep = period(&bakes[0]);
    assert!((distant - 27.7).abs() < 0.1, "distant plane period {distant}");
    assert!((deep - 138.0).abs() < 1.0, "deep plane period {deep}");

    // Boot dirties every plane; the cap has to spread them over three frames.
    let mut fresh = Scheduler::new(&[SCORE_DEEP, SCORE_DISTANT, SCORE_CLOSE], &[false; 3], 1);
    let mut planes: Vec<usize> = (0..3).filter_map(|_| fresh.next(0.5, &[]).map(|b| b.plane)).collect();
    assert!(fresh.next(0.5, &[]).is_none(), "a fourth plane baked from three");
    planes.sort_unstable();
    assert_eq!(planes, vec![0, 1, 2]);
}

#[test]
fn the_bright_star_rescale_reproduces_the_dumped_buffers() {
    let Some(dir) = bundle_dir() else {
        eprintln!(
            "skipping the star rescale: set COSMORPH_BUNDLE to the directory holding \
             bundle.json and bundle.bin (run .dev/tools/glsl-dump to produce them)"
        );
        return;
    };
    let bundle = Bundle::load(
        &std::fs::read(dir.join("bundle.json")).expect("reading bundle.json"),
        std::fs::read(dir.join("bundle.bin")).expect("reading bundle.bin"),
    )
    .expect("bundle failed to load");
    assert!(
        bundle.manifest.dump.aspects.contains(&DUMP_ASPECT)
            && bundle.manifest.dump.aspects.contains(&OTHER_ASPECT),
        "the bundle was dumped at other aspects than this fixture assumes"
    );

    let dumped_ia = instance_attribute(&bundle, "iA");
    let dumped_ic = instance_attribute(&bundle, "iC");
    assert_eq!(dumped_ia.len(), 169 * 4, "bright-star instance count");

    // The engine's aspect-2.0 buffer, rebuilt by the inverse of the dumper's map in
    // f64, so the f32 port is checked against an independently computed input.
    let k = (DUMP_ASPECT as f64 + 2.0 * BRIGHT_OVERSCAN as f64)
        / (OTHER_ASPECT as f64 + 2.0 * BRIGHT_OVERSCAN as f64);
    let mut at_other = dumped_ia.clone();
    for star in at_other.chunks_exact_mut(4) {
        star[0] =
            (((star[0] as f64 + BRIGHT_OVERSCAN as f64) / k) - BRIGHT_OVERSCAN as f64) as f32;
    }

    rescale_aspect(&mut at_other, OTHER_ASPECT, DUMP_ASPECT).unwrap();
    for (i, (got, want)) in at_other.iter().zip(&dumped_ia).enumerate() {
        assert!(
            (got - want).abs() <= TOL,
            "iA[{i}] rescaled to {got}, dumped {want}"
        );
        if i % 4 != 0 {
            assert_eq!(got, want, "iA[{i}] moved with aspect");
        }
    }

    let mut ic = dumped_ic.clone();
    rescale_dpr(&mut ic, 1.0, 2.0).unwrap();
    for (i, (got, want)) in ic.iter().zip(&dumped_ic).enumerate() {
        if i % 4 == 3 {
            assert_eq!(got, want, "iC.w scaled with DPR");
        } else {
            assert!((got - want * 2.0).abs() <= TOL, "iC[{i}] is {got}");
        }
    }
    rescale_dpr(&mut ic, 2.0, 1.0).unwrap();
    for (got, want) in ic.iter().zip(&dumped_ic) {
        assert!((got - want).abs() <= TOL, "{got} vs {want}");
    }
}

fn bundle_dir() -> Option<PathBuf> {
    let path = PathBuf::from(std::env::var_os("COSMORPH_BUNDLE")?);
    if path.extension().is_some_and(|e| e == "json") {
        path.parent().map(PathBuf::from)
    } else {
        Some(path)
    }
}

fn instance_attribute(bundle: &Bundle, name: &str) -> Vec<f32> {
    let program = bundle.program("bright").expect("bright program");
    let attribute = program
        .attributes
        .iter()
        .find(|a| a.name == name)
        .unwrap_or_else(|| panic!("bright has no {name} attribute"));
    assert_eq!(attribute.divisor, 1, "{name} is not instanced");
    bundle
        .blob(attribute.blob)
        .expect("attribute blob")
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}
