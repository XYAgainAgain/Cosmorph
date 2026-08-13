//! The dumped scene: manifest types, blob slicing, and validation.
//! Nothing here computes a std140 offset; the driver is the authority on layout.

use std::collections::HashSet;

use serde::Deserialize;

use crate::{Error, Result};

pub const ARTIFACT_VERSION: u32 = 1;
pub const FORMAT: &str = "cosmorph-bundle";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub artifact_version: u32,
    #[serde(default)]
    pub engine_hash: String,
    #[serde(default)]
    pub three_revision: String,
    // Members whose DPR response has a clamp kink, so the host must refuse any DPR
    // but 1 while this is non-empty. Required: absent would read as unpinned.
    pub dpr_pinned: Vec<String>,
    #[serde(default)]
    pub git_commit: String,
    #[serde(default)]
    pub git_dirty: bool,
    #[serde(default)]
    pub built_at: String,
    pub scene: Scene,
    pub dump: Dump,
    /// The browser host's `setClearColor`, retained for provenance; `frame.rs`
    /// owns the value it actually clears with.
    #[serde(default)]
    pub clear_color: Option<[f32; 4]>,
    pub targets: Vec<TargetSpec>,
    pub programs: Vec<ProgramSpec>,
    pub passes: Vec<PassSpec>,
    pub planes: Vec<PlaneSpec>,
    pub blobs: Vec<BlobSpec>,
    #[serde(default)]
    pub textures: Vec<TextureSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub identity: String,
    pub seed: u64,
    pub saved_t: f64,
    pub evolution_rate: f32,
    pub camera: [f32; 2],
    pub max_parallax_px: f32,
    pub twinkle_active: bool,
    pub twinkle_rate: f32,
    pub clock_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dump {
    pub aspects: Vec<f32>,
    pub dprs: Vec<f32>,
    /// The span every attribute blob was captured at; its aspect is the origin
    /// the instance rescales start from. Absent only in hand-written fixtures.
    #[serde(default)]
    pub span: Option<[f32; 2]>,
    /// Bake cost the dumper measured, kept as provenance for `--bake-bands`.
    #[serde(default)]
    pub bake_ms: Option<BakeMs>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BakeMs {
    pub clean: f64,
    pub all_planes: f64,
    pub per_plane: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PixelFormat {
    Rgba16f,
    R16f,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetSpec {
    pub id: String,
    pub format: PixelFormat,
    /// The occlusion target carries a conservative max, so filtering it would
    /// average that away; older manifests predate the field and were all linear.
    #[serde(default = "linear")]
    pub filter: Filter,
    pub scale: f32,
    pub attachments: usize,
}

fn linear() -> Filter {
    Filter::Linear
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GlslType {
    Bool,
    Int,
    Uint,
    Float,
    Vec2,
    Vec3,
    Vec4,
    Ivec2,
    Ivec3,
    Ivec4,
    Uvec2,
    Uvec3,
    Uvec4,
    Mat2,
    Mat3,
    Mat4,
}

/// How a component's `f32` in the manifest has to reach the uniform buffer.
/// std140 stores all four in 4 bytes; only the bit pattern differs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScalarKind {
    Float,
    Int,
    Uint,
    Bool,
}

impl GlslType {
    pub fn components(self) -> usize {
        match self {
            GlslType::Bool | GlslType::Int | GlslType::Uint | GlslType::Float => 1,
            GlslType::Vec2 | GlslType::Ivec2 | GlslType::Uvec2 => 2,
            GlslType::Vec3 | GlslType::Ivec3 | GlslType::Uvec3 => 3,
            GlslType::Vec4 | GlslType::Ivec4 | GlslType::Uvec4 => 4,
            GlslType::Mat2 => 4,
            GlslType::Mat3 => 9,
            GlslType::Mat4 => 16,
        }
    }

    /// `(columns, rows)`, column-major like three's matrix element arrays.
    /// Matrix columns are written at the driver-reported stride, never packed.
    pub fn shape(self) -> (usize, usize) {
        match self {
            GlslType::Mat2 => (2, 2),
            GlslType::Mat3 => (3, 3),
            GlslType::Mat4 => (4, 4),
            other => (1, other.components()),
        }
    }

    pub fn scalar_kind(self) -> ScalarKind {
        match self {
            GlslType::Bool => ScalarKind::Bool,
            GlslType::Int | GlslType::Ivec2 | GlslType::Ivec3 | GlslType::Ivec4 => ScalarKind::Int,
            GlslType::Uint | GlslType::Uvec2 | GlslType::Uvec3 | GlslType::Uvec4 => ScalarKind::Uint,
            _ => ScalarKind::Float,
        }
    }
}

/// A JSON number or array of numbers. `1.35` and `[1.35]` are the same value.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Scalars {
    One(f32),
    Many(Vec<f32>),
}

impl Scalars {
    pub fn as_slice(&self) -> &[f32] {
        match self {
            Scalars::One(v) => std::slice::from_ref(v),
            Scalars::Many(v) => v,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FitBasis {
    #[default]
    Aspect,
    Dpr,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberSpec {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: GlslType,
    #[serde(default)]
    pub dynamic: Option<String>,
    #[serde(default)]
    pub value: Option<Scalars>,
    /// Flat `(a, b)` pairs per scalar component: `value = a + b * basis`.
    #[serde(default)]
    pub fit: Option<Scalars>,
    #[serde(default)]
    pub basis: FitBasis,
}

impl MemberSpec {
    /// Static value at this geometry. Dynamic members have none — the host writes those per frame.
    pub fn resolve(&self, aspect: f32, dpr: f32) -> Option<Vec<f32>> {
        if self.dynamic.is_some() {
            return None;
        }
        if let Some(value) = &self.value {
            return Some(value.as_slice().to_vec());
        }
        let fit = self.fit.as_ref()?;
        let x = match self.basis {
            FitBasis::Aspect => aspect,
            FitBasis::Dpr => dpr,
        };
        let pairs = fit.as_slice();
        Some(pairs.chunks_exact(2).map(|ab| ab[0] + ab[1] * x).collect())
    }

    fn validate(&self, program: &str) -> Result<()> {
        let kinds = self.dynamic.is_some() as u32
            + self.value.is_some() as u32
            + self.fit.is_some() as u32;
        if kinds != 1 {
            return Err(format!(
                "program '{}' member '{}' must carry exactly one of dynamic, value, or fit ({} given)",
                program, self.name, kinds
            )
            .into());
        }
        let want = self.ty.components();
        if let Some(value) = &self.value {
            let got = value.as_slice().len();
            if got != want {
                return Err(format!(
                    "program '{}' member '{}' is {:?} ({} components) but carries {} value(s)",
                    program, self.name, self.ty, want, got
                )
                .into());
            }
        }
        if let Some(fit) = &self.fit {
            let got = fit.as_slice().len();
            if got != want * 2 {
                return Err(format!(
                    "program '{}' member '{}' is {:?} and needs {} fit coefficients, got {}",
                    program,
                    self.name,
                    self.ty,
                    want * 2,
                    got
                )
                .into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum SamplerSource {
    Target {
        target: String,
        #[serde(default)]
        attachment: usize,
    },
    Texture {
        texture: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SamplerSpec {
    pub name: String,
    pub source: SamplerSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttributeSpec {
    pub name: String,
    pub size: usize,
    pub blob: usize,
    #[serde(default)]
    pub divisor: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexType {
    U16,
    U32,
}

impl IndexType {
    pub fn size_bytes(self) -> usize {
        match self {
            IndexType::U16 => 2,
            IndexType::U32 => 4,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexSpec {
    pub blob: usize,
    pub count: usize,
    #[serde(rename = "type")]
    pub ty: IndexType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Blend {
    #[default]
    None,
    Additive,
    /// Baked galaxy sprites: RGB ONE/ONE, alpha ZERO/ONE, so sprite alpha cannot
    /// corrupt the occluder tau the bright tier reads back out of RT B.
    Gxsprite,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlockRef {
    pub name: String,
    pub stage: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgramSpec {
    pub id: String,
    pub vert: String,
    pub frag: String,
    /// The std140 blocks the dumper saw, as provenance. Layout comes from the
    /// driver's own reflection, never from this.
    #[serde(default)]
    pub blocks: Vec<BlockRef>,
    pub members: Vec<MemberSpec>,
    #[serde(default)]
    pub samplers: Vec<SamplerSpec>,
    #[serde(default)]
    pub attributes: Vec<AttributeSpec>,
    #[serde(default)]
    pub index: Option<IndexSpec>,
    #[serde(default)]
    pub blend: Blend,
    #[serde(default)]
    pub instances: usize,
}

impl ProgramSpec {
    pub fn member(&self, name: &str) -> Option<&MemberSpec> {
        self.members.iter().find(|m| m.name == name)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PassSpec {
    /// The dumper's pass id, unique across the manifest. Planes schedule by this;
    /// `program` is only ever a shader and geometry lookup, and passes may share one.
    pub id: String,
    pub program: String,
    /// `None` composes into the default framebuffer.
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub clear: bool,
    #[serde(default)]
    pub blend: Option<Blend>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaneSpec {
    pub id: usize,
    pub name: String,
    pub depth_uniform: String,
    pub depth: f32,
    pub score: f32,
    #[serde(default)]
    pub has_dust: bool,
    /// Galaxy `uGxBakeTev` members this plane drives from its own bake clock.
    #[serde(default)]
    pub bake_tev_uniforms: Vec<String>,
    /// Spin pricing for every spinning galaxy this plane carries, swirled or
    /// demoted. Empty on manifests dumped before spin existed.
    #[serde(default)]
    pub spin: Vec<SpinSpec>,
    pub passes: Vec<String>,
}

/// The evolution clock's own wrap; `wrap / CLOCK_H` recovers the scene's
/// evolution rate. Mirrors `SPIN_CLOCK_H` in engine/shaders/tsl/spin.js.
const CLOCK_H: f64 = 4096.0;
/// Real hours a demoted galaxy waits between rebakes, per `SPIN_DEMOTED_MIN_H`.
const DEMOTED_MIN_H: f64 = 0.05;

/// One spinning galaxy's rebake pricing. Angles are magnitudes: a negative
/// pattern speed drifts exactly as fast as a positive one.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpinSpec {
    /// Disc radius in sky units; the host scales it by its own px-per-unit.
    pub radius: f32,
    /// Rigid pattern speed, rad/h.
    pub rigid: f32,
    /// The same speed, signed. Wrapped against the clock into `phase_uniform`.
    #[serde(default)]
    pub rate: f64,
    /// Prewrapped Ωp·T, and its value at this plane's last bake. Empty on
    /// manifests dumped before the phase uniforms existed.
    #[serde(default)]
    pub phase_uniform: String,
    #[serde(default)]
    pub bake_phase_uniform: String,
    /// Saturated core lead, rad.
    pub lead: f32,
    pub sat_ramp: f32,
    /// uTev's wrap in hours, 4096 × the evolution rate.
    pub wrap: f32,
    /// Compose carries this galaxy's rotation between rebakes.
    pub swirl: bool,
}

/// Ωp·T wrapped to (−π, π], mirroring `spinPhaseAt` in spin.js. Computed in
/// f64: the raw product runs past f32's resolution at a high evolution rate.
pub fn spin_phase(rate: f64, tev: f64) -> f64 {
    const TAU: f64 = std::f64::consts::TAU;
    let p = rate * tev;
    p - TAU * (p / TAU).round()
}

impl SpinSpec {
    /// Mirrors `spinDriftPx` in engine/shaders/tsl/spin.js: predicted pixels the
    /// pattern has moved since this plane was baked.
    pub fn drift_px(&self, tev: f64, baked_tev: f64, px_per_unit: f32) -> f32 {
        let dt = (tev - baked_tev).abs();
        let rigid = !self.swirl;
        if rigid && dt < DEMOTED_MIN_H * (self.wrap as f64 / CLOCK_H) {
            return 0.0;
        }
        let wrap = self.wrap as f64;
        let sat_ramp = self.sat_ramp.max(1e-6) as f64;
        let sat = |t: f64| {
            let s = |x: f64| {
                let u = (x / sat_ramp).clamp(0.0, 1.0);
                u * u * (3.0 - 2.0 * u)
            };
            s(t) * s(wrap - t)
        };
        let shear = self.lead as f64 * (sat(tev) - sat(baked_tev)).abs();
        let turn = if rigid { self.rigid as f64 * dt } else { 0.0 };
        ((shear + turn) * self.radius as f64 * px_per_unit as f64) as f32
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dtype {
    U8,
    F16,
    I16,
    U16,
    I32,
    U32,
    F32,
}

impl Dtype {
    pub fn size_bytes(self) -> usize {
        match self {
            Dtype::U8 => 1,
            Dtype::F16 | Dtype::I16 | Dtype::U16 => 2,
            Dtype::I32 | Dtype::U32 | Dtype::F32 => 4,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlobSpec {
    pub id: usize,
    pub offset: usize,
    pub len: usize,
    pub dtype: Dtype,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Filter {
    Nearest,
    Linear,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Wrap {
    Clamp,
    Repeat,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextureSpec {
    pub id: String,
    pub blob: usize,
    pub size: usize,
    /// Byte length of the source asset, cross-checked against the blob slice.
    #[serde(default)]
    pub bytes: Option<usize>,
    pub format: PixelFormat,
    pub filter: Filter,
    pub wrap: Wrap,
    #[serde(default)]
    pub mips: bool,
    /// Repo-relative path the asset was copied from, for provenance.
    #[serde(default)]
    pub path: Option<String>,
}

pub struct Bundle {
    pub manifest: Manifest,
    blobs: Vec<u8>,
}

impl std::fmt::Debug for Bundle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Bundle {{ engineHash: {}, builtAt: {}, gitCommit: {}{}, programs: {}, targets: {}, blob bytes: {} }}",
            self.manifest.engine_hash,
            self.manifest.built_at,
            self.manifest.git_commit,
            if self.manifest.git_dirty { " (dirty)" } else { "" },
            self.manifest.programs.len(),
            self.manifest.targets.len(),
            self.blobs.len()
        )
    }
}

impl Bundle {
    /// Parses and fully validates. Every failure names the offending id.
    pub fn load(manifest_json: &[u8], blobs: Vec<u8>) -> Result<Bundle> {
        let manifest: Manifest = serde_json::from_slice(manifest_json).map_err(|e| {
            // Every other id-bearing spec has carried one since v1, so a missing
            // `id` can only be a bundle dumped before passes[] gained theirs.
            if e.to_string().contains("missing field `id`") {
                Error::from(format!(
                    "this bundle predates the pass-id schema: every entry in passes[] now needs a \
                     unique \"id\" carrying its dumper pass id (e.g. \"plane0.a\"), and no bundle \
                     dumped before that change has one. Re-run .dev/tools/glsl-dump to re-dump it. \
                     (serde: {e})"
                ))
            } else {
                Error::from(format!("bundle.json did not parse: {e}"))
            }
        })?;
        let bundle = Bundle { manifest, blobs };
        bundle.validate()?;
        Ok(bundle)
    }

    pub fn blob_bytes(&self) -> usize {
        self.blobs.len()
    }

    pub fn blob(&self, id: usize) -> Result<&[u8]> {
        let spec = self
            .manifest
            .blobs
            .iter()
            .find(|b| b.id == id)
            .ok_or_else(|| Error::from(format!("blob {id} is not declared in the bundle")))?;
        Ok(&self.blobs[spec.offset..spec.offset + spec.len])
    }

    pub fn program(&self, id: &str) -> Result<&ProgramSpec> {
        self.manifest
            .programs
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| Error::from(format!("program '{id}' is not declared in the bundle")))
    }

    pub fn pass(&self, id: &str) -> Result<&PassSpec> {
        self.manifest
            .passes
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| Error::from(format!("pass '{id}' is not declared in the bundle")))
    }

    pub fn target(&self, id: &str) -> Result<&TargetSpec> {
        self.manifest
            .targets
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| Error::from(format!("target '{id}' is not declared in the bundle")))
    }

    pub fn texture(&self, id: &str) -> Result<&TextureSpec> {
        self.manifest
            .textures
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| Error::from(format!("texture '{id}' is not declared in the bundle")))
    }

    fn validate(&self) -> Result<()> {
        let m = &self.manifest;
        if m.format != FORMAT {
            return Err(format!(
                "bundle format is '{}', expected '{}'",
                m.format, FORMAT
            )
            .into());
        }
        if m.artifact_version != ARTIFACT_VERSION {
            return Err(format!(
                "bundle artifactVersion {} does not match this host's {}; re-run the dumper",
                m.artifact_version, ARTIFACT_VERSION
            )
            .into());
        }

        unique(m.targets.iter().map(|t| t.id.as_str()), "target id")?;
        unique(m.programs.iter().map(|p| p.id.as_str()), "program id")?;
        unique(m.textures.iter().map(|t| t.id.as_str()), "texture id")?;
        unique(m.passes.iter().map(|p| p.id.as_str()), "pass id")?;

        let mut blob_ids = HashSet::new();
        for blob in &m.blobs {
            if !blob_ids.insert(blob.id) {
                return Err(format!("blob id {} is declared twice", blob.id).into());
            }
            let end = blob
                .offset
                .checked_add(blob.len)
                .ok_or_else(|| Error::from(format!("blob {} overflows its extent", blob.id)))?;
            if end > self.blobs.len() {
                return Err(format!(
                    "blob {} runs to byte {} but bundle.bin is {} bytes",
                    blob.id,
                    end,
                    self.blobs.len()
                )
                .into());
            }
            if blob.len % blob.dtype.size_bytes() != 0 {
                return Err(format!(
                    "blob {} is {} bytes, not a whole number of {:?}",
                    blob.id, blob.len, blob.dtype
                )
                .into());
            }
        }

        for t in &m.targets {
            if t.attachments == 0 {
                return Err(format!("target '{}' declares zero attachments", t.id).into());
            }
            if !(t.scale.is_finite() && t.scale > 0.0) {
                return Err(format!("target '{}' has a non-positive scale {}", t.id, t.scale).into());
            }
        }

        for tex in &m.textures {
            let bytes = self.blob(tex.blob).map_err(|e| {
                Error::from(format!("texture '{}': {}", tex.id, e.message()))
            })?;
            let want = tex.size * tex.size * 8;
            if bytes.len() != want {
                return Err(format!(
                    "texture '{}' is {}x{} rgba16f ({} bytes) but its blob holds {}",
                    tex.id,
                    tex.size,
                    tex.size,
                    want,
                    bytes.len()
                )
                .into());
            }
        }

        for p in &m.programs {
            unique(
                p.members.iter().map(|x| x.name.as_str()),
                &format!("member name in program '{}'", p.id),
            )?;
            unique(
                p.samplers.iter().map(|x| x.name.as_str()),
                &format!("sampler name in program '{}'", p.id),
            )?;
            unique(
                p.attributes.iter().map(|x| x.name.as_str()),
                &format!("attribute name in program '{}'", p.id),
            )?;

            for member in &p.members {
                member.validate(&p.id)?;
            }

            for s in &p.samplers {
                match &s.source {
                    SamplerSource::Target { target, attachment } => {
                        let t = self.target(target).map_err(|e| {
                            Error::from(format!(
                                "program '{}' sampler '{}': {}",
                                p.id,
                                s.name,
                                e.message()
                            ))
                        })?;
                        if *attachment >= t.attachments {
                            return Err(format!(
                                "program '{}' sampler '{}' reads attachment {} of target '{}', which has {}",
                                p.id, s.name, attachment, t.id, t.attachments
                            )
                            .into());
                        }
                    }
                    SamplerSource::Texture { texture } => {
                        self.texture(texture).map_err(|e| {
                            Error::from(format!(
                                "program '{}' sampler '{}': {}",
                                p.id,
                                s.name,
                                e.message()
                            ))
                        })?;
                    }
                }
            }

            for a in &p.attributes {
                if a.size == 0 || a.size > 4 {
                    return Err(format!(
                        "program '{}' attribute '{}' has size {}, must be 1-4",
                        p.id, a.name, a.size
                    )
                    .into());
                }
                self.blob(a.blob).map_err(|e| {
                    Error::from(format!(
                        "program '{}' attribute '{}': {}",
                        p.id,
                        a.name,
                        e.message()
                    ))
                })?;
            }

            if let Some(index) = &p.index {
                let bytes = self.blob(index.blob).map_err(|e| {
                    Error::from(format!("program '{}' index: {}", p.id, e.message()))
                })?;
                let want = index.count * index.ty.size_bytes();
                if bytes.len() < want {
                    return Err(format!(
                        "program '{}' draws {} indices ({} bytes) from a {}-byte blob",
                        p.id,
                        index.count,
                        want,
                        bytes.len()
                    )
                    .into());
                }
            }
        }

        for pass in &m.passes {
            self.program(&pass.program).map_err(|e| {
                Error::from(format!("pass '{}': {}", pass.id, e.message()))
            })?;
            if let Some(target) = &pass.target {
                self.target(target).map_err(|e| {
                    Error::from(format!("pass '{}': {}", pass.id, e.message()))
                })?;
            }
        }

        let mut plane_ids = HashSet::new();
        for (index, plane) in m.planes.iter().enumerate() {
            if plane.id != index {
                return Err(format!(
                    "plane '{}' has id {}, but its manifest index is {index}",
                    plane.name, plane.id
                )
                .into());
            }
            if !plane_ids.insert(plane.id) {
                return Err(format!("plane id {} is declared twice", plane.id).into());
            }
            for id in &plane.passes {
                self.pass(id).map_err(|e| {
                    Error::from(format!("plane {}: {}", plane.id, e.message()))
                })?;
            }
        }

        Ok(())
    }
}

fn unique<'a>(items: impl Iterator<Item = &'a str>, what: &str) -> Result<()> {
    let mut seen = HashSet::new();
    for item in items {
        if !seen.insert(item) {
            return Err(format!("duplicate {what}: '{item}'").into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One target, one program, one blob: the smallest manifest that exercises
    /// every cross-reference validate() makes.
    fn manifest(patch: &str) -> String {
        let base = r#"{
          "format": "cosmorph-bundle", "artifactVersion": 1, "dprPinned": [],
          "scene": { "identity": "t", "seed": 40451906, "savedT": 1736.27,
                     "evolutionRate": 1, "camera": [0, 0], "maxParallaxPx": 25,
                     "twinkleActive": true, "twinkleRate": 1800, "clockKey": "k" },
          "dump": { "aspects": [2.5625], "dprs": [1] },
          "clearColor": [0, 0, 0, 1],
          "targets": [{ "id": "plane0.a", "format": "rgba16f", "scale": 1.0, "attachments": 1 }],
          "programs": [{ "id": "compose", "vert": "v", "frag": "f",
            "blocks": [{ "name": "NodeBuffer", "stage": "fragment" }],
            "members": [{ "name": "uTev", "type": "float", "dynamic": "tev" },
                        { "name": "uAspect", "type": "float", "fit": [0.5, 2.0] },
                        { "name": "uPalette", "type": "mat3", "value": [1,0,0,0,1,0,0,0,1] }],
            "samplers": [{ "name": "texPlaneA0", "source": { "target": "plane0.a" } }],
            "attributes": [{ "name": "position", "size": 3, "blob": 0 }],
            "blend": "none", "instances": 0 }],
          "passes": [{ "id": "compose", "program": "compose", "target": null, "clear": false }],
          "planes": [{ "id": 0, "name": "deep", "depthUniform": "uPlaneDeep", "depth": 0.09667,
                       "score": 0.26, "hasDust": false, "passes": ["compose"] }],
          "blobs": [{ "id": 0, "offset": 0, "len": 12, "dtype": "f32" }],
          "textures": []
        }"#;
        base.replace("\"len\": 12", patch)
    }

    fn load(patch: &str) -> Result<Bundle> {
        Bundle::load(manifest(patch).as_bytes(), vec![0u8; 12])
    }

    #[test]
    fn plane_ids_must_match_manifest_positions() {
        let json = manifest("\"len\": 12").replace(
            "\"id\": 0, \"name\": \"deep\"",
            "\"id\": 7, \"name\": \"deep\"",
        );
        let err = Bundle::load(json.as_bytes(), vec![0u8; 12]).unwrap_err();
        assert_eq!(
            err.message(),
            "plane 'deep' has id 7, but its manifest index is 0"
        );
    }

    #[test]
    fn accepts_a_well_formed_bundle() {
        let bundle = load("\"len\": 12").expect("should validate");
        assert_eq!(bundle.blob(0).unwrap().len(), 12);
        assert_eq!(bundle.program("compose").unwrap().members.len(), 3);
    }

    #[test]
    fn spin_phase_keeps_subpixel_time_past_f32_integer_precision() {
        let tev = 16_777_216.25;
        let phase = spin_phase(1.0, tev);
        let narrowed = spin_phase(1.0, tev as f32 as f64);
        assert!((phase - narrowed).abs() > 0.1);
    }

    #[test]
    fn rejects_a_blob_past_the_end_of_the_blob_file() {
        let err = load("\"len\": 16").unwrap_err();
        assert!(err.message().contains("bundle.bin is 12 bytes"), "{err}");
    }

    #[test]
    fn rejects_an_unresolved_sampler_source() {
        let json = manifest("\"len\": 12").replace("plane0.a\" } }", "plane9.a\" } }");
        let err = Bundle::load(json.as_bytes(), vec![0u8; 12]).unwrap_err();
        assert!(err.message().contains("plane9.a"), "{err}");
    }

    #[test]
    fn rejects_a_member_carrying_no_value() {
        let json = manifest("\"len\": 12").replace("\"dynamic\": \"tev\"", "\"basis\": \"aspect\"");
        let err = Bundle::load(json.as_bytes(), vec![0u8; 12]).unwrap_err();
        assert!(err.message().contains("uTev"), "{err}");
    }

    #[test]
    fn rejects_a_stale_artifact_version() {
        let json = manifest("\"len\": 12").replace("\"artifactVersion\": 1", "\"artifactVersion\": 2");
        let err = Bundle::load(json.as_bytes(), vec![0u8; 12]).unwrap_err();
        assert!(err.message().contains("artifactVersion 2"), "{err}");
    }

    #[test]
    fn rejects_two_passes_claiming_one_id() {
        let json = manifest("\"len\": 12").replace(
            r#"{ "id": "compose", "program": "compose", "target": null, "clear": false }"#,
            r#"{ "id": "compose", "program": "compose", "target": null, "clear": false },
               { "id": "compose", "program": "compose", "target": "plane0.a", "clear": true }"#,
        );
        let err = Bundle::load(json.as_bytes(), vec![0u8; 12]).unwrap_err();
        assert!(err.message().contains("duplicate pass id: 'compose'"), "{err}");
    }

    /// Two passes may share one program, so a plane naming a program is a miss.
    #[test]
    fn rejects_a_plane_referencing_a_pass_that_does_not_exist() {
        let json = manifest("\"len\": 12").replace(r#""passes": ["compose"]"#, r#""passes": ["plane0.b"]"#);
        let err = Bundle::load(json.as_bytes(), vec![0u8; 12]).unwrap_err();
        assert!(
            err.message().contains("plane 0") && err.message().contains("pass 'plane0.b'"),
            "{err}"
        );
    }

    #[test]
    fn rejects_a_misspelled_manifest_field() {
        let json = manifest("\"len\": 12").replace("\"dprPinned\"", "\"dprPined\"");
        let err = Bundle::load(json.as_bytes(), vec![0u8; 12]).unwrap_err();
        assert!(err.message().contains("dprPined"), "{err}");
    }

    #[test]
    fn names_the_pass_id_schema_change_when_a_pass_carries_none() {
        let json = manifest("\"len\": 12").replace(r#""id": "compose", "program""#, r#""program""#);
        let err = Bundle::load(json.as_bytes(), vec![0u8; 12]).unwrap_err();
        assert!(err.message().contains("predates the pass-id schema"), "{err}");
        assert!(err.message().contains("re-dump"), "{err}");
    }

    #[test]
    fn evaluates_fits_and_static_values() {
        let bundle = load("\"len\": 12").unwrap();
        let program = bundle.program("compose").unwrap();
        assert_eq!(program.member("uTev").unwrap().resolve(2.5625, 1.0), None);
        assert_eq!(
            program.member("uAspect").unwrap().resolve(2.5625, 1.0),
            Some(vec![0.5 + 2.0 * 2.5625])
        );
        assert_eq!(
            program.member("uPalette").unwrap().resolve(2.5625, 1.0).unwrap().len(),
            9
        );
    }
}
