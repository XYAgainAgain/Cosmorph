//! Render targets and static textures: half-float, CLAMP_TO_EDGE, no mips, no
//! depth, format and filter per the manifest. Bake targets are framebuffer-sized;
//! overscan lives in the sampling domain.

use glow::HasContext;

use crate::bundle::{Filter, PixelFormat, TargetSpec, TextureSpec, Wrap};
use crate::frame::check_errors;
use crate::{Error, Result};

pub struct RenderTarget {
    pub id: String,
    pub framebuffer: glow::Framebuffer,
    pub textures: Vec<glow::Texture>,
    pub scale: f32,
    pub width: i32,
    pub height: i32,
    format: PixelFormat,
}

/// `(internal format, format)` for `tex_image_2d`; the type is always HALF_FLOAT.
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
    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn alloc(
        gl: &glow::Context,
        spec: &TargetSpec,
        span_w: i32,
        span_h: i32,
    ) -> Result<RenderTarget> {
            let width = scaled(span_w, spec.scale);
        let height = scaled(span_h, spec.scale);

        let framebuffer = gl.create_framebuffer().map_err(|e| {
            Error::from(format!("target '{}' framebuffer: {e}", spec.id))
        })?;
        gl.bind_framebuffer(glow::FRAMEBUFFER, Some(framebuffer));

        let (internal, layout) = gl_format(spec.format);
        let mut textures = Vec::with_capacity(spec.attachments);
        let mut draw_buffers = Vec::with_capacity(spec.attachments);
        for i in 0..spec.attachments {
            let texture = gl
                .create_texture()
                .map_err(|e| Error::from(format!("target '{}' texture {i}: {e}", spec.id)))?;
            gl.bind_texture(glow::TEXTURE_2D, Some(texture));
            gl.tex_image_2d(
                glow::TEXTURE_2D,
                0,
                internal,
                width,
                height,
                0,
                layout,
                glow::HALF_FLOAT,
                glow::PixelUnpackData::Slice(None),
            );
            set_sampling(gl, spec.filter, Wrap::Clamp);
            gl.framebuffer_texture_2d(
                glow::FRAMEBUFFER,
                glow::COLOR_ATTACHMENT0 + i as u32,
                glow::TEXTURE_2D,
                Some(texture),
                0,
            );
            textures.push(texture);
            draw_buffers.push(glow::COLOR_ATTACHMENT0 + i as u32);
        }
        gl.draw_buffers(&draw_buffers);

        let status = gl.check_framebuffer_status(glow::FRAMEBUFFER);
        gl.bind_framebuffer(glow::FRAMEBUFFER, None);
        if status != glow::FRAMEBUFFER_COMPLETE {
            let target = RenderTarget {
                id: spec.id.clone(),
                framebuffer,
                textures,
                scale: spec.scale,
                width,
                height,
                format: spec.format,
            };
            target.delete(gl);
            return Err(format!(
                "target '{}' is incomplete at {width}x{height} (status 0x{status:X})",
                spec.id
            )
            .into());
        }

        Ok(RenderTarget {
            id: spec.id.clone(),
            framebuffer,
            textures,
            scale: spec.scale,
            width,
            height,
            format: spec.format,
        })
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

        let (internal, layout) = gl_format(self.format);
        for texture in &self.textures {
            gl.bind_texture(glow::TEXTURE_2D, Some(*texture));
            gl.tex_image_2d(
                glow::TEXTURE_2D,
                0,
                internal,
                width,
                height,
                0,
                layout,
                glow::HALF_FLOAT,
                glow::PixelUnpackData::Slice(None),
            );
        }

        gl.bind_framebuffer(glow::FRAMEBUFFER, Some(self.framebuffer));
        let status = gl.check_framebuffer_status(glow::FRAMEBUFFER);
        gl.bind_framebuffer(glow::FRAMEBUFFER, None);
        check_errors(
            gl,
            &format!("target '{}' reallocated to {width}x{height}", self.id),
        )?;
        if status != glow::FRAMEBUFFER_COMPLETE {
            return Err(format!(
                "target '{}' is incomplete at {width}x{height} (status 0x{status:X})",
                self.id
            )
            .into());
        }

        self.width = width;
        self.height = height;
        Ok(())
    }

    /// # Safety
    /// Requires a current GL context matching `gl`.
    pub unsafe fn delete(&self, gl: &glow::Context) {
        for texture in &self.textures {
            gl.delete_texture(*texture);
        }
        gl.delete_framebuffer(self.framebuffer);
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
    set_sampling(gl, spec.filter, spec.wrap);
    if spec.mips {
        gl.generate_mipmap(glow::TEXTURE_2D);
    }
    Ok(texture)
}

unsafe fn set_sampling(gl: &glow::Context, filter: Filter, wrap: Wrap) {
    let filter = match filter {
        Filter::Linear => glow::LINEAR,
        Filter::Nearest => glow::NEAREST,
    } as i32;
    let wrap = match wrap {
        Wrap::Clamp => glow::CLAMP_TO_EDGE,
        Wrap::Repeat => glow::REPEAT,
    } as i32;
    gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MIN_FILTER, filter);
    gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MAG_FILTER, filter);
    gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_WRAP_S, wrap);
    gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_WRAP_T, wrap);
}
