# crashtrack (Rust client)

Lightweight Windows crash reporter. Installs an unhandled-exception filter that
writes a minidump on crash, and uploads queued dumps to a crashtrack server on
the next launch.

## Add it

```toml
[dependencies]
crashtrack = "0.1"
```

## Use it

```rust
use crashtrack::Config;

fn main() {
    crashtrack::install(Config {
        api_key:  "ct_pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        app:      "myapp",
        version:  env!("CARGO_PKG_VERSION"),
        endpoint: "https://api.crashtrack.dev",
    }).expect("crashtrack install");

    // ... rest of your program
}
```

Get an API key at https://crashtrack.dev (create a project, copy the key from
settings).

## What it does

- On install: sets `SetUnhandledExceptionFilter` and spawns a background thread
  that scans `%LOCALAPPDATA%/<app>/crashtrack/pending` and uploads any queued
  minidumps from previous crashes.
- On crash: the filter calls `MiniDumpWriteDump` and writes the dump to the
  pending directory, then returns `EXCEPTION_CONTINUE_SEARCH` so Windows Error
  Reporting still runs and the process terminates as normal.

The crash is uploaded the *next* time the app starts. This is intentional —
the network stack is unreliable inside an exception filter.

## Symbols (function names)

By default crashes show as `myapp.exe +0x1234`. Upload your build's `.pdb`
file in the dashboard (Settings → Symbols) and crashtrack will render the
function name instead (e.g. `MyClass::Render`).

The matching is by filename stem — `myapp.pdb` resolves frames in any module
whose basename also reduces to `myapp` (so `myapp.exe`, `myapp.dll`, etc).

## Tradeoffs

- Self-hosting: the server is open source — point `endpoint` at your own
  deployment if you don't want crashes going to crashtrack.dev.
- Stack overflow: not covered by `SetUnhandledExceptionFilter`. v0.2 will add a
  vectored exception handler + guard-page recovery for that case.
- OOM at crash time: the dump buffer is allocated lazily today. If the crash
  is from heap exhaustion the dump may fail to write. v0.2 will pre-allocate.

## License

MIT
