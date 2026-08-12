//! Compile, link, and bind one dumped program. Every binding is resolved by
//! name: the node builder assigns attribute locations by collection order.

use glow::HasContext;

use crate::bundle::ProgramSpec;
use crate::uniforms::{self, UniformBlock};
use crate::{Error, Result};

pub struct SamplerBinding {
    /// Index into `ProgramSpec::samplers`.
    pub spec: usize,
    pub unit: u32,
}

pub struct AttribBinding {
    /// Index into `ProgramSpec::attributes`.
    pub spec: usize,
    pub location: u32,
}

pub struct GpuProgram {
    pub id: String,
    pub program: glow::Program,
    pub blocks: Vec<UniformBlock>,
    pub samplers: Vec<SamplerBinding>,
    pub attributes: Vec<AttribBinding>,
}

impl GpuProgram {
    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn build(gl: &glow::Context, spec: &ProgramSpec) -> Result<GpuProgram> {
        let vertex = compile(gl, glow::VERTEX_SHADER, &spec.vert, &spec.id, "vertex")?;
        let fragment = match compile(gl, glow::FRAGMENT_SHADER, &spec.frag, &spec.id, "fragment") {
            Ok(shader) => shader,
            Err(e) => {
                gl.delete_shader(vertex);
                return Err(e);
            }
        };

        let program = gl
            .create_program()
            .map_err(|e| Error::from(format!("program '{}' could not be created: {e}", spec.id)))?;
        gl.attach_shader(program, vertex);
        gl.attach_shader(program, fragment);
        gl.link_program(program);
        let linked = gl.get_program_link_status(program);
        let log = gl.get_program_info_log(program);
        gl.detach_shader(program, vertex);
        gl.detach_shader(program, fragment);
        gl.delete_shader(vertex);
        gl.delete_shader(fragment);
        if !linked {
            gl.delete_program(program);
            return Err(format!("program '{}' failed to link: {log}", spec.id).into());
        }

        let built = Self::bind(gl, program, spec);
        if built.is_err() {
            gl.delete_program(program);
        }
        built
    }

    unsafe fn bind(
        gl: &glow::Context,
        program: glow::Program,
        spec: &ProgramSpec,
    ) -> Result<GpuProgram> {
        let blocks = uniforms::reflect(gl, program, spec)?;

        gl.use_program(Some(program));
        let mut samplers = Vec::with_capacity(spec.samplers.len());
        for (unit, sampler) in spec.samplers.iter().enumerate() {
            let location = gl.get_uniform_location(program, &sampler.name).ok_or_else(|| {
                Error::from(format!(
                    "program '{}' declares sampler '{}' but the linked program has no such uniform",
                    spec.id, sampler.name
                ))
            })?;
            gl.uniform_1_i32(Some(&location), unit as i32);
            samplers.push(SamplerBinding {
                spec: unit,
                unit: unit as u32,
            });
        }

        // An attribute the shader never reads is dropped at link time, which is
        // routine: `normal` survives on the dumped quad and no pass uses it.
        let mut attributes = Vec::with_capacity(spec.attributes.len());
        for (i, attribute) in spec.attributes.iter().enumerate() {
            if let Some(location) = gl.get_attrib_location(program, &attribute.name) {
                attributes.push(AttribBinding { spec: i, location });
            }
        }

        Ok(GpuProgram {
            id: spec.id.clone(),
            program,
            blocks,
            samplers,
            attributes,
        })
    }

    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn delete(&self, gl: &glow::Context) {
        for block in &self.blocks {
            block.delete(gl);
        }
        gl.delete_program(self.program);
    }
}

unsafe fn compile(
    gl: &glow::Context,
    stage: u32,
    source: &str,
    id: &str,
    what: &str,
) -> Result<glow::Shader> {
    let shader = gl
        .create_shader(stage)
        .map_err(|e| Error::from(format!("program '{id}' {what} shader: {e}")))?;
    gl.shader_source(shader, source);
    gl.compile_shader(shader);
    if !gl.get_shader_compile_status(shader) {
        let log = gl.get_shader_info_log(shader);
        gl.delete_shader(shader);
        return Err(format!("program '{id}' {what} shader failed to compile: {log}").into());
    }
    Ok(shader)
}
