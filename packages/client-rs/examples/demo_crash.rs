//! Run with `cargo run --example demo_crash`. Press any key to crash with a
//! null-pointer dereference. crashtrack writes a minidump to
//! `%LOCALAPPDATA%/crashtrack-demo/crashtrack/pending` and uploads it on the
//! next launch.

use crashtrack::Config;

fn main() {
    crashtrack::install(Config {
        api_key:  option_env!("CRASHTRACK_KEY").unwrap_or("ct_pk_replace_me"),
        app:      "crashtrack-demo",
        version:  env!("CARGO_PKG_VERSION"),
        endpoint: option_env!("CRASHTRACK_ENDPOINT").unwrap_or("http://localhost:8787"),
    })
    .expect("crashtrack install");

    println!("crashtrack installed. press enter to crash...");
    let _ = std::io::stdin().read_line(&mut String::new());

    // Force a guaranteed crash (read from null).
    unsafe {
        let p: *const u32 = std::ptr::null();
        let _ = *p;
    }
}
