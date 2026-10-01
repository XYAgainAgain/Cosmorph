//! Render targets and static textures: half-float, CLAMP_TO_EDGE, no mips, no
//! depth, format and filter per the manifest. Bake targets are framebuffer-sized;
//! overscan lives in the sampling domain.

use glow::HasContext;

use crate::bundle::{Filter, PixelFormat, TargetSpec, TextureSpec, Wrap};
use crate::frame::check_errors;
use crate::{Error, Result};

pub struct RenderTarget {
    pub id: String,
    /// One per layer, each attaching that layer of every attachment.
    pub framebuffers: Vec<glow::Framebuffer>,
    pub textures: Vec<glow::Texture>,
    pub scale: f32,
    pub width: i32,
    pub height: i32,
    pub layers: usize,
    format: PixelFormat,
}

/// `(internal format, format)` for `tex_image_2d` and `tex_image_3d`; the type is always HALF_FLOAT.
fn gl_format(format: PixelFormat) -> (i32, u32) {
    match format {
        PixelFormat::Rgba16f => (glow::RGBA16F as i32, glow::RGBA),
        PixelFormat::R16f => (glow::R16F as i32, glow::RED),
    }
}

/// The half-float color-buffer gate, checked before a single target is allocated.
///
/// # Safety
/// Requires a current GL context matching `gl`.
pub unsafe fn require_float_targets(gl: &glow::Context) -> Result<()> {
    let extensions = gl.supported_extensions();
    let ok = ["EXT_color_buffer_half_float", "EXT_color_buffer_float"]
        .iter()
        .any(|name| {
            extensions.contains(*name) || extensions.contains(&format!("GL_{name}"))
        });
    if ok {
        Ok(())
    } else {
        Err("this GL context supports neither EXT_color_buffer_half_float nor \
             EXT_color_buffer_float, so no RGBA16F render target can be allocated"
            .into())
    }
}

pub fn scaled(span: i32, scale: f32) -> i32 {
    ((span as f32 * scale).round() as i32).max(1)
}

impl RenderTarget {
    /// `TEXTURE_2D_ARRAY` for a layered target, which is also how compose binds it.
    pub fn bind_target(&self) -> u32 {
        texture_target(self.layers)
    }

    /// The framebuffer drawing into `layer`, clamped so a 2D target ignores it.
    pub fn framebuffer(&self, layer: usize) -> glow::Framebuffer {
        self.framebuffers[layer.min(self.framebuffers.len() - 1)]
    }

    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn alloc(
        gl: &glow::Context,
        spec: &TargetSpec,
        span_w: i32,
        span_h: i32,
    ) -> Result<RenderTarget> {
        let mut target = RenderTarget {
            id: spec.id.clone(),
            framebuffers: Vec::with_capacity(spec.layers),
            textures: Vec::with_capacity(spec.attachments),
            scale: spec.scale,
            width: scaled(span_w, spec.scale),
            height: scaled(span_h, spec.scale),
            layers: spec.layers.max(1),
            format: spec.format,
        };
        if let Err(e) = target.build(gl, spec.filter, spec.attachments) {
            target.delete(gl);
            return Err(e);
        }
        Ok(target)
    }

    unsafe fn build(&mut self, gl: &glow::Context, filter: Filter, attachments: usize) -> Result<()> {
        let bind = self.bind_target();
        for i in 0..attachments {
            let texture = gl
                .create_texture()
                .map_err(|e| Error::from(format!("target '{}' texture {i}: {e}", self.id)))?;
            self.textures.push(texture);
            gl.bind_texture(bind, Some(texture));
            self.store(gl, texture);
            set_sampling(gl, bind, filter, Wrap::Clamp);
        }
        for layer in 0..self.layers {
            let framebuffer = gl.create_framebuffer().map_err(|e| {
                Error::from(format!("target '{}' framebuffer {layer}: {e}", self.id))
            })?;
            self.framebuffers.push(framebuffer);
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(framebuffer));
            let mut draw_buffers = Vec::with_capacity(self.textures.len());
            for (i, texture) in self.textures.iter().enumerate() {
                let attachment = glow::COLOR_ATTACHMENT0 + i as u32;
                if self.layers > 1 {
                    gl.framebuffer_texture_layer(glow::FRAMEBUFFER, attachment, Some(*texture), 0, layer as i32);
                } else {
                    gl.framebuffer_texture_2d(glow::FRAMEBUFFER, attachment, glow::TEXTURE_2D, Some(*texture), 0);
                }
                draw_buffers.push(attachment);
            }
            gl.draw_buffers(&draw_buffers);
        }
        self.complete(gl)?;
        self.clear(gl);
        Ok(())
    }

    /// (Re)specifies one texture's storage at the current size.
    unsafe fn store(&self, gl: &glow::Context, texture: glow::Texture) {
        let (internal, layout) = gl_format(self.format);
        gl.bind_texture(self.bind_target(), Some(texture));
        if self.layers > 1 {
            gl.tex_image_3d(
                glow::TEXTURE_2D_ARRAY,
                0,
                internal,
                self.width,
                self.height,
                self.layers as i32,
                0,
                layout,
                glow::HALF_FLOAT,
                glow::PixelUnpackData::Slice(None),
            );
        } else {
            gl.tex_image_2d(
                glow::TEXTURE_2D,
                0,
                internal,
                self.width,
                self.height,
                0,
                layout,
                glow::HALF_FLOAT,
                glow::PixelUnpackData::Slice(None),
            );
        }
    }

    unsafe fn complete(&self, gl: &glow::Context) -> Result<()> {
        for (layer, framebuffer) in self.framebuffers.iter().enumerate() {
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(*framebuffer));
            let status = gl.check_framebuffer_status(glow::FRAMEBUFFER);
            if status != glow::FRAMEBUFFER_COMPLETE {
                gl.bind_framebuffer(glow::FRAMEBUFFER, None);
                return Err(format!(
                    "target '{}' layer {layer} is incomplete at {}x{} (status 0x{status:X})",
                    self.id, self.width, self.height
                )
                .into());
            }
        }
        gl.bind_framebuffer(glow::FRAMEBUFFER, None);
        Ok(())
    }

    /// Zeroes every layer. GL leaves fresh storage undefined, and compose mixes
    /// the idle back layer at weight 0, which still turns a NaN texel into NaN.
    unsafe fn clear(&self, gl: &glow::Context) {
        gl.disable(glow::SCISSOR_TEST);
        gl.clear_color(0.0, 0.0, 0.0, 0.0);
        for framebuffer in &self.framebuffers {
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(*framebuffer));
            gl.clear(glow::COLOR_BUFFER_BIT);
        }
        gl.bind_framebuffer(glow::FRAMEBUFFER, None);
    }

    /// Reallocates every attachment for a new span. On failure the target's
    /// storage is undefined, so the caller must not draw into it again.
    ///
    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn resize(&mut self, gl: &glow::Context, span_w: i32, span_h: i32) -> Result<()> {
        let width = scaled(span_w, self.scale);
        let height = scaled(span_h, self.scale);
        if width == self.width && height == self.height {
            return Ok(());
        }
        // Anything already queued would otherwise be blamed on this reallocation.
        let _ = check_errors(gl, "before target reallocation");

        self.width = width;
        self.height = height;
        for texture in &self.textures {
            self.store(gl, *texture);
        }
        self.complete(gl)?;
        self.clear(gl);
        check_errors(
            gl,
            &format!("target '{}' reallocated to {width}x{height}", self.id),
        )
    }

    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn delete(&self, gl: &glow::Context) {
        for texture in &self.textures {
            gl.delete_texture(*texture);
        }
        for framebuffer in &self.framebuffers {
            gl.delete_framebuffer(*framebuffer);
        }
    }
}

fn texture_target(layers: usize) -> u32 {
    if layers > 1 {
        glow::TEXTURE_2D_ARRAY
    } else {
        glow::TEXTURE_2D
    }
}

/// Uploads a bundled RGBA16F field map (shape SDF assets).
///
/// # Safety
/// Requires a current GL context matching `gl`.
pub unsafe fn upload_texture(
    gl: &glow::Context,
    spec: &TextureSpec,
    data: &[u8],
) -> Result<glow::Texture> {
    let texture = gl
        .create_texture()
        .map_err(|e| Error::from(format!("texture '{}': {e}", spec.id)))?;
    gl.bind_texture(glow::TEXTURE_2D, Some(texture));
    gl.tex_image_2d(
        glow::TEXTURE_2D,
        0,
        glow::RGBA16F as i32,
        spec.size as i32,
        spec.size as i32,
        0,
        glow::RGBA,
        glow::HALF_FLOAT,
        glow::PixelUnpackData::Slice(Some(data)),
    );
    set_sampling(gl, glow::TEXTURE_2D, spec.filter, spec.wrap);
    if spec.mips {
        gl.generate_mipmap(glow::TEXTURE_2D);
    }
    Ok(texture)
}

unsafe fn set_sampling(gl: &glow::Context, target: u32, filter: Filter, wrap: Wrap) {
    let filter = match filter {
        Filter::Linear => glow::LINEAR,
        Filter::Nearest => glow::NEAREST,
    } as i32;
    let wrap = match wrap {
        Wrap::Clamp => glow::CLAMP_TO_EDGE,
        Wrap::Repeat => glow::REPEAT,
    } as i32;
    gl.tex_parameter_i32(target, glow::TEXTURE_MIN_FILTER, filter);
    gl.tex_parameter_i32(target, glow::TEXTURE_MAG_FILTER, filter);
    gl.tex_parameter_i32(target, glow::TEXTURE_WRAP_S, wrap);
    gl.tex_parameter_i32(target, glow::TEXTURE_WRAP_T, wrap);
}
