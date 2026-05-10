//! crashtrack demo-crasher
//!
//! A tiny console app that intentionally crashes — proves the crashtrack
//! pipeline end-to-end without writing your own integration first.
//!
//! Usage:
//!   CRASHTRACK_KEY=ct_pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx cargo run --release
//!
//! Optionally set CRASHTRACK_ENDPOINT if you're self-hosted.

use std::io::{self, BufRead, Write};

fn main() {
    let key = option_env!("CRASHTRACK_KEY")
        .or_else(|| std::option_env!("CRASHTRACK_KEY"))
        .unwrap_or("ct_pk_replace_with_your_api_key_xx");
    let endpoint =
        option_env!("CRASHTRACK_ENDPOINT").unwrap_or("https://api.crashtrack.dev");

    let _ = crashtrack::install(crashtrack::Config {
        api_key: key,
        app: "crashtrack-demo",
        version: env!("CARGO_PKG_VERSION"),
        endpoint,
    });

    println!("crashtrack demo-crasher");
    println!("  reporting to: {endpoint}");
    println!("  api key:      {}", redact(key));
    println!();
    loop {
        println!("pick one — process exits on any crash; next launch uploads the dump:");
        println!("  1  null-pointer read           (EXCEPTION_ACCESS_VIOLATION)");
        println!("  2  divide by zero              (EXCEPTION_INT_DIVIDE_BY_ZERO)");
        println!("  3  stack overflow (recursion)  (EXCEPTION_STACK_OVERFLOW)");
        println!("  4  std::process::abort()");
        println!("  0  exit cleanly");
        print!("> ");
        io::stdout().flush().ok();

        let mut line = String::new();
        if io::stdin().lock().read_line(&mut line).is_err() {
            return;
        }
        match line.trim() {
            "1" => null_deref(),
            "2" => divide_by_zero(),
            "3" => recurse(0),
            "4" => std::process::abort(),
            "0" => return,
            _ => println!("unknown choice; pick 0-4.\n"),
        }
    }
}

#[inline(never)]
fn null_deref() {
    unsafe {
        let p: *const u32 = std::ptr::null();
        let _ = std::ptr::read_volatile(p);
    }
}

#[inline(never)]
fn divide_by_zero() {
    let a: i32 = std::hint::black_box(1);
    let b: i32 = std::hint::black_box(0);
    // Volatile so the compiler doesn't fold this away.
    let r = unsafe { std::ptr::read_volatile(&a) } / unsafe { std::ptr::read_volatile(&b) };
    println!("(never reached) result = {r}");
}

#[inline(never)]
#[allow(unconditional_recursion)]
fn recurse(depth: usize) {
    // Big local to consume stack quickly and avoid tail-call optimization.
    let mut buf = [0u8; 4096];
    buf[depth & (buf.len() - 1)] = 1;
    std::hint::black_box(&buf);
    recurse(depth + 1);
}

fn redact(key: &str) -> String {
    if key.len() < 12 {
        return "***".into();
    }
    format!("{}...{}", &key[..7], &key[key.len() - 4..])
}
