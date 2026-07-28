//! Parents the render window into the desktop wallpaper layer.
//! There is no supported API for this: 0x052C is an undocumented message that
//! makes Explorer split the icon layer off into its own WorkerW window.

use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetSystemMetrics, SendMessageTimeoutW, SetParent,
    SetWindowPos, SMTO_NORMAL, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SWP_NOACTIVATE,
    SWP_NOZORDER, SWP_SHOWWINDOW,
};

const WM_SPAWN_WORKERW: u32 = 0x052C;

/// Ask Explorer for the wallpaper layer, then move `hwnd` into it.
/// Falls back to Progman itself, which is what some Windows 10 shells hand back
/// when they keep the icons and the wallpaper in one window.
pub fn attach_to_desktop(hwnd: HWND) -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        let progman = FindWindowW(w!("Progman"), None)?;

        // Explorer only creates the WorkerW layer once asked; the reply is
        // ignored, the side effect is the point.
        SendMessageTimeoutW(
            progman,
            WM_SPAWN_WORKERW,
            WPARAM(0),
            LPARAM(0),
            SMTO_NORMAL,
            1000,
            None,
        );

        // Landing in Progman instead can put the sky in front of the icons, so
        // announce it; on a first run that is the thing to check.
        let target = match find_wallpaper_layer() {
            Some(worker) => worker,
            None => {
                eprintln!("Cosmorph: no WorkerW layer found, falling back to Progman.");
                progman
            }
        };
        SetParent(hwnd, Some(target))?;

        // Child coordinates are relative to the layer, whose origin is the
        // virtual desktop's top-left even when that is at a negative position.
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW,
        )?;
    }
    Ok(())
}

/// The wallpaper layer is the WorkerW that follows the top-level window hosting
/// SHELLDLL_DefView (the icon grid). Walking is required; neither the order nor
/// the count of WorkerW windows is stable across Windows versions.
fn find_wallpaper_layer() -> Option<HWND> {
    let mut found: Option<HWND> = None;
    unsafe {
        let _ = EnumWindows(
            Some(enum_worker_callback),
            LPARAM(&mut found as *mut _ as isize),
        );
    }
    found
}

unsafe extern "system" fn enum_worker_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let found = &mut *(lparam.0 as *mut Option<HWND>);

    if FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None).is_ok() {
        if let Ok(worker) = FindWindowExW(None, Some(hwnd), w!("WorkerW"), None) {
            *found = Some(worker);
            return BOOL(0);
        }
    }
    BOOL(1)
}
