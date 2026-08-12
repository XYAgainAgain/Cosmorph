//! Cosmorph native engine core: bundle parsing and GL execution.
//! No filesystem, no windowing, no clock source — the host supplies bytes and time.

pub mod bundle;
pub mod cadence;
pub mod clock;
pub mod frame;
pub mod program;
pub mod scheduler;
pub mod stars;
pub mod targets;
pub mod uniforms;

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(String);

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn message(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

impl From<String> for Error {
    fn from(message: String) -> Self {
        Error(message)
    }
}

impl From<&str> for Error {
    fn from(message: &str) -> Self {
        Error(message.to_string())
    }
}
