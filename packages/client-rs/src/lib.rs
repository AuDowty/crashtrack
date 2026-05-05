//! crashtrack — lightweight Windows crash reporter.
//!
//! Usage:
//!
//! ```no_run
//! use crashtrack::Config;
//!
//! fn main() {
//!     crashtrack::install(Config {
//!         api_key:  "ct_pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
//!         app:      "myapp",
//!         version:  env!("CARGO_PKG_VERSION"),
//!         endpoint: "https://api.crashtrack.dev",
//!     })
//!     .expect("crashtrack install");
//!
//!     // ... your app runs normally. on crash, a minidump is written and
//!     // uploaded on the next launch.
//! }
//! ```

#![cfg(target_os = "windows")]

mod handler;
mod uploader;

pub use handler::{Config, Error};

/// Install the crash handler and start uploading any pending dumps in the
/// background. Call this once, as early as practical, in `main()`.
pub fn install(cfg: Config) -> Result<(), Error> {
    handler::install(cfg.clone())?;
    uploader::spawn(cfg);
    Ok(())
}
