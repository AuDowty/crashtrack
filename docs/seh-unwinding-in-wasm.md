# Walking Windows SEH stacks in WebAssembly on Cloudflare's edge

*How crashtrack turns a minidump + an `.exe` into a precise, symbolicated call chain — without ever running native code.*

---

## The problem

When a Rust or C++ program on Windows crashes, the OS hands you 50 KB of opaque
binary called a **minidump**. Inside is a snapshot of the thread's registers,
a slice of stack memory, the list of loaded modules, and the exception record.

The naive way to read a stack from that snapshot is to scan upward from `RSP`
looking for values that fall inside known module address ranges and assume
they're return addresses. That works for hand-written assembly. It falls apart
the moment your code touches:

- **A leaf function with no prologue.** RBP is the caller's, RSP is whatever
  the prologue happens to have allocated. There's no chain to walk.
- **Tail-call optimization.** The "caller" was never on the stack to begin
  with — the compiler jumped instead of calling.
- **Anything compiled with frame-pointer omission**, which is every release
  build of every Rust binary by default.

Sentry, Backtrace, and BugSplat all walk these stacks correctly. They do it by
running [`minidump-stackwalk`](https://github.com/rust-minidump/rust-minidump)
or a Breakpad-derived equivalent **server-side, on a Linux box, in native
code**. That's fine if you want to run a Linux box.

We wanted to run on Cloudflare Workers — 50 MB of WASM per isolate, no native
syscalls, and a cold-start budget measured in milliseconds. So we had to
re-implement the unwinder from scratch in pure Rust → WASM.

This post is about how that works.

---

## The Windows x64 unwinding contract

Microsoft solved the FPO problem in 2002 by making unwinding **table-driven**
instead of register-driven. Every function emitted by `cl.exe` (and by `rustc`,
which uses MSVC's exception model on Windows) gets two metadata records:

1. A `RUNTIME_FUNCTION` entry in the PE binary's **`.pdata`** section — a 12-byte
   record per function with `(start_rva, end_rva, unwind_info_rva)`.
2. An `UNWIND_INFO` blob in the **`.xdata`** section, pointed to by the third
   field above. It describes, opcode-by-opcode, what the function's prologue
   did to the stack: which non-volatiles it pushed, how much frame it
   allocated, where it set the frame pointer (if any).

To unwind a single frame, you:

1. Look up `RIP` in `.pdata` via binary search — find the `RUNTIME_FUNCTION`
   whose `[start_rva, end_rva)` contains it.
2. Parse the `UNWIND_INFO` it points to.
3. **Reverse-apply** each unwind code in order. Saw a `UWOP_ALLOC_SMALL 32`?
   Add 32 to RSP. Saw a `UWOP_PUSH_NONVOL`? Read 8 bytes from `[RSP]`, write
   the captured register, add 8 to RSP.
4. After processing every opcode that applies, the value at `[RSP]` is the
   return address. Pop it, set RIP, repeat.

This gives you **a precise stack** regardless of FPO, leaf calls, or tail
calls. It's what Visual Studio's debugger and ETW use under the hood.

The catch: it requires the original PE file. The minidump doesn't include it.
So crashtrack asks the user to upload their `.exe` once per release, into an
R2 bucket — and that's enough.

---

## Doing it in WASM

The full implementation is in [`packages/parser/src/pe_unwind.rs`][pe-unwind].
The interesting bits:

### Finding the RUNTIME_FUNCTION

The `.pdata` section is sorted by `start_rva`, so binary search is trivial:

```rust
let mut lo = 0;
let mut hi = pdata_count;
while lo < hi {
    let mid = (lo + hi) / 2;
    let entry = read_runtime_function(pdata, mid)?;
    if rva < entry.start_rva      { hi = mid; }
    else if rva >= entry.end_rva  { lo = mid + 1; }
    else                          { return Some(entry); }
}
```

`pdata_count` we get from the PE optional header's exception-directory size
divided by 12. The whole search is bounds-checked because the input is
attacker-controlled — we treat the uploaded `.exe` as untrusted.

### Parsing UNWIND_INFO

The format is documented in [Microsoft's x64 exception handling spec][ms-spec]
but in practice it's:

```text
+0  Version : 3   |  Flags : 5
+1  SizeOfProlog  (bytes)
+2  CountOfCodes  (number of opcodes that follow)
+3  FrameRegister : 4  |  FrameOffset : 4
+4  UnwindCode[CountOfCodes]   ; each is 1-3 slots of 2 bytes
```

Each `UnwindCode` is a `(prologue_offset, opcode, op_info)` triple, sometimes
followed by extra slots for large constants. The five we actually care about
for typical Rust+MSVC output:

| Op            | Effect when unwinding (i.e. reversing the prologue) |
|---------------|-----------------------------------------------------|
| `PUSH_NONVOL` | RSP += 8 (the register's value is at `[RSP]` before that bump) |
| `ALLOC_SMALL` | RSP += `(op_info * 8) + 8` |
| `ALLOC_LARGE` | RSP += slot-encoded byte count |
| `SET_FPREG`   | RSP = frame_reg - frame_offset (we don't track FP value here) |
| `PUSH_MACHFRAME` | OS pushed a trap frame — RSP += 40, RIP comes from a different slot |

The first four are mundane stack arithmetic. The fifth — `PUSH_MACHFRAME` — is
what makes the unwinder correct across the **`__try`/`__except` boundary in
ntdll**, where the OS kernel itself pushed our crash frame. Without handling
it, we'd stop walking the moment we left user code.

### The walk loop

```rust
let mut rip = initial_rip;
let mut rsp = initial_rsp;
for _ in 0..32 {
    let rf = match find_runtime_function(rip - module_base) {
        Some(f) => f,
        None => { stopped = "no_pdata"; break; }
    };
    let info = parse_unwind_info(rf.unwind_info_rva)?;
    apply_unwind_codes(&info, &mut rsp, stack_bytes, stack_base)?;

    // Return address is now at [rsp].
    let ret = read_u64_at(stack_bytes, rsp - stack_base)?;
    frames.push(UnwoundFrame { rip, ... });
    rsp += 8;
    rip = ret;

    if rip < module_base || rip >= module_end {
        stopped = "outside_module";
        break;
    }
}
```

The bound of 32 frames is a guard against pathological loops; in practice we
stop at `outside_module` after 8-20 frames when the chain enters ntdll
(which we don't have a PDB for).

### Stack memory

`MINIDUMP_THREAD` has a `Stack: MINIDUMP_MEMORY_DESCRIPTOR` field which has a
`Memory.Rva` pointing at the captured stack bytes inside the dump file. We
copy that slab into a `Vec<u8>` and pass it to WASM as a parameter.

Important detail we got wrong the first time: the dump also has a
`MINIDUMP_EXCEPTION_STREAM` with its **own** `ThreadContext` 160 bytes in. That
context holds the registers *at the moment of the crash*, including `RIP`
pointing into the user's faulting function. The `Thread.ThreadContext` we
naively used pointed into the SEH dispatcher in ntdll — leading to a perfectly
correct unwound stack of *the SEH dispatcher walking up its own callers*. Once
we read the exception-stream context instead, every frame snapped into place.

---

## PDB symbolication, briefly

Once we have a list of `(module_basename, offset)` pairs, we look up each one
in the project's uploaded PDB:

1. Match by **signature + age** (the GUID and 32-bit version embedded in the
   PE's debug directory and the PDB header). This guarantees the PDB was built
   from the exact `.exe` that produced the dump.
2. For each frame's RVA, find the procedure that contains it.
3. For each frame's RVA, find the line program record that contains it.

The interesting wrinkle: **Rust binaries put almost all procedure symbols in
per-module symbol streams**, not in the global stream. Many off-the-shelf PDB
readers only iterate `pdb.global_symbols()` and come up empty. We had to walk
every module's `info.symbols()` too, and only then fall back to public-symbol
matching for anything still unresolved.

We also batch this. The first version called `pdb_resolve(bytes, rva)` once
per frame — a 16-frame stack triggered 16 full PDB scans. The current version
exposes `pdb_resolve_bulk(bytes, &[rvas])` which opens the PDB once, walks
each module stream once, and matches against every requested RVA in the inner
loop. For our test binary that turned a ~6 second cold path into ~400 ms.

---

## Edge caching

Everything above runs inside a Cloudflare Worker. The unwinder + PDB scanner
together is ~700 KB of WASM. The user's `.exe` is typically 2-5 MB and the
PDB is 10-50 MB. We fetch both from R2 — cheap and fast within the same
region — and we cache the bytes in the Workers Cache API for 24 hours:

```ts
const hit = await caches.default.match(cacheKey);
if (hit) return await hit.arrayBuffer();
const bytes = await bucket.get(key).then(o => o?.arrayBuffer());
ctx.waitUntil(caches.default.put(cacheKey, new Response(bytes, {
  headers: { "Cache-Control": "public, max-age=86400" },
})));
return bytes;
```

So the *first* view of any new group eats the R2 round-trip and the PDB
parse. Every subsequent view of any group in the same project — by anyone,
from any browser — hits the edge cache. The actual cold path on a fresh
isolate runs in about 1.5 seconds end-to-end for a 16-frame stack against a
28 MB PDB; warm paths return in 50 ms.

---

## What this buys us

- **No native server.** The same Worker that takes uploads also symbolicates.
  Cost scales linearly with request volume, which means a self-hosted instance
  costs nothing on the free tier and a few dollars a month at real volume.
- **Correctness on real Rust binaries.** SEH `.pdata` is the same mechanism
  Windows uses internally; we're not approximating it.
- **Auditability.** The whole unwinder is ~600 lines of Rust with no external
  dependencies for the actual unwinding logic. Anyone who wants to verify the
  stacks crashtrack shows them can read the code.

The full source is at [`AuDowty/crashtrack`][repo].

[pe-unwind]: https://github.com/AuDowty/crashtrack/blob/main/packages/parser/src/pe_unwind.rs
[ms-spec]:   https://learn.microsoft.com/en-us/cpp/build/exception-handling-x64
[repo]:      https://github.com/AuDowty/crashtrack
