//! Boots the whole engine against the real bundle on a surfaceless EGL ES 3 context:
//! every program links, every binding resolves, and the frame lands in the monitor rects.

use std::ffi::c_void;
use std::path::PathBuf;

use cosmorph_native_core::bundle::Bundle;
use cosmorph_native_core::frame::{Engine, FrameInput, Rect};
use glow::HasContext;
use khronos_egl as egl;

/// From EGL_MESA_platform_surfaceless.
const PLATFORM_SURFACELESS: egl::Enum = 0x31DD;
/// The hero's 2.5625 aspect at 1/20 scale: the shaders read the aspect, not the
/// pixel count, and a full span would allocate 940 MB of targets for a link test.
const SPAN: Rect = Rect { x: 0, y: 0, w: 328, h: 128 };

struct Headless {
    instance: egl::DynamicInstance<egl::EGL1_5>,
    display: egl::Display,
    surface: egl::Surface,
    context: egl::Context,
}

impl Headless {
    fn open() -> Result<Headless, String> {
        let instance = unsafe {
            egl::DynamicInstance::<egl::EGL1_5>::load_required_from_filename("libEGL.so.1")
        }
        .map_err(|e| format!("libEGL.so.1: {e}"))?;

        let display = unsafe {
            instance.get_platform_display(
                PLATFORM_SURFACELESS,
                egl::DEFAULT_DISPLAY,
                &[egl::ATTRIB_NONE],
            )
        }
        .map_err(|e| format!("eglGetPlatformDisplay(surfaceless): {e}"))?;
        instance.initialize(display).map_err(|e| format!("eglInitialize: {e}"))?;
        instance.bind_api(egl::OPENGL_ES_API).map_err(|e| format!("eglBindAPI: {e}"))?;

        let attributes = [
            egl::RENDERABLE_TYPE,
            egl::OPENGL_ES3_BIT,
            egl::SURFACE_TYPE,
            egl::PBUFFER_BIT,
            egl::RED_SIZE,
            8,
            egl::GREEN_SIZE,
            8,
            egl::BLUE_SIZE,
            8,
            egl::DEPTH_SIZE,
            0,
            egl::STENCIL_SIZE,
            0,
            egl::NONE,
        ];
        let config = instance
            .choose_first_config(display, &attributes)
            .map_err(|e| format!("eglChooseConfig: {e}"))?
            .ok_or("no surfaceless ES3 pbuffer config")?;

        // A pbuffer gives the compose pass a real default framebuffer to hit.
        let surface = instance
            .create_pbuffer_surface(
                display,
                config,
                &[egl::WIDTH, SPAN.w, egl::HEIGHT, SPAN.h, egl::NONE],
            )
            .map_err(|e| format!("eglCreatePbufferSurface: {e}"))?;
        let context = instance
            .create_context(display, config, None, &[egl::CONTEXT_MAJOR_VERSION, 3, egl::NONE])
            .map_err(|e| format!("eglCreateContext: {e}"))?;
        instance
            .make_current(display, Some(surface), Some(surface), Some(context))
            .map_err(|e| format!("eglMakeCurrent: {e}"))?;

        Ok(Headless { instance, display, surface, context })
    }

    fn gl(&self) -> glow::Context {
        unsafe {
            glow::Context::from_loader_function(|name| {
                self.instance
                    .get_proc_address(name)
                    .map_or(std::ptr::null(), |f| f as *const c_void)
            })
        }
    }
}

impl Drop for Headless {
    fn drop(&mut self) {
        let _ = self.instance.make_current(self.display, None, None, None);
        let _ = self.instance.destroy_context(self.display, self.context);
        let _ = self.instance.destroy_surface(self.display, self.surface);
        let _ = self.instance.terminate(self.display);
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

#[test]
fn the_whole_pass_graph_links_binds_and_draws() {
    let Some(dir) = bundle_dir() else {
        eprintln!(
            "skipping link_all: set COSMORPH_BUNDLE to the directory holding bundle.json \
             and bundle.bin (run .dev/tools/glsl-dump to produce them)"
        );
        return;
    };
    let headless = match Headless::open() {
        Ok(headless) => headless,
        Err(err) => {
            eprintln!("skipping link_all: no surfaceless EGL ES 3 context here ({err})");
            return;
        }
    };
    let gl = headless.gl();

    let manifest = std::fs::read(dir.join("bundle.json")).expect("reading bundle.json");
    let blobs = std::fs::read(dir.join("bundle.bin")).expect("reading bundle.bin");
    let parsed = Bundle::load(&manifest, blobs.clone()).expect("bundle failed to validate");
    let planes = parsed.manifest.planes.len();
    let target_count = parsed.manifest.targets.len();
    let program_count = parsed.manifest.programs.len();
    assert_eq!(program_count, 12, "hero program count");
    assert_eq!(target_count, 10, "hero target count");

    let mut engine = unsafe { Engine::new(&gl, &manifest, &blobs) }
        .unwrap_or_else(|e| panic!("Engine::new: {e}"));

    // Every program linked, and every sampler and attribute the bundle declares
    // resolved to a real uniform location and attribute location.
    assert_eq!(engine.programs().len(), program_count);
    for (index, gpu) in engine.programs().iter().enumerate() {
        let spec = &parsed.manifest.programs[index];
        assert_eq!(gpu.id, spec.id);
        assert_eq!(gpu.samplers.len(), spec.samplers.len(), "{} samplers", spec.id);
        assert!(!gpu.blocks.is_empty(), "{} enumerated no uniform block", spec.id);

        // An unread attribute is dropped at link time; the ones the draw needs
        // are position and anything instanced.
        let bound: Vec<&str> = gpu
            .attributes
            .iter()
            .map(|a| spec.attributes[a.spec].name.as_str())
            .collect();
        assert!(bound.contains(&"position"), "{} lost its position attribute", spec.id);
        for attribute in spec.attributes.iter().filter(|a| a.divisor > 0) {
            assert!(
                bound.contains(&attribute.name.as_str()),
                "{} declares instanced '{}' but it resolved to no location",
                spec.id,
                attribute.name
            );
        }

        let enumerated: Vec<&str> = gpu
            .blocks
            .iter()
            .flat_map(|b| b.members.iter().map(|m| m.name.as_str()))
            .collect();
        for member in spec.members.iter().filter(|m| m.dynamic.is_some()) {
            assert!(
                enumerated.contains(&member.name.as_str()),
                "{} declares dynamic '{}' but the driver enumerated no such member",
                spec.id,
                member.name
            );
        }
    }

    let rects = [
        Rect { x: 0, y: 0, w: 200, h: 128 },
        Rect { x: 200, y: 8, w: 128, h: 96 },
    ];
    unsafe { engine.resize(&gl, SPAN, &rects, 1.0) }.unwrap_or_else(|e| panic!("resize: {e}"));
    assert_eq!(engine.targets().len(), target_count, "targets allocated");
    for (target, spec) in engine.targets().iter().zip(&parsed.manifest.targets) {
        assert_eq!(target.id, spec.id);
        assert_eq!(target.width, (SPAN.w as f32 * spec.scale).round() as i32, "{} width", spec.id);
    }

    let input = FrameInput {
        tev: parsed.manifest.scene.saved_t / 3600.0,
        twinkle_phase: [0.25, 0.4, 0.6],
        parallax: [3.0, -2.0],
        active_rects: FrameInput::ALL_RECTS,
    };
    unsafe { engine.warm_start(&gl, input) }.unwrap_or_else(|e| panic!("warm_start: {e}"));
    unsafe { engine.render(&gl, input) }.unwrap_or_else(|e| panic!("render: {e}"));
    unsafe { cosmorph_native_core::frame::check_errors(&gl, "steady frame") }
        .unwrap_or_else(|e| panic!("{e}"));

    // A linked pass graph that draws nothing still raises no GL error, so read the
    // composite back: it has to land inside the monitor rects and nowhere else.
    let mut pixels = vec![0u8; (SPAN.w * SPAN.h * 4) as usize];
    unsafe {
        gl.read_pixels(
            0,
            0,
            SPAN.w,
            SPAN.h,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelPackData::Slice(Some(&mut pixels)),
        )
    };
    let lit = pixels.chunks_exact(4).filter(|p| p[0] > 0 || p[1] > 0 || p[2] > 0).count();
    let covered: usize = rects.iter().map(|r| (r.w * r.h) as usize).sum();
    assert!(lit > covered / 2, "the composite drew {lit} lit pixels into {covered} of rect");
    assert!(lit <= covered, "{lit} lit pixels exceed the {covered} the scissors allow");

    // Occlusion pullback: a cleared bit has to stop that rect's composite draw outright.
    assert_eq!(engine.scissors().len(), rects.len());
    let only_first = FrameInput { active_rects: 0b01, ..input };
    unsafe { engine.render(&gl, only_first) }.expect("partially covered frame");
    unsafe {
        gl.read_pixels(
            0,
            0,
            SPAN.w,
            SPAN.h,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelPackData::Slice(Some(&mut pixels)),
        )
    };
    let one = pixels.chunks_exact(4).filter(|p| p[0] > 0 || p[1] > 0 || p[2] > 0).count();
    let first = (rects[0].w * rects[0].h) as usize;
    assert!(one <= first, "{one} lit pixels exceed the {first} of the one active rect");
    assert!(one < lit, "covering a rect drew as much as drawing them all");
    unsafe { engine.render(&gl, input) }.expect("uncovered frame");

    // One plane per frame is the hard cap, so three clean frames cannot bake.
    for _ in 0..planes {
        unsafe { engine.render(&gl, input) }.expect("steady frame");
    }
    unsafe { cosmorph_native_core::frame::check_errors(&gl, "idle frames") }
        .unwrap_or_else(|e| panic!("{e}"));

    // Banded bakes scissor each plane pass; every band has to tile without a hole.
    const BANDS: u32 = 3;
    engine.set_bands(BANDS);
    for _ in 0..planes * BANDS as usize {
        unsafe { engine.render(&gl, input) }.expect("banded frame");
    }
    unsafe {
        gl.read_pixels(
            0,
            0,
            SPAN.w,
            SPAN.h,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelPackData::Slice(Some(&mut pixels)),
        )
    };
    let banded = pixels.chunks_exact(4).filter(|p| p[0] > 0 || p[1] > 0 || p[2] > 0).count();
    assert_eq!(banded, lit, "a banded rebake left {banded} lit pixels against {lit} unbanded");
    unsafe { cosmorph_native_core::frame::check_errors(&gl, "banded bakes") }
        .unwrap_or_else(|e| panic!("{e}"));

    // A hotplug reallocates every attachment; the targets have to come back
    // complete at the new span and keep drawing without a GL error.
    const RESPAN: Rect = Rect { x: 0, y: 0, w: 240, h: 96 };
    let moved = [Rect { x: 0, y: 0, w: 160, h: 96 }, Rect { x: 160, y: 0, w: 80, h: 96 }];
    unsafe { engine.resize(&gl, RESPAN, &moved, 1.0) }.unwrap_or_else(|e| panic!("respan: {e}"));
    for (target, spec) in engine.targets().iter().zip(&parsed.manifest.targets) {
        assert_eq!(
            target.width,
            (RESPAN.w as f32 * spec.scale).round() as i32,
            "{} did not follow the respan",
            spec.id
        );
    }
    unsafe { engine.warm_start(&gl, input) }.unwrap_or_else(|e| panic!("respan warm_start: {e}"));
    unsafe { cosmorph_native_core::frame::check_errors(&gl, "respan frame") }
        .unwrap_or_else(|e| panic!("{e}"));

    unsafe { engine.delete(&gl) };
}
