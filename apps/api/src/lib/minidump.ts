// Minidump parser — minimal, just the streams we need for v1 ingest.
// Spec: https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/
// Stream type constants: https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/ne-minidumpapiset-minidump_stream_type

const SIGNATURE = 0x504d444d; // 'MDMP'

const StreamType = {
  ThreadList:   3,
  ModuleList:   4,
  Memory64List: 9,
  Exception:    6,
  SystemInfo:   7,
  Misc:        15,
} as const;

const ProcessorArch: Record<number, string> = {
  0:  "x86",
  5:  "arm",
  6:  "ia64",
  9:  "x64",
  12: "arm64",
};

export type Module = {
  base: bigint;
  size: number;
  name: string;
  basename: string;
};

export type SystemInfo = {
  cpu_arch: string;
  os_version: string;
  num_processors: number;
};

export type Exception = {
  thread_id: number;
  code: number;
  code_hex: string;
  code_name: string;             // "EXCEPTION_ACCESS_VIOLATION" etc.
  address: bigint;
  /** For access violations: 'read' | 'write' | 'execute', else null. */
  av_operation: "read" | "write" | "execute" | null;
  /** For access violations: the address the crashing code tried to access. */
  av_address: bigint | null;
};

// https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55
const EXCEPTION_NAMES: Record<number, string> = {
  0x80000003: "EXCEPTION_BREAKPOINT",
  0x80000004: "EXCEPTION_SINGLE_STEP",
  0xC0000005: "EXCEPTION_ACCESS_VIOLATION",
  0xC0000006: "EXCEPTION_IN_PAGE_ERROR",
  0xC000001D: "EXCEPTION_ILLEGAL_INSTRUCTION",
  0xC0000025: "EXCEPTION_NONCONTINUABLE_EXCEPTION",
  0xC0000026: "EXCEPTION_INVALID_DISPOSITION",
  0xC000008C: "EXCEPTION_ARRAY_BOUNDS_EXCEEDED",
  0xC000008D: "EXCEPTION_FLT_DENORMAL_OPERAND",
  0xC000008E: "EXCEPTION_FLT_DIVIDE_BY_ZERO",
  0xC000008F: "EXCEPTION_FLT_INEXACT_RESULT",
  0xC0000090: "EXCEPTION_FLT_INVALID_OPERATION",
  0xC0000091: "EXCEPTION_FLT_OVERFLOW",
  0xC0000092: "EXCEPTION_FLT_STACK_CHECK",
  0xC0000093: "EXCEPTION_FLT_UNDERFLOW",
  0xC0000094: "EXCEPTION_INT_DIVIDE_BY_ZERO",
  0xC0000095: "EXCEPTION_INT_OVERFLOW",
  0xC0000096: "EXCEPTION_PRIV_INSTRUCTION",
  0xC00000FD: "EXCEPTION_STACK_OVERFLOW",
  0xC0000135: "STATUS_DLL_NOT_FOUND",
  0xC0000142: "STATUS_DLL_INIT_FAILED",
  0xC0000409: "STATUS_STACK_BUFFER_OVERRUN",
  0xC0000417: "STATUS_INVALID_CRUNTIME_PARAMETER",
  0xC015000F: "EXCEPTION_ASSERTION_FAILURE",
};

export type Thread = {
  thread_id: number;
  stack_start: bigint;
  stack_size: number;
  stack_rva: number;       // file offset where stack memory lives
  context_size: number;
  context_rva: number;
};

export type Frame = {
  address: bigint;
  module: string | null;
  offset: bigint | null;
};

/** Context the server stores per-crash so view-time SEH unwinding can run
 *  without re-fetching the raw dump from R2. */
export type UnwindData = {
  rip: bigint;
  rsp: bigint;
  rbp: bigint;
  stack_base: bigint;
  stack_b64: string;       // base64-encoded crashing-thread stack bytes
};

export type Parsed = {
  ok: true;
  occurred_at: number | null;
  system: SystemInfo | null;
  modules: Module[];
  exception: Exception | null;
  thread_count: number;
  frames: Frame[];
} | {
  ok: false;
  reason: string;
};

export function parseMinidump(buf: ArrayBuffer): Parsed {
  if (buf.byteLength < 32) return fail("too_small");
  const dv = new DataView(buf);

  const sig = dv.getUint32(0, true);
  if (sig !== SIGNATURE) return fail("bad_signature");
  const numStreams = dv.getUint32(8, true);
  const dirRva = dv.getUint32(12, true);
  if (dirRva + numStreams * 12 > buf.byteLength) return fail("bad_directory");

  let systemRva = 0, systemSize = 0;
  let miscRva = 0, miscSize = 0;
  let modulesRva = 0, modulesSize = 0;
  let exceptionRva = 0, exceptionSize = 0;
  let threadsRva = 0, threadsSize = 0;
  let mem64Rva = 0, mem64Size = 0;

  for (let i = 0; i < numStreams; i++) {
    const off = dirRva + i * 12;
    const type = dv.getUint32(off, true);
    const size = dv.getUint32(off + 4, true);
    const rva = dv.getUint32(off + 8, true);
    if (type === StreamType.SystemInfo)        { systemRva = rva; systemSize = size; }
    else if (type === StreamType.Misc)         { miscRva = rva; miscSize = size; }
    else if (type === StreamType.ModuleList)   { modulesRva = rva; modulesSize = size; }
    else if (type === StreamType.Exception)    { exceptionRva = rva; exceptionSize = size; }
    else if (type === StreamType.ThreadList)   { threadsRva = rva; threadsSize = size; }
    else if (type === StreamType.Memory64List) { mem64Rva = rva; mem64Size = size; }
  }

  const modules = modulesRva ? readModules(dv, modulesRva, modulesSize, buf) : [];
  const exception = exceptionRva ? readException(dv, exceptionRva, exceptionSize) : null;
  const threads = threadsRva ? readThreads(dv, threadsRva, threadsSize) : [];
  const mem64 = mem64Rva ? readMemory64List(dv, mem64Rva, mem64Size) : null;

  const frames = walkCrashStack({ dv, buf, threads, exception, modules, mem64 });

  return {
    ok: true,
    occurred_at: miscRva ? readMiscTimestamp(dv, miscRva, miscSize) : null,
    system: systemRva ? readSystemInfo(dv, systemRva, systemSize, buf) : null,
    modules,
    exception,
    thread_count: threads.length || (threadsRva ? dv.getUint32(threadsRva, true) : 0),
    frames,
  };
}

function fail(reason: string): Parsed {
  return { ok: false, reason };
}

function readMiscTimestamp(dv: DataView, rva: number, size: number): number | null {
  if (size < 24) return null;
  const flags = dv.getUint32(rva + 4, true);
  if (!(flags & 2)) return null;
  const createSec = dv.getUint32(rva + 12, true);
  return createSec * 1000;
}

function readSystemInfo(dv: DataView, rva: number, size: number, buf: ArrayBuffer): SystemInfo | null {
  if (size < 56) return null;
  const arch = dv.getUint16(rva, true);
  const numProc = dv.getUint8(rva + 6);
  const major = dv.getUint32(rva + 8, true);
  const minor = dv.getUint32(rva + 12, true);
  const build = dv.getUint32(rva + 16, true);
  void buf;
  return {
    cpu_arch: ProcessorArch[arch] ?? `unknown(${arch})`,
    os_version: `${major}.${minor}.${build}`,
    num_processors: numProc,
  };
}

function readMinidumpString(dv: DataView, rva: number, buf: ArrayBuffer): string {
  if (rva + 4 > buf.byteLength) return "";
  const lenBytes = dv.getUint32(rva, true);
  const start = rva + 4;
  if (start + lenBytes > buf.byteLength) return "";
  return new TextDecoder("utf-16le").decode(new Uint8Array(buf, start, lenBytes));
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function readModules(dv: DataView, rva: number, size: number, buf: ArrayBuffer): Module[] {
  if (size < 4) return [];
  const count = dv.getUint32(rva, true);
  const MODULE_SIZE = 108;
  if (4 + count * MODULE_SIZE > size) return [];
  const out: Module[] = [];
  for (let i = 0; i < count; i++) {
    const off = rva + 4 + i * MODULE_SIZE;
    const base = dv.getBigUint64(off, true);
    const sizeOfImage = dv.getUint32(off + 8, true);
    const nameRva = dv.getUint32(off + 20, true);
    const name = readMinidumpString(dv, nameRva, buf);
    out.push({ base, size: sizeOfImage, name, basename: basename(name).toLowerCase() });
  }
  return out;
}

function readException(dv: DataView, rva: number, size: number): Exception | null {
  // MINIDUMP_EXCEPTION_STREAM: ThreadId u32, __alignment u32, MINIDUMP_EXCEPTION
  // MINIDUMP_EXCEPTION: ExceptionCode u32, ExceptionFlags u32, ExceptionRecord u64,
  //   ExceptionAddress u64, NumberParameters u32, __unusedAlignment u32,
  //   ExceptionInformation[15] u64
  if (size < 8 + 24) return null;
  const exBase = rva + 8;
  const threadId = dv.getUint32(rva, true);
  const code = dv.getUint32(exBase + 0, true);
  const addr = dv.getBigUint64(exBase + 16, true);
  const numParams = dv.getUint32(exBase + 24, true);

  // For access violations, the first two ExceptionInformation entries are
  // operation type (0=read, 1=write, 8=execute) and faulting address.
  let av_operation: Exception["av_operation"] = null;
  let av_address: bigint | null = null;
  if (code === 0xC0000005 && numParams >= 2) {
    const op = dv.getBigUint64(exBase + 32, true);   // ExceptionInformation[0]
    const va = dv.getBigUint64(exBase + 40, true);   // ExceptionInformation[1]
    av_operation = op === 0n ? "read" : op === 1n ? "write" : op === 8n ? "execute" : null;
    av_address = va;
  }

  return {
    thread_id: threadId,
    code,
    code_hex: "0x" + code.toString(16).toUpperCase().padStart(8, "0"),
    code_name: EXCEPTION_NAMES[code] ?? "UNKNOWN_EXCEPTION",
    address: addr,
    av_operation,
    av_address,
  };
}

// MINIDUMP_THREAD: ThreadId u32, SuspendCount u32, PriorityClass u32, Priority u32,
//   Teb u64, Stack { StartOfMemoryRange u64, Memory { DataSize u32, Rva u32 } },
//   ThreadContext { DataSize u32, Rva u32 }
// 48 bytes total. Stack starts at +24, ThreadContext at +40.
function readThreads(dv: DataView, rva: number, size: number): Thread[] {
  if (size < 4) return [];
  const count = dv.getUint32(rva, true);
  const THREAD_SIZE = 48;
  if (4 + count * THREAD_SIZE > size) return [];
  const out: Thread[] = [];
  for (let i = 0; i < count; i++) {
    const off = rva + 4 + i * THREAD_SIZE;
    out.push({
      thread_id:    dv.getUint32(off + 0, true),
      // +4 SuspendCount, +8 PriorityClass, +12 Priority, +16 Teb (u64)
      stack_start:  dv.getBigUint64(off + 24, true),  // Stack.StartOfMemoryRange
      stack_size:   dv.getUint32(off + 32, true),     // Stack.Memory.DataSize
      stack_rva:    dv.getUint32(off + 36, true),     // Stack.Memory.Rva (file offset)
      context_size: dv.getUint32(off + 40, true),     // ThreadContext.DataSize
      context_rva:  dv.getUint32(off + 44, true),     // ThreadContext.Rva
    });
  }
  return out;
}

type Mem64Range = { addr: bigint; offset: number; size: number };

// MINIDUMP_MEMORY64_LIST: NumberOfMemoryRanges u64, BaseRva u64, then array of
// MINIDUMP_MEMORY_DESCRIPTOR64 { StartOfMemoryRange u64, DataSize u64 }.
// Memory bytes are stored contiguously starting at BaseRva.
function readMemory64List(dv: DataView, rva: number, size: number): { ranges: Mem64Range[] } | null {
  if (size < 16) return null;
  const count = Number(dv.getBigUint64(rva, true));
  const baseRva = Number(dv.getBigUint64(rva + 8, true));
  if (count > 100_000) return null;  // sanity guard against corrupt headers
  const ranges: Mem64Range[] = [];
  let offset = baseRva;
  for (let i = 0; i < count; i++) {
    const entryOff = rva + 16 + i * 16;
    if (entryOff + 16 > rva + size) break;
    const addr = dv.getBigUint64(entryOff, true);
    const dataSize = Number(dv.getBigUint64(entryOff + 8, true));
    ranges.push({ addr, offset, size: dataSize });
    offset += dataSize;
  }
  return { ranges };
}

// Find the slice of buf containing memory at `addr`. Returns the in-file byte
// offset where `addr` lives + how many bytes are available from that point.
function findMemory(
  bufSize: number,
  mem64: { ranges: Mem64Range[] } | null,
  threadStack: { start: bigint; size: number; rva: number } | null,
  addr: bigint,
): { offset: number; available: number } | null {
  // Prefer Memory64List (modern dumps).
  if (mem64) {
    for (const r of mem64.ranges) {
      const end = r.addr + BigInt(r.size);
      if (addr >= r.addr && addr < end) {
        const delta = Number(addr - r.addr);
        const off = r.offset + delta;
        const avail = r.size - delta;
        if (off + avail <= bufSize) return { offset: off, available: avail };
        if (off < bufSize) return { offset: off, available: bufSize - off };
      }
    }
  }
  // Fallback: ThreadList's embedded Stack descriptor.
  if (threadStack && addr >= threadStack.start &&
      addr < threadStack.start + BigInt(threadStack.size)) {
    const delta = Number(addr - threadStack.start);
    const off = threadStack.rva + delta;
    const avail = threadStack.size - delta;
    if (off + avail <= bufSize) return { offset: off, available: avail };
  }
  return null;
}

// Read x64 CONTEXT struct: Rsp at +0x98, Rbp at +0xA0, Rip at +0xF8.
function readContextX64(
  dv: DataView,
  rva: number,
  size: number,
): { rip: bigint; rsp: bigint; rbp: bigint } | null {
  if (size < 0x100) return null;
  return {
    rsp: dv.getBigUint64(rva + 0x98, true),
    rbp: dv.getBigUint64(rva + 0xA0, true),
    rip: dv.getBigUint64(rva + 0xF8, true),
  };
}

const MAX_FRAMES = 16;

// Walk the crashing thread's stack. Try RBP-chain first (precise — follows
// the frame-pointer linked list set up by `push rbp; mov rbp, rsp`); if RBP
// is missing or chain breaks, fall back to naive RSP scan. With
// `-C force-frame-pointers=yes` builds, RBP walk gives the exact call chain.
export function walkCrashStack(input: {
  dv: DataView;
  buf: ArrayBuffer;
  threads: Thread[];
  exception: Exception | null;
  modules: Module[];
  mem64: { ranges: Mem64Range[] } | null;
}): Frame[] {
  const { dv, buf, threads, exception, modules, mem64 } = input;
  if (!exception) return [];

  const thread = threads.find((t) => t.thread_id === exception.thread_id);
  const ctx = thread ? readContextX64(dv, thread.context_rva, thread.context_size) : null;
  const frames: Frame[] = [annotate(exception.address, modules)];

  if (!ctx || !thread) return frames;

  const stackBounds = {
    start: thread.stack_start,
    end: thread.stack_start + BigInt(thread.stack_size),
  };
  const readU64 = (addr: bigint): bigint | null => {
    const loc = findMemory(
      buf.byteLength,
      mem64,
      { start: thread.stack_start, size: thread.stack_size, rva: 0 },
      addr,
    );
    if (!loc || loc.available < 8) return null;
    return dv.getBigUint64(loc.offset, true);
  };

  const seen = new Set<bigint>();
  seen.add(exception.address);

  // ---- (1) RBP-chain walk ----
  // [rbp] = saved rbp (caller's), [rbp + 8] = saved rip (return address).
  let rbp = ctx.rbp;
  let chainLen = 0;
  while (
    rbp !== 0n &&
    rbp >= stackBounds.start &&
    rbp < stackBounds.end &&
    frames.length < MAX_FRAMES &&
    chainLen++ < MAX_FRAMES
  ) {
    const ret = readU64(rbp + 8n);
    const next = readU64(rbp);
    if (ret == null) break;
    const inModule = moduleContaining(modules, ret);
    if (inModule && !seen.has(ret) && ret - inModule.base !== 0n) {
      seen.add(ret);
      frames.push({ address: ret, module: inModule.basename, offset: ret - inModule.base });
    }
    if (next == null || next <= rbp) break;  // bad chain — bail
    rbp = next;
  }

  // ---- (2) RSP fallback scan ----
  // Only run if RBP walk didn't produce much. Picks up anything else that
  // looks like a return address on the stack.
  if (frames.length < 4) {
    const stackLoc = findMemory(buf.byteLength, mem64,
      { start: thread.stack_start, size: thread.stack_size, rva: 0 }, ctx.rsp);
    if (stackLoc) {
      let scanned = 0;
      for (let off = 0; off + 8 <= stackLoc.available && frames.length < MAX_FRAMES; off += 8) {
        if (scanned++ > 8192) break;
        const value = dv.getBigUint64(stackLoc.offset + off, true);
        if (seen.has(value)) continue;
        const inModule = moduleContaining(modules, value);
        if (!inModule) continue;
        const offset = value - inModule.base;
        if (offset === 0n) continue;
        seen.add(value);
        frames.push({ address: value, module: inModule.basename, offset });
      }
    }
  }
  return frames;
}

function annotate(addr: bigint, modules: Module[]): Frame {
  const m = moduleContaining(modules, addr);
  if (!m) return { address: addr, module: null, offset: null };
  return { address: addr, module: m.basename, offset: addr - m.base };
}

export function moduleContaining(modules: Module[], addr: bigint): Module | null {
  for (const m of modules) {
    if (addr >= m.base && addr < m.base + BigInt(m.size)) return m;
  }
  return null;
}

/** Extract the crashing thread's stack memory + register state so we can
 *  run SEH unwinding later without re-fetching the dump from R2. */
export function extractUnwindData(
  buf: ArrayBuffer,
  parsed: Extract<Parsed, { ok: true }>,
): UnwindData | null {
  if (!parsed.exception) return null;
  const dv = new DataView(buf);
  // Re-derive thread/exception/mem from the same logic walkCrashStack uses.
  let threadsRva = 0, threadsSize = 0;
  let exceptionRva = 0;
  let mem64Rva = 0, mem64Size = 0;
  const numStreams = dv.getUint32(8, true);
  const dirRva = dv.getUint32(12, true);
  for (let i = 0; i < numStreams; i++) {
    const off = dirRva + i * 12;
    const type = dv.getUint32(off, true);
    const size = dv.getUint32(off + 4, true);
    const rva = dv.getUint32(off + 8, true);
    if (type === 3)      { threadsRva = rva; threadsSize = size; }
    else if (type === 6) { exceptionRva = rva; }
    else if (type === 9) { mem64Rva = rva; mem64Size = size; }
  }
  if (!threadsRva || !exceptionRva) return null;

  const threads = readThreadsLocal(dv, threadsRva, threadsSize);
  const thread = threads.find((t) => t.thread_id === parsed.exception!.thread_id);
  if (!thread) return null;

  // Prefer the exception's own ThreadContext (= state AT crash time) over the
  // thread's current context (= state when MiniDumpWriteDump captured it,
  // which is INSIDE our SEH filter so the rip is in ntdll). The exception
  // stream stores MINIDUMP_LOCATION_DESCRIPTOR ThreadContext at offset +160:
  // 0..160 is ThreadId u32 + __align u32 + MINIDUMP_EXCEPTION (152 bytes),
  // then DataSize u32 (+160) + Rva u32 (+164).
  const exContextSize = dv.getUint32(exceptionRva + 160, true);
  const exContextRva  = dv.getUint32(exceptionRva + 164, true);
  const ctxRva  = exContextSize >= 0x100 ? exContextRva : thread.context_rva;
  const ctxSize = exContextSize >= 0x100 ? exContextSize : thread.context_size;
  if (ctxSize < 0x100) return null;

  // CONTEXT x64: Rsp +0x98, Rbp +0xA0, Rip +0xF8.
  const rsp = dv.getBigUint64(ctxRva + 0x98, true);
  const rbp = dv.getBigUint64(ctxRva + 0xA0, true);
  const rip = dv.getBigUint64(ctxRva + 0xF8, true);

  // Prefer the THREAD's embedded Stack memory (always populated). Fall back
  // to Memory64List if for some reason it's not there.
  let stackStart: bigint;
  let stackSize: number;
  let stackFileOff: number;
  if (thread.stack_size > 0 && thread.stack_rva > 0) {
    stackStart   = thread.stack_start;
    stackSize    = thread.stack_size;
    stackFileOff = thread.stack_rva;
  } else {
    const mem64 = mem64Rva ? readMemory64List(dv, mem64Rva, mem64Size) : null;
    if (!mem64) return null;
    const range = mem64.ranges.find((r) =>
      rsp >= r.addr && rsp < r.addr + BigInt(r.size));
    if (!range) return null;
    stackStart   = range.addr;
    stackSize    = range.size;
    stackFileOff = range.offset;
  }

  // Capture from RSP forward (the only part we need for unwinding). Cap at
  // 96 KB to keep D1 row size bounded.
  if (rsp < stackStart) return null;
  const startOffsetInStack = Number(rsp - stackStart);
  if (startOffsetInStack >= stackSize) return null;
  const available = Math.min(stackSize - startOffsetInStack, 96 * 1024);
  const slice = new Uint8Array(buf, stackFileOff + startOffsetInStack, available);
  let bin = "";
  for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i]!);
  const stack_b64 = btoa(bin);
  return { rip, rsp, rbp, stack_base: rsp, stack_b64 };
}

// Local copy because the top-level walkCrashStack already swallowed these.
function readThreadsLocal(dv: DataView, rva: number, size: number): Thread[] {
  if (size < 4) return [];
  const count = dv.getUint32(rva, true);
  const T = 48;
  if (4 + count * T > size) return [];
  const out: Thread[] = [];
  for (let i = 0; i < count; i++) {
    const off = rva + 4 + i * T;
    out.push({
      thread_id:    dv.getUint32(off, true),
      stack_start:  dv.getBigUint64(off + 24, true),
      stack_size:   dv.getUint32(off + 32, true),
      stack_rva:    dv.getUint32(off + 36, true),
      context_size: dv.getUint32(off + 40, true),
      context_rva:  dv.getUint32(off + 44, true),
    });
  }
  return out;
}
