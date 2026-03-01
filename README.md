# crashtrack

> Open-source crash reporting for native Windows apps. Sentry alternative on Cloudflare's edge — free, self-hostable, three lines of Rust.

[![CI](https://github.com/AuDowty/crashtrack/actions/workflows/ci.yml/badge.svg)](https://github.com/AuDowty/crashtrack/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/crashtrack.svg)](https://crates.io/crates/crashtrack)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![live](https://img.shields.io/badge/live-crashtrack.dev-ef4444)](https://crashtrack.dev)

![dashboard](docs/screenshots/group-detail.png)

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

Get a key at [crashtrack.dev](https://crashtrack.dev). Self-host on your own Cloudflare account — see [SETUP.md](SETUP.md).

## What's interesting

- **SEH `.pdata` stack unwinding in WASM** on Cloudflare's edge. Walks tail-calls and FPO'd leaf functions correctly. [Deep-dive](docs/seh-unwinding-in-wasm.md).
- **PDB symbolication** that handles Rust's per-module symbol streams — most parsers miss them. Bulk-resolves a 16-frame stack in one pass.
- **Inline source context** from GitHub raw, highlighted at the crash line.
- **ASLR-stable grouping** by exception + module + offset.

Stack: Cloudflare Workers + D1 + R2 + Pages. Rust + WASM parser. React + Tailwind dashboard.

## License

MIT.
