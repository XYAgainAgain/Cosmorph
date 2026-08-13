//! Pass-graph execution: dynamic uniform writes, one plane rebake, the bright
//! tier, and the scissored composite. Every draw's state is read off the bundle.

use glow::HasContext;

use crate::bundle::{
    spin_phase, Blend, Bundle, GlslType, IndexType, PlaneSpec, ProgramSpec, SamplerSource,
};
use crate::program::GpuProgram;
use crate::scheduler::{Bake, Scheduler};
use crate::stars;
use crate::targets::{self, RenderTarget};
use crate::{Error, Result};

/// Matches `renderer.setClearColor(0x000000, 1)` in the browser host.
const CLEAR_COLOR: [f32; 4] = [0.0, 0.0, 0.0, 1.0];
/// The dumper lands on the real span at DPR 1 before it copies any attribute
/// buffer, so DPR 1 is the origin every instance rescale starts from.
const DUMP_DPR: f32 = 1.0;
/// Overscan margin in CSS pixels, per `sky2d.js`'s resize().
const MARGIN_PARALLAX_SCALE: f32 = 1.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// What the host supplies per frame. Everything else is geometry or bundle data.
#[derive(Debug, Clone, Copy)]
pub struct FrameInput {
    pub tev: f64,
    /// Three independently wrapped octave phases, per `tickTwinkle()` in sky2d.js.
    pub twinkle_phase: [f32; 3],
    /// Device pixels, already damped by the host.
    pub parallax: [f32; 2],
    /// Bit `i` set draws monitor rect `i` in the composite; a clear bit is a rect
    /// some window covers. Rects past 63 are always drawn.
    pub active_rects: u64,
}

impl FrameInput {
    pub const ALL_RECTS: u64 = u64::MAX;

    fn draws_rect(&self, rect: usize) -> bool {
        rect >= 64 || self.active_rects & (1 << rect) != 0
    }
}

#[derive(Debug, Clone, Copy)]
struct View {
    span: Rect,
    dpr: f32,
    aspect: f32,
    margin_scale: [f32; 2],
    px_per_unit: f32,
}

impl View {
    fn new(span: Rect, dpr: f32, max_parallax_px: f32) -> View {
        let w = span.w.max(1) as f32;
        let h = span.h.max(1) as f32;
        let margin = (max_parallax_px * MARGIN_PARALLAX_SCALE * dpr).ceil() + 2.0;
        let margin_scale = [1.0 + 2.0 * margin / w, 1.0 + 2.0 * margin / h];
        View {
            span,
            dpr,
            aspect: w / h,
            margin_scale,
            px_per_unit: h / margin_scale[1],
        }
    }
}

/// The closed set of per-frame members, per DESIGN §4. Plane depths are constant
/// but arrive as `dynamic` because no aspect or DPR fit describes them.
#[derive(Debug, Clone, Copy)]
enum Dyn {
    Tev,
    TwinklePhase,
    Parallax,
    Resolution,
    Aspect,
    MarginScale,
    PxPerUnit,
    Camera,
    Depth(f32),
    /// The plane whose bake clock this member follows.
    BakeTev(usize),
    /// Prewrapped Ωp·T for one galaxy, at the live clock or at its plane's
    /// last bake. Carries the galaxy's own signed pattern speed.
    SpinPhase(f64),
    BakeSpinPhase(usize, f64),
}

impl Dyn {
    fn parse(key: &str, uniform: &str, program: &str, planes: &[PlaneSpec]) -> Result<Dyn> {
        Ok(match key {
            "tev" => Dyn::Tev,
            "twinklePhase" => Dyn::TwinklePhase,
            "parallax" => Dyn::Parallax,
            "resolution" => Dyn::Resolution,
            "aspect" => Dyn::Aspect,
            "marginScale" => Dyn::MarginScale,
            "pxPerUnit" => Dyn::PxPerUnit,
            "camera" => Dyn::Camera,
            "planeDeep" | "planeDistant" | "planeFar" | "planeClose" => {
                let plane = planes
                    .iter()
                    .find(|p| p.depth_uniform == uniform)
                    .ok_or_else(|| {
                        Error::from(format!(
                            "program '{program}' drives '{uniform}' but no plane declares it as its depthUniform"
                        ))
                    })?;
                Dyn::Depth(plane.depth)
            }
            "spinPhase" | "bakeSpinPhase" => {
                let (plane, spec) = planes
                    .iter()
                    .find_map(|p| {
                        p.spin
                            .iter()
                            .find(|s| {
                                uniform
                                    == if key == "spinPhase" {
                                        &s.phase_uniform
                                    } else {
                                        &s.bake_phase_uniform
                                    }
                            })
                            .map(|s| (p, s))
                    })
                    .ok_or_else(|| {
                        Error::from(format!(
                            "program '{program}' drives '{uniform}' but no plane's spin list names it"
                        ))
                    })?;
                if key == "spinPhase" {
                    Dyn::SpinPhase(spec.rate)
                } else {
                    Dyn::BakeSpinPhase(plane.id, spec.rate)
                }
            }
            "bakeTev" => {
                let plane = planes
                    .iter()
                    .find(|p| p.bake_tev_uniforms.iter().any(|u| u == uniform))
                    .ok_or_else(|| {
                        Error::from(format!(
                            "program '{program}' drives '{uniform}' but no plane lists it in bakeTevUniforms"
                        ))
                    })?;
                Dyn::BakeTev(plane.id)
            }
            other => {
                return Err(format!(
                    "program '{program}' member '{uniform}' declares dynamic '{other}', which this host does not drive"
                )
                .into())
            }
        })
    }

    fn values(
        self,
        view: &View,
        camera: [f32; 2],
        input: &FrameInput,
        tev: f64,
        baked: &[f64],
    ) -> ([f32; 4], usize) {
        let pair = |a: f32, b: f32| ([a, b, 0.0, 0.0], 2);
        let one = |a: f32| ([a, 0.0, 0.0, 0.0], 1);
        let three = |v: [f32; 3]| ([v[0], v[1], v[2], 0.0], 3);
        match self {
            Dyn::Tev => one(tev as f32),
            Dyn::BakeTev(plane) => one(baked[plane] as f32),
            // Spin stays in rendered parity; f64 CPU math aligns hosts before the shared f32 upload.
            Dyn::SpinPhase(rate) => one(spin_phase(rate, tev) as f32),
            Dyn::BakeSpinPhase(plane, rate) => one(spin_phase(rate, baked[plane]) as f32),
            Dyn::TwinklePhase => three(input.twinkle_phase),
            Dyn::Parallax => pair(input.parallax[0], input.parallax[1]),
            Dyn::Resolution => pair(view.span.w as f32, view.span.h as f32),
            Dyn::Aspect => one(view.aspect),
            Dyn::MarginScale => pair(view.margin_scale[0], view.margin_scale[1]),
            Dyn::PxPerUnit => one(view.px_per_unit),
            Dyn::Camera => pair(camera[0], camera[1]),
            Dyn::Depth(depth) => one(depth),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct DynSlot {
    block: usize,
    member: usize,
    ty: GlslType,
    value: Dyn,
}

#[derive(Debug, Clone, Copy)]
enum TexRef {
    /// Index into `Engine::targets`, then attachment.
    Attachment(usize, usize),
    /// Index into `Engine::textures`.
    Texture(usize),
}

#[derive(Debug, Clone, Copy)]
struct SamplerBind {
    unit: u32,
    source: TexRef,
}

#[derive(Debug, Clone, Copy)]
struct PassPlan {
    program: usize,
    /// `None` draws into the default framebuffer.
    target: Option<usize>,
    clear: bool,
    blend: Blend,
}

struct Geometry {
    vao: glow::VertexArray,
    /// Parallel to `ProgramSpec::attributes`; `None` where the linker dropped one.
    arrays: Vec<Option<glow::Buffer>>,
    index: glow::Buffer,
    count: i32,
    index_type: u32,
    instances: i32,
}

/// A dumped instance buffer that has to follow the runtime geometry.
#[derive(Debug, Clone, Copy)]
struct StarBuffer {
    program: usize,
    attribute: usize,
    aspect_scaled: bool,
}

pub struct Engine {
    bundle: Bundle,
    programs: Vec<GpuProgram>,
    geometry: Vec<Geometry>,
    dynamics: Vec<Vec<DynSlot>>,
    samplers: Vec<Vec<SamplerBind>>,
    textures: Vec<glow::Texture>,
    targets: Vec<RenderTarget>,
    passes: Vec<PassPlan>,
    /// Pass indices per plane, in bake order: the dust march first when owned.
    plane_passes: Vec<Vec<usize>>,
    /// Passes no plane bakes, in manifest order.
    frame_passes: Vec<usize>,
    scheduler: Scheduler,
    /// Completed rebakes per plane, for `--bench`.
    bake_counts: Vec<u32>,
    /// The tev each plane's targets currently hold, committed on a bake's last
    /// band. Compose warps galaxy spin against it, so it must never run ahead.
    plane_baked_tev: Vec<f64>,
    camera: [f32; 2],
    view: View,
    scissors: Vec<(i32, i32, i32, i32)>,
    sized: bool,
}

impl Engine {
    /// Compiles, links, and binds everything the bundle declares. No target is
    /// allocated until `resize` supplies a span.
    ///
    /// # Safety
    /// Requires a current GL ES 3 context matching `gl`.
    pub unsafe fn new(gl: &glow::Context, manifest: &[u8], blobs: &[u8]) -> Result<Engine> {
        let bundle = Bundle::load(manifest, blobs.to_vec())?;
        targets::require_float_targets(gl)?;

        // Every pass draws one front-facing quad into a depthless target.
        gl.disable(glow::CULL_FACE);
        gl.disable(glow::DEPTH_TEST);
        gl.disable(glow::SCISSOR_TEST);

        let m = &bundle.manifest;
        let mut textures = Vec::with_capacity(m.textures.len());
        for spec in &m.textures {
            textures.push(targets::upload_texture(gl, spec, bundle.blob(spec.blob)?)?);
        }

        let mut programs = Vec::with_capacity(m.programs.len());
        let mut geometry = Vec::with_capacity(m.programs.len());
        let mut dynamics = Vec::with_capacity(m.programs.len());
        let mut samplers = Vec::with_capacity(m.programs.len());
        for spec in &m.programs {
            let gpu = GpuProgram::build(gl, spec)?;
            geometry.push(build_geometry(gl, &bundle, spec, &gpu)?);

            let mut slots = Vec::new();
            for (block_index, block) in gpu.blocks.iter().enumerate() {
                for (member_index, member) in block.members.iter().enumerate() {
                    let declared = &spec.members[member.spec];
                    if let Some(key) = &declared.dynamic {
                        // The closed dynamic set is scalars and vec2s; a matrix here
                        // would only fail at the first frame's write.
                        if declared.ty.components() > 4 {
                            return Err(format!(
                                "program '{}' drives '{}' as {:?}, which no dynamic member may be",
                                spec.id, declared.name, declared.ty
                            )
                            .into());
                        }
                        slots.push(DynSlot {
                            block: block_index,
                            member: member_index,
                            ty: declared.ty,
                            value: Dyn::parse(key, &declared.name, &spec.id, &m.planes)?,
                        });
                    }
                }
            }
            dynamics.push(slots);

            let mut binds = Vec::with_capacity(gpu.samplers.len());
            for bind in &gpu.samplers {
                let source = match &spec.samplers[bind.spec].source {
                    SamplerSource::Target { target, attachment } => {
                        let index = index_of(&m.targets, |t| &t.id == target).ok_or_else(|| {
                            Error::from(format!("program '{}' samples unknown target '{target}'", spec.id))
                        })?;
                        TexRef::Attachment(index, *attachment)
                    }
                    SamplerSource::Texture { texture } => {
                        let index = index_of(&m.textures, |t| &t.id == texture).ok_or_else(|| {
                            Error::from(format!("program '{}' samples unknown texture '{texture}'", spec.id))
                        })?;
                        TexRef::Texture(index)
                    }
                };
                binds.push(SamplerBind { unit: bind.unit, source });
            }
            samplers.push(binds);
            programs.push(gpu);
        }

        let mut passes = Vec::with_capacity(m.passes.len());
        for pass in &m.passes {
            let program = index_of(&m.programs, |p| p.id == pass.program).ok_or_else(|| {
                Error::from(format!("pass '{}' draws unknown program '{}'", pass.id, pass.program))
            })?;
            let target = match &pass.target {
                Some(id) => Some(index_of(&m.targets, |t| &t.id == id).ok_or_else(|| {
                    Error::from(format!("pass '{}' draws into unknown target '{id}'", pass.id))
                })?),
                None => None,
            };
            passes.push(PassPlan {
                program,
                target,
                clear: pass.clear,
                blend: pass.blend.unwrap_or(m.programs[program].blend),
            });
        }

        let mut claimed = vec![false; passes.len()];
        let mut plane_passes = Vec::with_capacity(m.planes.len());
        let mut dust_owner: Option<usize> = None;
        for plane in &m.planes {
            let mut list = Vec::with_capacity(plane.passes.len() + 1);
            if plane.has_dust {
                let dust = index_of(&m.passes, |p| p.program == "dust").ok_or_else(|| {
                    Error::from(format!(
                        "plane {} owns the dust march but the bundle declares no 'dust' pass",
                        plane.id
                    ))
                })?;
                if let Some(other) = dust_owner {
                    return Err(format!(
                        "planes {other} and {} both claim the dust march, which would double-count its tau",
                        plane.id
                    )
                    .into());
                }
                dust_owner = Some(plane.id);
                claimed[dust] = true;
                list.push(dust);
            }
            // Pass id, never program id: two passes may share one program with
            // different targets, and only the id tells them apart.
            for id in &plane.passes {
                let pass = index_of(&m.passes, |p| &p.id == id).ok_or_else(|| {
                    Error::from(format!("plane {} bakes '{id}', which no pass declares", plane.id))
                })?;
                if claimed[pass] {
                    return Err(format!(
                        "plane {} bakes pass '{id}', which is already claimed",
                        plane.id
                    )
                    .into());
                }
                claimed[pass] = true;
                list.push(pass);
            }
            plane_passes.push(list);
        }
        let frame_passes = (0..passes.len()).filter(|i| !claimed[*i]).collect();

        let scores: Vec<f32> = m.planes.iter().map(|p| p.score).collect();
        let swirl: Vec<bool> = m
            .planes
            .iter()
            .map(|p| p.spin.iter().any(|s| s.swirl))
            .collect();
        let bake_counts = vec![0u32; m.planes.len()];
        let plane_baked_tev = vec![0.0f64; m.planes.len()];
        let camera = m.scene.camera;
        let span = Rect { x: 0, y: 0, w: 1, h: 1 };
        let view = View::new(span, 1.0, m.scene.max_parallax_px);

        Ok(Engine {
            bundle,
            programs,
            geometry,
            dynamics,
            samplers,
            textures,
            targets: Vec::new(),
            passes,
            plane_passes,
            frame_passes,
            scheduler: Scheduler::new(&scores, &swirl, 1),
            bake_counts,
            plane_baked_tev,
            camera,
            view,
            scissors: Vec::new(),
            sized: false,
        })
    }

    pub fn bundle(&self) -> &Bundle {
        &self.bundle
    }

    pub fn targets(&self) -> &[RenderTarget] {
        &self.targets
    }

    pub fn programs(&self) -> &[GpuProgram] {
        &self.programs
    }

    /// Parallel to `manifest.planes`. A banded bake counts once, on its last band.
    pub fn bake_counts(&self) -> &[u32] {
        &self.bake_counts
    }

    /// The composite's per-monitor scissors, `(x, y, w, h)` bottom-left origin and
    /// parallel to the rects `resize` was given. Also the presentation damage regions.
    pub fn scissors(&self) -> &[(i32, i32, i32, i32)] {
        &self.scissors
    }

    /// Splits every plane bake across `bands` frames; 1 bakes each plane whole.
    pub fn set_bands(&mut self, bands: u32) {
        let planes = &self.bundle.manifest.planes;
        let scores: Vec<f32> = planes.iter().map(|p| p.score).collect();
        let swirl: Vec<bool> = planes
            .iter()
            .map(|p| p.spin.iter().any(|s| s.swirl))
            .collect();
        self.scheduler = Scheduler::new(&scores, &swirl, bands);
    }

    /// Predicted spin displacement per plane, the native mirror of `spinDriftPx`
    /// in sky2d.js. A plane with no spinning galaxy prices at zero.
    fn spin_drift(&self, tev: f64) -> Vec<f32> {
        let px_per_unit = self.view.px_per_unit;
        self.bundle
            .manifest
            .planes
            .iter()
            .enumerate()
            .map(|(index, plane)| {
                let baked = self.plane_baked_tev[index];
                plane
                    .spin
                    .iter()
                    .map(|spec| spec.drift_px(tev, baked, px_per_unit))
                    .fold(0.0f32, f32::max)
            })
            .collect()
    }

    /// Adopts a new span and monitor layout: reallocates targets, re-evaluates
    /// every aspect and DPR fit, rescales the instance buffers, and dirties every plane.
    ///
    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn resize(&mut self, gl: &glow::Context, span: Rect, rects: &[Rect], dpr: f32) -> Result<()> {
        if !(dpr.is_finite() && dpr > 0.0) {
            return Err(format!("device pixel ratio {dpr} is not a positive number").into());
        }
        let pinned = &self.bundle.manifest.dpr_pinned;
        if !pinned.is_empty() && dpr != DUMP_DPR {
            return Err(format!(
                "this bundle pins {} to DPR {DUMP_DPR}, so it cannot run at DPR {dpr}; re-run the dumper",
                pinned.join(", ")
            )
            .into());
        }
        if span.w <= 0 || span.h <= 0 {
            return Err(format!("span {}x{} has no area", span.w, span.h).into());
        }

        self.view = View::new(span, dpr, self.bundle.manifest.scene.max_parallax_px);

        if self.targets.is_empty() {
            for spec in &self.bundle.manifest.targets {
                self.targets.push(RenderTarget::alloc(gl, spec, span.w, span.h)?);
            }
        } else {
            for target in &mut self.targets {
                if let Err(e) = target.resize(gl, span.w, span.h) {
                    // Some targets are the new size and some the old; refuse frames
                    // rather than composite that mix until a resize succeeds.
                    self.sized = false;
                    return Err(e);
                }
            }
        }

        for (i, gpu) in self.programs.iter_mut().enumerate() {
            let spec = &self.bundle.manifest.programs[i];
            for block in &mut gpu.blocks {
                block.fill_static(spec, self.view.aspect, dpr)?;
            }
        }

        self.rescale_instances(gl)?;

        self.scissors = rects
            .iter()
            .map(|m| {
                // X rects are top-left origin and glScissor is bottom-left.
                (m.x - span.x, span.h - (m.y - span.y) - m.h, m.w, m.h)
            })
            .collect();

        self.scheduler.mark_all_dirty();
        self.sized = true;
        Ok(())
    }

    /// Links, bakes every plane, and composites once, before the window is mapped:
    /// the one-plane-per-frame cap would otherwise composite undefined targets.
    ///
    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn warm_start(&mut self, gl: &glow::Context, input: FrameInput) -> Result<()> {
        self.require_span()?;
        let cap = self.plane_passes.len() * self.scheduler.bands().max(1) as usize + 1;
        for _ in 0..cap {
            let spin = self.spin_drift(input.tev);
            match self.scheduler.next(input.tev, &spin) {
                Some(bake) => self.run_bake(gl, bake, &input)?,
                None => break,
            }
        }
        for program in 0..self.programs.len() {
            self.write_dynamic(program, &input, input.tev)?;
        }
        self.run_frame_passes(gl, &input)?;
        check_errors(gl, "warm start")
    }

    /// One frame: dynamic writes, at most one plane rebake, then the per-frame passes.
    ///
    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn render(&mut self, gl: &glow::Context, input: FrameInput) -> Result<()> {
        self.require_span()?;
        let spin = self.spin_drift(input.tev);
        if let Some(bake) = self.scheduler.next(input.tev, &spin) {
            self.run_bake(gl, bake, &input)?;
        }
        // Dynamics write after the bake, or compose would warp this frame's fresh
        // plane against the previous bake's clock. run_bake writes its own first.
        for program in 0..self.programs.len() {
            self.write_dynamic(program, &input, input.tev)?;
        }
        self.run_frame_passes(gl, &input)
    }

    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn delete(&self, gl: &glow::Context) {
        for program in &self.programs {
            program.delete(gl);
        }
        for geometry in &self.geometry {
            gl.delete_vertex_array(geometry.vao);
            for buffer in geometry.arrays.iter().flatten() {
                gl.delete_buffer(*buffer);
            }
            gl.delete_buffer(geometry.index);
        }
        for texture in &self.textures {
            gl.delete_texture(*texture);
        }
        for target in &self.targets {
            target.delete(gl);
        }
    }

    fn require_span(&self) -> Result<()> {
        if self.sized {
            Ok(())
        } else {
            Err("Engine::resize has to run before the first frame".into())
        }
    }

    fn write_dynamic(&mut self, program: usize, input: &FrameInput, tev: f64) -> Result<()> {
        let view = self.view;
        let camera = self.camera;
        let baked = &self.plane_baked_tev;
        let gpu = &mut self.programs[program];
        for slot in &self.dynamics[program] {
            let (values, len) = slot.value.values(&view, camera, input, tev, baked);
            gpu.blocks[slot.block].write(slot.member, slot.ty, &values[..len])?;
        }
        Ok(())
    }

    /// Always rescales from the dumped geometry rather than from the previous
    /// span, so repeated respans cannot accumulate rounding drift.
    unsafe fn rescale_instances(&mut self, gl: &glow::Context) -> Result<()> {
        let Some(dump_span) = self.bundle.manifest.dump.span else {
            if self.star_buffers().is_empty() {
                return Ok(());
            }
            return Err("the bundle carries instanced star buffers but no dump.span to rescale them from".into());
        };
        let dump_aspect = dump_span[0] / dump_span[1].max(1.0);

        for star in self.star_buffers() {
            let spec = &self.bundle.manifest.programs[star.program];
            let attribute = &spec.attributes[star.attribute];
            let mut values: Vec<f32> = self
                .bundle
                .blob(attribute.blob)?
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            if star.aspect_scaled {
                stars::rescale_aspect(&mut values, dump_aspect, self.view.aspect)?;
            } else {
                stars::rescale_dpr(&mut values, DUMP_DPR, self.view.dpr)?;
            }
            let buffer = self.geometry[star.program].arrays[star.attribute].ok_or_else(|| {
                Error::from(format!(
                    "program '{}' declares instanced '{}' but the linker dropped it",
                    spec.id, attribute.name
                ))
            })?;
            let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(buffer));
            gl.buffer_sub_data_u8_slice(glow::ARRAY_BUFFER, 0, &bytes);
        }
        Ok(())
    }

    /// The bright tier is the only instanced draw carrying `iC`; galaxy sprites
    /// carry `iA`/`iB` only and are aspect-invariant by construction.
    fn star_buffers(&self) -> Vec<StarBuffer> {
        let mut found = Vec::new();
        for (program, spec) in self.bundle.manifest.programs.iter().enumerate() {
            let instanced = |name: &str| {
                spec.attributes
                    .iter()
                    .position(|a| a.name == name && a.divisor > 0)
            };
            let (Some(ia), Some(ic)) = (instanced("iA"), instanced("iC")) else {
                continue;
            };
            found.push(StarBuffer { program, attribute: ia, aspect_scaled: true });
            found.push(StarBuffer { program, attribute: ic, aspect_scaled: false });
        }
        found
    }

    unsafe fn run_bake(&mut self, gl: &glow::Context, bake: Bake, input: &FrameInput) -> Result<()> {
        for step in 0..self.plane_passes[bake.plane].len() {
            let pass = self.plane_passes[bake.plane][step];
            let program = self.passes[pass].program;
            // Later bands reuse the bake's tev so a plane never seams two moments.
            self.write_dynamic(program, input, bake.tev)?;
            let scissor = if bake.bands > 1 {
                let (width, height) = self.pass_size(pass);
                let (y, rows) = bake.rows(height);
                Some((0, y, width, rows))
            } else {
                None
            };
            self.draw(gl, pass, scissor)?;
        }
        if bake.is_last() {
            self.bake_counts[bake.plane] += 1;
            self.plane_baked_tev[bake.plane] = bake.tev;
        }
        Ok(())
    }

    unsafe fn run_frame_passes(&mut self, gl: &glow::Context, input: &FrameInput) -> Result<()> {
        // EGL_BUFFER_DESTROYED is the default swap behavior, so the void shows
        // stale frames unless the whole default framebuffer is cleared every frame.
        gl.bind_framebuffer(glow::FRAMEBUFFER, None);
        gl.disable(glow::SCISSOR_TEST);
        gl.viewport(0, 0, self.view.span.w, self.view.span.h);
        gl.clear_color(CLEAR_COLOR[0], CLEAR_COLOR[1], CLEAR_COLOR[2], CLEAR_COLOR[3]);
        gl.clear(glow::COLOR_BUFFER_BIT);

        for step in 0..self.frame_passes.len() {
            let pass = self.frame_passes[step];
            if self.passes[pass].target.is_none() && !self.scissors.is_empty() {
                for rect in 0..self.scissors.len() {
                    if !input.draws_rect(rect) {
                        continue;
                    }
                    let scissor = self.scissors[rect];
                    self.draw(gl, pass, Some(scissor))?;
                }
            } else {
                self.draw(gl, pass, None)?;
            }
        }
        Ok(())
    }

    fn pass_size(&self, pass: usize) -> (i32, i32) {
        match self.passes[pass].target {
            Some(target) => (self.targets[target].width, self.targets[target].height),
            None => (self.view.span.w, self.view.span.h),
        }
    }

    unsafe fn draw(&mut self, gl: &glow::Context, pass: usize, scissor: Option<(i32, i32, i32, i32)>) -> Result<()> {
        let plan = self.passes[pass];
        let (width, height) = self.pass_size(pass);
        let framebuffer = plan.target.map(|t| self.targets[t].framebuffer);

        gl.bind_framebuffer(glow::FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, width, height);
        match scissor {
            Some((x, y, w, h)) => {
                gl.enable(glow::SCISSOR_TEST);
                gl.scissor(x, y, w, h);
            }
            None => gl.disable(glow::SCISSOR_TEST),
        }
        if plan.clear {
            gl.clear_color(CLEAR_COLOR[0], CLEAR_COLOR[1], CLEAR_COLOR[2], CLEAR_COLOR[3]);
            gl.clear(glow::COLOR_BUFFER_BIT);
        }
        match plan.blend {
            Blend::None => gl.disable(glow::BLEND),
            Blend::Additive => {
                gl.enable(glow::BLEND);
                gl.blend_func(glow::ONE, glow::ONE);
            }
            Blend::Gxsprite => {
                gl.enable(glow::BLEND);
                gl.blend_func_separate(glow::ONE, glow::ONE, glow::ZERO, glow::ONE);
            }
        }

        let gpu = &mut self.programs[plan.program];
        gl.use_program(Some(gpu.program));
        for block in &mut gpu.blocks {
            block.bind(gl);
        }
        for bind in &self.samplers[plan.program] {
            let texture = match bind.source {
                TexRef::Attachment(target, attachment) => self.targets[target].textures[attachment],
                TexRef::Texture(index) => self.textures[index],
            };
            gl.active_texture(glow::TEXTURE0 + bind.unit);
            gl.bind_texture(glow::TEXTURE_2D, Some(texture));
        }

        let geometry = &self.geometry[plan.program];
        gl.bind_vertex_array(Some(geometry.vao));
        if geometry.instances > 0 {
            gl.draw_elements_instanced(
                glow::TRIANGLES,
                geometry.count,
                geometry.index_type,
                0,
                geometry.instances,
            );
        } else {
            gl.draw_elements(glow::TRIANGLES, geometry.count, geometry.index_type, 0);
        }
        Ok(())
    }
}

/// Drains the GL error queue, naming the stage that produced it.
///
/// # Safety
/// Requires a current GL context matching `gl`.
pub unsafe fn check_errors(gl: &glow::Context, what: &str) -> Result<()> {
    // Drained to empty either way: a code left queued would surface as a phantom
    // failure at the next check.
    let mut codes = Vec::new();
    loop {
        let code = gl.get_error();
        if code == glow::NO_ERROR {
            break;
        }
        if codes.len() < 8 {
            codes.push(format!("0x{code:X}"));
        }
    }
    if codes.is_empty() {
        Ok(())
    } else {
        Err(format!("{what} raised GL errors: {}", codes.join(", ")).into())
    }
}

unsafe fn build_geometry(
    gl: &glow::Context,
    bundle: &Bundle,
    spec: &ProgramSpec,
    gpu: &GpuProgram,
) -> Result<Geometry> {
    let index_spec = spec
        .index
        .as_ref()
        .ok_or_else(|| Error::from(format!("program '{}' declares no index buffer", spec.id)))?;

    let vao = gl
        .create_vertex_array()
        .map_err(|e| Error::from(format!("program '{}' VAO: {e}", spec.id)))?;
    gl.bind_vertex_array(Some(vao));

    let mut arrays = vec![None; spec.attributes.len()];
    for binding in &gpu.attributes {
        let attribute = &spec.attributes[binding.spec];
        let buffer = gl
            .create_buffer()
            .map_err(|e| Error::from(format!("program '{}' attribute '{}': {e}", spec.id, attribute.name)))?;
        gl.bind_buffer(glow::ARRAY_BUFFER, Some(buffer));
        gl.buffer_data_u8_slice(glow::ARRAY_BUFFER, bundle.blob(attribute.blob)?, glow::STATIC_DRAW);
        gl.enable_vertex_attrib_array(binding.location);
        gl.vertex_attrib_pointer_f32(binding.location, attribute.size as i32, glow::FLOAT, false, 0, 0);
        gl.vertex_attrib_divisor(binding.location, attribute.divisor);
        arrays[binding.spec] = Some(buffer);
    }

    let index = gl
        .create_buffer()
        .map_err(|e| Error::from(format!("program '{}' index buffer: {e}", spec.id)))?;
    gl.bind_buffer(glow::ELEMENT_ARRAY_BUFFER, Some(index));
    gl.buffer_data_u8_slice(
        glow::ELEMENT_ARRAY_BUFFER,
        bundle.blob(index_spec.blob)?,
        glow::STATIC_DRAW,
    );
    gl.bind_vertex_array(None);

    Ok(Geometry {
        vao,
        arrays,
        index,
        count: index_spec.count as i32,
        index_type: match index_spec.ty {
            IndexType::U16 => glow::UNSIGNED_SHORT,
            IndexType::U32 => glow::UNSIGNED_INT,
        },
        instances: spec.instances as i32,
    })
}

fn index_of<T>(items: &[T], matches: impl FnMut(&T) -> bool) -> Option<usize> {
    items.iter().position(matches)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_view_matches_the_browser_resize_math() {
        let span = Rect { x: 0, y: 0, w: 6560, h: 2560 };
        let view = View::new(span, 1.0, 25.0);
        assert!((view.aspect - 2.5625).abs() < 1e-6);
        // margin = ceil(25 × 1.5 × 1) + 2 = 40
        assert!((view.margin_scale[0] - (1.0 + 80.0 / 6560.0)).abs() < 1e-6);
        assert!((view.px_per_unit - 2560.0 / view.margin_scale[1]).abs() < 1e-3);
    }

    #[test]
    fn scissor_rects_flip_y_about_the_span() {
        // A 1440p panel sitting at the top of a 2560-tall span lands at y_gl 1120.
        let span = Rect { x: 0, y: 0, w: 6560, h: 2560 };
        let monitor = Rect { x: 2560, y: 0, w: 2560, h: 1440 };
        let y_gl = span.h - (monitor.y - span.y) - monitor.h;
        assert_eq!(y_gl, 1120);
    }
}
