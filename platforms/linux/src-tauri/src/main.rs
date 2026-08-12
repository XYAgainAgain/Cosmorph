#[cfg(target_os = "linux")]
mod desktop;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app
                .get_webview_window("wallpaper")
                .expect("wallpaper window missing from tauri.conf.json");

            // The window starts hidden so the desktop type hint lands before its
            // first map; showing early flashes a normal window over the desktop.
            #[cfg(target_os = "linux")]
            {
                if let Err(err) = desktop::attach_to_desktop(&window) {
                    // Never show unhinted: that floats a bare window over the desktop
                    eprintln!("Cosmorph: could not reach the wallpaper layer: {err}");
                    return Err(err);
                }
            }

            #[cfg(not(target_os = "linux"))]
            window.show()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Cosmorph failed to start");
}
