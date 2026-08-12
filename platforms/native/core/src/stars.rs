//! Bright-star instance buffers rescaled off the dump geometry. No RNG, no
//! blackbody, no spectral table: only the geometry response is ported.

use crate::Result;

pub const BRIGHT_OVERSCAN: f32 = 0.06;

/// `iA.x` lives in the overscanned x domain, so it remaps with aspect; `yzw` do not.
pub fn rescale_aspect(ia: &mut [f32], from: f32, to: f32) -> Result<()> {
    check(ia, "iA")?;
    let k = (to + 2.0 * BRIGHT_OVERSCAN) / (from + 2.0 * BRIGHT_OVERSCAN);
    for star in ia.chunks_exact_mut(4) {
        star[0] = (star[0] + BRIGHT_OVERSCAN) * k - BRIGHT_OVERSCAN;
    }
    Ok(())
}

/// `iC.xyz` are pixel sizes and ride DPR; `iC.w` is unitless and must not move.
pub fn rescale_dpr(ic: &mut [f32], from: f32, to: f32) -> Result<()> {
    check(ic, "iC")?;
    let k = to / from;
    for star in ic.chunks_exact_mut(4) {
        for c in star[..3].iter_mut() {
            *c *= k;
        }
    }
    Ok(())
}

fn check(buf: &[f32], name: &str) -> Result<()> {
    if !buf.len().is_multiple_of(4) {
        return Err(format!(
            "bright-star {name} buffer holds {} floats, not a whole number of vec4",
            buf.len()
        )
        .into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aspect_rescale_is_invertible_and_leaves_yzw_alone() {
        let mut ia = vec![-0.06, 1.0, 2.0, 3.0, 0.5, 4.0, 5.0, 6.0, 1.06, 7.0, 8.0, 9.0];
        let original = ia.clone();
        rescale_aspect(&mut ia, 2.5625, 2.0).unwrap();
        assert!(ia[4] != original[4]);
        assert_eq!(ia[0], original[0], "-overscan is the fixed point");
        rescale_aspect(&mut ia, 2.0, 2.5625).unwrap();
        for (got, want) in ia.iter().zip(&original) {
            assert!((got - want).abs() < 1e-6, "{got} vs {want}");
        }
    }

    #[test]
    fn dpr_rescale_spares_the_unitless_component() {
        let mut ic = vec![1.0, 2.0, 3.0, 4.0];
        rescale_dpr(&mut ic, 1.0, 2.0).unwrap();
        assert_eq!(ic, vec![2.0, 4.0, 6.0, 4.0]);
    }

    #[test]
    fn a_ragged_buffer_names_itself() {
        let err = rescale_aspect(&mut [0.0; 5], 2.0, 2.5).unwrap_err();
        assert!(err.message().contains("iA"), "{err}");
    }
}
