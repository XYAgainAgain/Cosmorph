//! EGL on the X11 platform: one Xlib connection whose only jobs are `XOpenDisplay`
//! (for `eglGetPlatformDisplay`) and `XSync` before the surface is created.

use std::ffi::c_void;
use std::ptr;

use khronos_egl as egl;
use x11_dl::xlib;

use crate::Result;

type Instance = egl::DynamicInstance<egl::EGL1_5>;

/// From `EGL_KHR_platform_x11`; NVIDIA advertises no XCB platform here, which is why
/// the display comes from Xlib rather than from the x11rb connection.
const PLATFORM_X11: egl::Enum = 0x31D5;
const DAMAGE_EXTENSION: &str = "EGL_KHR_swap_buffers_with_damage";

/// `EGLBoolean eglSwapBuffersWithDamageKHR(EGLDisplay, EGLSurface, EGLint*, EGLint)`;
/// rects share `glScissor`'s bottom-left `x, y, w, h` space, so scissors pass through unchanged.
type SwapWithDamage = unsafe extern "system" fn(
    egl::EGLDisplay,
    egl::EGLSurface,
    *const egl::Int,
    egl::Int,
) -> egl::Boolean;

pub struct Egl {
    instance: Instance,
    xlib: xlib::Xlib,
    xdisplay: *mut xlib::Display,
    display: egl::Display,
    config: egl::Config,
    visual_id: u32,
    surface: Option<egl::Surface>,
    context: Option<egl::Context>,
    swap_with_damage: Option<SwapWithDamage>,
}

impl Egl {
    /// Opens the display and picks the config, up to but not including the surface —
    /// the window cannot be created until `visual_id()` is known.
    pub fn open() -> Result<Egl> {
        let instance = unsafe { Instance::load_required_from_filename("libEGL.so.1") }
            .map_err(|err| format!("could not load libEGL.so.1: {err}"))?;
        let xlib = xlib::Xlib::open().map_err(|err| format!("could not load libX11: {err}"))?;
        let xdisplay = unsafe { (xlib.XOpenDisplay)(ptr::null()) };
        if xdisplay.is_null() {
            return Err("XOpenDisplay failed; is DISPLAY set?".into());
        }

        let display = unsafe {
            instance.get_platform_display(
                PLATFORM_X11,
                xdisplay as *mut c_void,
                &[egl::ATTRIB_NONE],
            )
        }
        .map_err(|err| format!("eglGetPlatformDisplay(X11) failed: {err}"))?;
        instance.initialize(display)?;
        instance.bind_api(egl::OPENGL_ES_API)?;

        let attributes = [
            egl::RENDERABLE_TYPE,
            egl::OPENGL_ES3_BIT,
            egl::SURFACE_TYPE,
            egl::WINDOW_BIT,
            egl::RED_SIZE,
            8,
            egl::GREEN_SIZE,
            8,
            egl::BLUE_SIZE,
            8,
            egl::ALPHA_SIZE,
            0,
            egl::DEPTH_SIZE,
            0,
            egl::STENCIL_SIZE,
            0,
            egl::NONE,
        ];
        let count = instance.matching_config_count(display, &attributes)?;
        let mut configs = Vec::with_capacity(count);
        instance.choose_config(display, &attributes, &mut configs)?;

        // EGL_ALPHA_SIZE = 0 is a minimum, not a maximum, so an ARGB config can still
        // match; a 32-bit visual would make the compositor blend the wallpaper.
        let config = configs
            .into_iter()
            .find(|c| instance.get_config_attrib(display, *c, egl::ALPHA_SIZE) == Ok(0))
            .ok_or("no EGL config offers an ES3 window surface with zero alpha bits")?;
        let visual_id = instance.get_config_attrib(display, config, egl::NATIVE_VISUAL_ID)? as u32;

        // The entry point is only usable when the display advertises the extension: a
        // loader can hand back a non-null address for a function the driver does not have.
        let advertised = instance
            .query_string(Some(display), egl::EXTENSIONS)
            .map(|s| s.to_string_lossy().split(' ').any(|e| e == DAMAGE_EXTENSION))
            .unwrap_or(false);
        let swap_with_damage = advertised
            .then(|| instance.get_proc_address("eglSwapBuffersWithDamageKHR"))
            .flatten()
            .map(|f| unsafe { std::mem::transmute::<extern "system" fn(), SwapWithDamage>(f) });
        if swap_with_damage.is_none() {
            eprintln!(
                "Cosmorph: {DAMAGE_EXTENSION} is missing, so every swap repaints the whole span"
            );
        }

        Ok(Egl {
            instance,
            xlib,
            xdisplay,
            display,
            config,
            visual_id,
            surface: None,
            context: None,
            swap_with_damage,
        })
    }

    pub fn visual_id(&self) -> u32 {
        self.visual_id
    }

    /// Round-trips the X connection so the server knows the window before EGL binds it.
    pub fn sync(&self) {
        unsafe { (self.xlib.XSync)(self.xdisplay, 0) };
    }

    pub fn create_surface(&mut self, window: u32) -> Result<()> {
        let surface = unsafe {
            self.instance.create_window_surface(
                self.display,
                self.config,
                window as usize as *mut c_void,
                None,
            )
        }
        .map_err(|err| format!("eglCreateWindowSurface failed: {err}"))?;
        let context = self.instance.create_context(
            self.display,
            self.config,
            None,
            &[egl::CONTEXT_MAJOR_VERSION, 3, egl::NONE],
        )?;
        self.instance
            .make_current(self.display, Some(surface), Some(surface), Some(context))?;
        // The desktop layer is always redirected, so vsync here buys aliasing, not tearing.
        self.instance.swap_interval(self.display, 0)?;
        self.surface = Some(surface);
        self.context = Some(context);
        Ok(())
    }

    /// The `--swap-interval` escape hatch, for a window that is somehow unredirected.
    pub fn set_swap_interval(&self, interval: i32) -> Result<()> {
        self.instance.swap_interval(self.display, interval)?;
        Ok(())
    }

    pub fn load_gl(&self) -> glow::Context {
        unsafe {
            glow::Context::from_loader_function(|name| {
                self.instance
                    .get_proc_address(name)
                    .map_or(ptr::null(), |f| f as *const c_void)
            })
        }
    }

    /// What EGL will actually present into, which is the only authority on the viewport:
    /// the driver picks a resize up on its own schedule, not when X reports the configure.
    pub fn surface_size(&self) -> Result<(i32, i32)> {
        let surface = self.surface.ok_or("no EGL surface to measure")?;
        let width = self.instance.query_surface(self.display, surface, egl::WIDTH)?;
        let height = self.instance.query_surface(self.display, surface, egl::HEIGHT)?;
        Ok((width, height))
    }

    pub fn swap_buffers(&self) -> Result<()> {
        let surface = self.surface.ok_or("no EGL surface to swap")?;
        self.instance.swap_buffers(self.display, surface)?;
        Ok(())
    }

    /// Falls back to a full `swap_buffers` when `damage` is empty or the extension is
    /// missing — never publishes an empty damage list.
    pub fn swap_damaged(&self, damage: &[egl::Int]) -> Result<()> {
        let (Some(swap), Some(surface)) = (self.swap_with_damage, self.surface) else {
            return self.swap_buffers();
        };
        if damage.is_empty() {
            return self.swap_buffers();
        }
        let ok = unsafe {
            swap(
                self.display.as_ptr(),
                surface.as_ptr(),
                damage.as_ptr(),
                (damage.len() / 4) as egl::Int,
            )
        };
        if ok == egl::TRUE {
            Ok(())
        } else {
            Err("eglSwapBuffersWithDamageKHR failed".into())
        }
    }
}

impl Drop for Egl {
    fn drop(&mut self) {
        let _ = self.instance.make_current(self.display, None, None, None);
        if let Some(context) = self.context.take() {
            let _ = self.instance.destroy_context(self.display, context);
        }
        if let Some(surface) = self.surface.take() {
            let _ = self.instance.destroy_surface(self.display, surface);
        }
        let _ = self.instance.terminate(self.display);
        unsafe { (self.xlib.XCloseDisplay)(self.xdisplay) };
    }
}
