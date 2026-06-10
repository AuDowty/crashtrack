# Launch post drafts

Pre-written so you can copy/paste with minimal editing. **Do not all-fire on the same day** — space them out across a week so each one gets its own algorithmic shot.

---

## Show HN

**Title** (HN is strict about this — short, factual, no marketing words):

```
Show HN: Crashtrack – open-source crash reporting for native Windows apps
```

**URL:** `https://crashtrack.dev`

**Body** (HN posts often do better with a short personal note than a feature list):

```
Hi HN — I built this because Sentry's per-event pricing didn't fit a small
Windows side project and the open-source native-crash story (Breakdown,
Backtrace, BugSplat) all assume you'll run their server on a box you own.

Crashtrack runs entirely on Cloudflare Workers + D1 + R2 — the free tier is
enough for a hobby project, and self-hosting on another CF account is the
same deploy. Three lines of Rust to integrate:

    crashtrack::install(Config {
        api_key:  "ct_pk_...",
        app:      "myapp",
        version:  env!("CARGO_PKG_VERSION"),
        endpoint: "https://api.crashtrack.dev",
    })?;

The bit I'm proudest of is the symbolication: I re-implemented Windows x64
SEH .pdata-based stack unwinding in WASM so it can run inside a Worker, then
batched PDB symbol lookups so a 16-frame stack resolves in one pass. Long
write-up here: https://github.com/AuDowty/crashtrack/blob/main/docs/seh-unwinding-in-wasm.md

Source: https://github.com/AuDowty/crashtrack
Crate:  https://crates.io/crates/crashtrack

Happy to answer anything about the architecture, the unwinder, or the
Cloudflare-edge trade-offs.
```

---

## /r/rust

**Title:**

```
crashtrack – open-source crash reporting for Windows Rust apps, with a WASM SEH unwinder running on Cloudflare's edge
```

**Body:**

```
TL;DR: drop-in Rust crate that captures crash dumps via Windows SEH and
uploads them to a Cloudflare Workers backend that symbolicates them with
file:line + GitHub source context.

  [dependencies]
  crashtrack = "0.1"

  fn main() {
      crashtrack::install(Config {
          api_key:  "ct_pk_...",
          app:      "myapp",
          version:  env!("CARGO_PKG_VERSION"),
          endpoint: "https://api.crashtrack.dev",
      })?;
  }

What's interesting from a Rust perspective:

- The client crate is ~250 lines, no async runtime, Windows-only. SEH filter
  + lock-free pending queue + retry-on-next-launch upload.
- The server-side stack walker is also Rust, compiled to WASM. It implements
  Windows x64 .pdata-based unwinding so it walks tail-calls, FPO'd leaf
  functions, and ntdll's SEH boundary correctly. Rust binaries put their
  procedure symbols in per-module PDB streams rather than the global stream,
  so a naive PDB reader misses them — the bulk resolver scans both.
- One bulk PDB scan resolves all frames at once; a 16-frame stack symbolicates
  in ~400 ms warm, ~1.5 s cold.

Live demo: https://crashtrack.dev (sign in with GitHub, create a project,
follow the wizard — there's a one-line curl that sends a test crash so you
can see the end-to-end flow without writing any client code).

Repo: https://github.com/AuDowty/crashtrack
Deep-dive on the unwinder: https://github.com/AuDowty/crashtrack/blob/main/docs/seh-unwinding-in-wasm.md

Roadmap is Linux ELF coredumps next; PRs and feedback welcome.
```

---

## /r/sideproject

**Title:**

```
I made crashtrack: free crash reporting for Windows apps, fully open source, runs on Cloudflare's free tier
```

**Body:**

```
I have a small Windows side project that occasionally crashes for users and I
didn't want to pay Sentry's per-event price to find out why. So I built
crashtrack — an open-source equivalent that runs on Cloudflare Workers + D1 +
R2 and costs $0 at hobby volume.

Three lines of Rust to integrate, one PDB upload per release, and you get a
dashboard showing:

- Crashes over time, grouped by exception + module + offset
- Full symbolicated stack with function names + file:line
- Source context for the top 6 frames, fetched from GitHub
- Public dashboard you can share if your project's OSS
- Slack/Discord webhooks on new crash groups

Live: https://crashtrack.dev
Source: https://github.com/AuDowty/crashtrack

The whole thing is MIT — you can self-host on your own Cloudflare account if
you don't trust mine. Would love feedback from anyone shipping native Windows
software.
```

---

## Posting checklist

- [ ] Pin crashtrack on `AuDowty/AuDowty` profile.
- [ ] Star the repo yourself + ask a few people to star it before posting (HN's threshold algorithm punishes 0-star repos).
- [ ] Have docs/seh-unwinding-in-wasm.md live at the URL above before submitting.
- [ ] Submit Show HN around 8am Pacific, midweek.
- [ ] Submit r/rust + r/sideproject 1-2 days later, NOT the same day.
- [ ] Be present in the threads — answer technical questions within an hour, stay polite, link to specific files in the repo when relevant.
