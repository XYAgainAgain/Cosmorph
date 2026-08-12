//! Evolution persistence, replacing the webview host's `localStorage`: same key scheme,
//! `$XDG_STATE_HOME/cosmorph/evolution.json`, temp file plus rename so a kill cannot truncate.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{Map, Value};

use crate::Result;

static SHUTDOWN: AtomicBool = AtomicBool::new(false);

pub fn path() -> Result<PathBuf> {
    let base = match env::var_os("XDG_STATE_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => {
            let home = env::var_os("HOME").ok_or("neither XDG_STATE_HOME nor HOME is set")?;
            PathBuf::from(home).join(".local/state")
        }
    };
    Ok(base.join("cosmorph/evolution.json"))
}

/// A malformed or missing file is a warning, never an error: the session falls back to
/// the scene's authored `savedT`.
pub fn load(key: &str) -> Option<f64> {
    let path = path().ok()?;
    let text = fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<Value>(&text) {
        Ok(value) => value.get(key)?.as_f64().filter(|t| t.is_finite() && *t >= 0.0),
        Err(err) => {
            eprintln!("Cosmorph: ignoring malformed {}: {err}", path.display());
            None
        }
    }
}

pub fn save(key: &str, seconds: f64) -> Result<()> {
    let path = path()?;
    let directory = path.parent().ok_or("evolution state path has no parent")?;
    fs::create_dir_all(directory)?;

    let mut object = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_else(Map::new);
    object.insert(key.to_string(), Value::from(seconds));

    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec(&Value::Object(object))?)?;
    fs::rename(&temporary, &path)?;
    Ok(())
}

extern "C" fn on_signal(_signal: libc::c_int) {
    SHUTDOWN.store(true, Ordering::Relaxed);
}

/// A wallpaper is killed rather than closed, so the signal path is the one that persists.
pub fn install_signal_handlers() -> &'static AtomicBool {
    unsafe {
        libc::signal(libc::SIGTERM, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_signal as *const () as libc::sighandler_t);
    }
    &SHUTDOWN
}
