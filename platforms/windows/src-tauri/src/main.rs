#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod desktop;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app
                .get_webview_window("wallpaper")
                .expect("wallpaper window missing from tauri.conf.json");

            // The window starts hidden so the reparent lands before its first
            // frame; showing early flashes a normal window over the desktop.
            #[cfg(windows)]
            {
                let hwnd = windows::Win32::Foundation::HWND(window.hwnd()?.0);
                if let Err(err) = desktop::attach_to_desktop(hwnd) {
                    // Never show unparented: that floats a bare window over the desktop
                    eprintln!("Cosmorph: could not reach the wallpaper layer: {err}");
                    return Err(err.into());
                }
            }

            #[cfg(not(windows))]
            window.show()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Cosmorph failed to start");
}
