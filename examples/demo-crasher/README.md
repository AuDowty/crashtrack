# crashtrack demo-crasher

A tiny Windows console app that intentionally crashes — for proving the crashtrack pipeline end-to-end without integrating crashtrack into one of your own apps first.

## Run it

Build and run with your project's API key (create one at https://crashtrack.dev → your project → setup):

```sh
set CRASHTRACK_KEY=ct_pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
cargo run --release
```

(`set` for cmd; `$env:CRASHTRACK_KEY = "..."` for PowerShell.)

Self-hosted? Add `CRASHTRACK_ENDPOINT=https://api.your-domain.tld`.

## Menu

```
1  null-pointer read           (EXCEPTION_ACCESS_VIOLATION)
2  divide by zero              (EXCEPTION_INT_DIVIDE_BY_ZERO)
3  stack overflow (recursion)  (EXCEPTION_STACK_OVERFLOW)
4  std::process::abort()
0  exit cleanly
```

Pick a crash. The process dies. **Run it again** — the previous crash's minidump uploads on startup and appears in your crashtrack dashboard within seconds.

## How it works

It's three lines of integration:

```rust
crashtrack::install(crashtrack::Config {
    api_key:  env!("CRASHTRACK_KEY"),
    app:      "crashtrack-demo",
    version:  env!("CARGO_PKG_VERSION"),
    endpoint: "https://api.crashtrack.dev",
})?;
```

That's it. Read [`src/main.rs`](src/main.rs) for the full source.
