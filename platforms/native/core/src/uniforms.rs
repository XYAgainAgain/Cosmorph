//! Uniform blocks read back from the driver: enumerate members, take their
//! offsets and strides as reported, and hard-fail on anything the bundle cannot fill.

use glow::HasContext;

use crate::bundle::{GlslType, ProgramSpec, ScalarKind};
use crate::{Error, Result};

/// One component's four std140 bytes. The manifest carries every value as `f32`,
/// so an integer type is only writable when the float is exactly its integer.
fn component_bytes(kind: ScalarKind, value: f32, name: &str) -> Result<[u8; 4]> {
    if kind == ScalarKind::Float {
        return Ok(value.to_ne_bytes());
    }
    if kind == ScalarKind::Bool {
        // GLSL bools in std140 are 0 or 1; any other bit pattern is undefined.
        return Ok(if value != 0.0 { 1u32 } else { 0u32 }.to_ne_bytes());
    }
    if !value.is_finite() || value.fract() != 0.0 {
        return Err(format!("uniform '{name}' is an integer type but carries {value}").into());
    }
    let wide = value as f64;
    match kind {
        ScalarKind::Uint => {
            if !(0.0..=u32::MAX as f64).contains(&wide) {
                return Err(format!(
                    "uniform '{name}' is unsigned but carries {value}, outside 0..={}",
                    u32::MAX
                )
                .into());
            }
            Ok((wide as u32).to_ne_bytes())
        }
        _ => {
            if !(i32::MIN as f64..=i32::MAX as f64).contains(&wide) {
                return Err(format!(
                    "uniform '{name}' is signed but carries {value}, outside {}..={}",
                    i32::MIN,
                    i32::MAX
                )
                .into());
            }
            Ok((wide as i32).to_ne_bytes())
        }
    }
}

pub struct BlockMember {
    pub name: String,
    pub offset: usize,
    pub array_stride: i32,
    pub matrix_stride: i32,
    pub gl_type: u32,
    /// Index into `ProgramSpec::members`.
    pub spec: usize,
}

pub struct UniformBlock {
    pub index: u32,
    pub binding: u32,
    pub members: Vec<BlockMember>,
    pub buffer: glow::Buffer,
    cpu: Vec<u8>,
    dirty: bool,
}

impl UniformBlock {
    pub fn member(&self, name: &str) -> Option<&BlockMember> {
        self.members.iter().find(|m| m.name == name)
    }

    /// Writes one member's components at the driver's offset. Matrix columns go
    /// at `matrix_stride`, which is 16 bytes for a `mat3` and never 12.
    pub fn write(&mut self, member: usize, ty: GlslType, values: &[f32]) -> Result<()> {
        let m = self
            .members
            .get(member)
            .ok_or_else(|| Error::from(format!("uniform block member index {member} is out of range")))?;
        if values.len() != ty.components() {
            return Err(format!(
                "uniform '{}' is {:?} ({} components) but got {} value(s)",
                m.name,
                ty,
                ty.components(),
                values.len()
            )
            .into());
        }

        let kind = ty.scalar_kind();
        let (columns, rows) = ty.shape();
        let stride = if columns > 1 {
            m.matrix_stride.max(0) as usize
        } else {
            0
        };

        for col in 0..columns {
            let base = m.offset + col * stride;
            for row in 0..rows {
                let value = values[col * rows + row];
                let bytes = component_bytes(kind, value, &m.name)?;
                let at = base + row * 4;
                let end = at + 4;
                if end > self.cpu.len() {
                    return Err(format!(
                        "uniform '{}' writes to byte {} of a {}-byte block",
                        m.name,
                        end,
                        self.cpu.len()
                    )
                    .into());
                }
                self.cpu[at..end].copy_from_slice(&bytes);
            }
        }
        self.dirty = true;
        Ok(())
    }

    /// Writes every member the bundle can resolve at this geometry, leaving the
    /// dynamic ones for the per-frame pass.
    pub fn fill_static(&mut self, spec: &ProgramSpec, aspect: f32, dpr: f32) -> Result<()> {
        for i in 0..self.members.len() {
            let s = &spec.members[self.members[i].spec];
            if let Some(values) = s.resolve(aspect, dpr) {
                let ty = s.ty;
                self.write(i, ty, &values)?;
            }
        }
        Ok(())
    }

    /// Binds the block's buffer to its binding point, uploading first if dirty.
    ///
    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn bind(&mut self, gl: &glow::Context) {
        gl.bind_buffer(glow::UNIFORM_BUFFER, Some(self.buffer));
        if self.dirty {
            gl.buffer_sub_data_u8_slice(glow::UNIFORM_BUFFER, 0, &self.cpu);
            self.dirty = false;
        }
        gl.bind_buffer_base(glow::UNIFORM_BUFFER, self.binding, Some(self.buffer));
    }

    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn delete(&self, gl: &glow::Context) {
        gl.delete_buffer(self.buffer);
    }
}

/// Enumerates every block of a linked program, binds each to its own binding
/// point, and fails naming any member the bundle has no value for.
///
/// # Safety
/// Requires a current GL context matching `gl`, and `program` must be linked.
pub unsafe fn reflect(
    gl: &glow::Context,
    program: glow::Program,
    spec: &ProgramSpec,
) -> Result<Vec<UniformBlock>> {
    let block_count = gl.get_program_parameter_i32(program, glow::ACTIVE_UNIFORM_BLOCKS);
    let mut blocks = Vec::new();

    for index in 0..block_count.max(0) as u32 {
        let active = gl.get_active_uniform_block_parameter_i32(
            program,
            index,
            glow::UNIFORM_BLOCK_ACTIVE_UNIFORMS,
        );
        let data_size = gl.get_active_uniform_block_parameter_i32(
            program,
            index,
            glow::UNIFORM_BLOCK_DATA_SIZE,
        );
        if data_size <= 0 {
            return Err(format!(
                "program '{}' block {} reports a data size of {}",
                spec.id, index, data_size
            )
            .into());
        }

        let mut indices = vec![0i32; active.max(0) as usize];
        gl.get_active_uniform_block_parameter_i32_slice(
            program,
            index,
            glow::UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES,
            &mut indices,
        );
        let indices: Vec<u32> = indices.iter().map(|&i| i as u32).collect();

        let query = |pname| {
            if indices.is_empty() {
                Vec::new()
            } else {
                gl.get_active_uniforms_parameter(program, &indices, pname)
            }
        };
        let offsets = query(glow::UNIFORM_OFFSET);
        let array_strides = query(glow::UNIFORM_ARRAY_STRIDE);
        let matrix_strides = query(glow::UNIFORM_MATRIX_STRIDE);

        let mut members = Vec::with_capacity(indices.len());
        for (slot, &uniform) in indices.iter().enumerate() {
            let active = gl.get_active_uniform(program, uniform).ok_or_else(|| {
                Error::from(format!(
                    "program '{}' block {} member {} could not be queried",
                    spec.id, index, uniform
                ))
            })?;
            let name = active.name.split('[').next().unwrap_or("").to_string();
            let found = spec
                .members
                .iter()
                .position(|m| m.name == name)
                .ok_or_else(|| {
                    Error::from(format!(
                        "program '{}' declares uniform '{}' but the bundle carries no value for it; re-run the dumper",
                        spec.id, name
                    ))
                })?;
            members.push(BlockMember {
                name,
                offset: offsets[slot].max(0) as usize,
                array_stride: array_strides[slot],
                matrix_stride: matrix_strides[slot],
                gl_type: active.utype,
                spec: found,
            });
        }

        let binding = blocks.len() as u32;
        gl.uniform_block_binding(program, index, binding);

        let buffer = gl
            .create_buffer()
            .map_err(|e| Error::from(format!("program '{}' UBO: {e}", spec.id)))?;
        gl.bind_buffer(glow::UNIFORM_BUFFER, Some(buffer));
        gl.buffer_data_size(glow::UNIFORM_BUFFER, data_size, glow::DYNAMIC_DRAW);

        blocks.push(UniformBlock {
            index,
            binding,
            members,
            buffer,
            cpu: vec![0u8; data_size as usize],
            dirty: true,
        });
    }

    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bits(ty: GlslType, value: f32) -> Result<u32> {
        component_bytes(ty.scalar_kind(), value, "u").map(u32::from_ne_bytes)
    }

    #[test]
    fn unsigned_values_above_i32_max_keep_their_own_bits() {
        // 3e9 saturates to 0x7fffffff through i32, and is exact as u32.
        assert_eq!(bits(GlslType::Uint, 3.0e9).unwrap(), 3_000_000_000);
        assert_eq!(bits(GlslType::Uvec3, 4_294_967_040.0).unwrap(), 4_294_967_040);
        assert_eq!(bits(GlslType::Uint, 0.0).unwrap(), 0);
        // 2^32 is the first f32 past u32::MAX, and -1 is not unsigned at all.
        assert!(bits(GlslType::Uint, 4_294_967_296.0).is_err());
        assert!(bits(GlslType::Uint, -1.0).is_err());
    }

    #[test]
    fn signed_values_span_the_whole_i32_range_and_stop_there() {
        assert_eq!(bits(GlslType::Int, 2_147_483_520.0).unwrap() as i32, 2_147_483_520);
        assert_eq!(bits(GlslType::Ivec2, -2_147_483_648.0).unwrap() as i32, i32::MIN);
        // 2^31 is the first f32 past i32::MAX; `as i32` would have saturated it.
        assert!(bits(GlslType::Int, 2_147_483_648.0).is_err());
        assert!(bits(GlslType::Int, -2_147_483_904.0).is_err());
    }

    #[test]
    fn bools_are_canonical_and_floats_and_fractions_are_rejected() {
        assert_eq!(bits(GlslType::Bool, 0.0).unwrap(), 0);
        assert_eq!(bits(GlslType::Bool, 7.5).unwrap(), 1);
        assert_eq!(bits(GlslType::Float, 1.0).unwrap(), 1.0f32.to_bits());
        assert!(bits(GlslType::Uint, 1.5).is_err());
        assert!(bits(GlslType::Int, f32::NAN).is_err());
        assert!(bits(GlslType::Uint, f32::INFINITY).is_err());
    }
}
