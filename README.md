# crashtrack

Open-source crash reporting for native Windows apps. Self-hostable on Cloudflare's edge (Workers + D1 + R2 + Pages). Three lines of Rust to integrate.

## Quick start

```toml
crashtrack = "0.1"
```

```rust
crashtrack::install(Config {
    api_key:  "ct_pk_...",
    app:      "myapp",
    version:  env!("CARGO_PKG_VERSION"),
    endpoint: "https://api.crashtrack.dev",
})?;
```

Get a key at [crashtrack.dev](https://crashtrack.dev), or self-host on your own Cloudflare account — see [SETUP.md](SETUP.md).

## Highlights

- SEH `.pdata` stack unwinding compiled to WASM — handles tail-calls and FPO'd leaf frames correctly
- PDB symbolication that reads Rust's per-module symbol streams (most parsers miss these)
- Inline source context from GitHub, highlighted at the crash line
- ASLR-stable crash grouping by exception + module + offset

## Stack

Cloudflare Workers + D1 + R2 + Pages. Rust + WASM minidump parser. React + Tailwind dashboard.

## License

MIT
