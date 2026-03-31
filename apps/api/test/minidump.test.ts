import { describe, it, expect } from "vitest";
import { parseMinidump, moduleContaining, walkCrashStack } from "../src/lib/minidump";

// Build a minimal valid minidump in memory: header + Exception + ModuleList streams.
// Layout (offsets after header are computed):
//   0x00  HEADER (32 bytes)
//   0x20  STREAM DIRECTORY (3 streams × 12 = 36 bytes)  -> 0x20..0x44
//   0x44  EXCEPTION STREAM (168 bytes)                  -> 0x44..0xEC
//   0xEC  MODULE LIST STREAM (4 + 108 = 112 bytes)      -> 0xEC..0x15C
//   0x15C SYSTEM INFO STREAM (56 bytes)                 -> 0x15C..0x194
//   0x194 STRING POOL (module name)                     -> 0x194..

const SIGNATURE = 0x504d444d; // 'MDMP'
const ST_THREAD = 3;
const ST_MODULES = 4;
const ST_EXCEPTION = 6;
const ST_SYSTEMINFO = 7;
void ST_THREAD;

function buildFixture(): ArrayBuffer {
  const buf = new ArrayBuffer(0x300);
  const dv = new DataView(buf);

  // ---- Header (32 bytes) ----
  dv.setUint32(0, SIGNATURE, true);
  dv.setUint32(4, 42899, true);     // version
  dv.setUint32(8, 3, true);         // NumberOfStreams
  dv.setUint32(12, 0x20, true);     // StreamDirectoryRva
  dv.setUint32(16, 0, true);        // CheckSum
  dv.setUint32(20, Math.floor(Date.now() / 1000), true);  // TimeDateStamp
  // Flags (u64) at offset 24 — leave zero

  // ---- Stream directory ----
  // Exception
  dv.setUint32(0x20, ST_EXCEPTION, true);
  dv.setUint32(0x24, 168, true);
  dv.setUint32(0x28, 0x44, true);
  // Modules
  dv.setUint32(0x2C, ST_MODULES, true);
  dv.setUint32(0x30, 112, true);
  dv.setUint32(0x34, 0xEC, true);
  // SystemInfo
  dv.setUint32(0x38, ST_SYSTEMINFO, true);
  dv.setUint32(0x3C, 56, true);
  dv.setUint32(0x40, 0x15C, true);

  // ---- Exception stream (offset 0x44) ----
  // ThreadId u32, __align u32, ExceptionCode u32, ExceptionFlags u32,
  // ExceptionRecord u64, ExceptionAddress u64, NumberParameters u32, __unused u32,
  // ExceptionInformation[15] u64
  dv.setUint32(0x44, 1234, true);                    // ThreadId
  dv.setUint32(0x48, 0, true);                       // __alignment
  dv.setUint32(0x4C, 0xC0000005, true);              // ExceptionCode (ACCESS_VIOLATION)
  dv.setUint32(0x50, 0, true);                       // Flags
  dv.setBigUint64(0x54, 0n, true);                   // ExceptionRecord
  dv.setBigUint64(0x5C, 0x140001234n, true);         // ExceptionAddress
  dv.setUint32(0x64, 0, true);                       // NumberParameters

  // ---- Module list (offset 0xEC) ----
  // NumberOfModules u32 = 1, then MINIDUMP_MODULE (108 bytes)
  dv.setUint32(0xEC, 1, true);
  // BaseOfImage u64 at offset 0xF0
  dv.setBigUint64(0xF0, 0x140000000n, true);
  // SizeOfImage u32
  dv.setUint32(0xF8, 0x10000, true);
  // CheckSum, TimeDateStamp
  dv.setUint32(0xFC, 0, true);
  dv.setUint32(0x100, 0, true);
  // ModuleNameRva u32 at offset 0x104 -> points to string at 0x194
  dv.setUint32(0x104, 0x194, true);
  // rest of module fields zeroed (already 0)

  // ---- SystemInfo (offset 0x15C) ----
  dv.setUint16(0x15C, 9, true);   // PROCESSOR_ARCHITECTURE x64
  dv.setUint16(0x15E, 0, true);   // Level
  dv.setUint16(0x160, 0, true);   // Revision
  dv.setUint8(0x162, 4);          // NumberOfProcessors
  dv.setUint8(0x163, 1);          // ProductType
  dv.setUint32(0x164, 10, true);  // MajorVersion
  dv.setUint32(0x168, 0, true);   // MinorVersion
  dv.setUint32(0x16C, 19045, true); // BuildNumber

  // ---- String pool: module name at offset 0x194 ----
  const name = "C:\\myapp\\bin\\myapp.exe";
  const utf16 = new Uint8Array(name.length * 2);
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    utf16[i * 2] = code & 0xff;
    utf16[i * 2 + 1] = (code >> 8) & 0xff;
  }
  dv.setUint32(0x194, utf16.length, true);
  new Uint8Array(buf, 0x198).set(utf16);

  return buf;
}

describe("walkCrashStack", () => {
  it("returns faulting frame + walked return-address candidates from memory64", () => {
    // Tiny synthetic dump: CONTEXT at offset 0, stack bytes at offset 200.
    const buf = new ArrayBuffer(512);
    const dv = new DataView(buf);

    // CONTEXT x64: Rsp at +0x98, Rip at +0xF8.
    dv.setBigUint64(0x98, 0x10000000n, true);
    dv.setBigUint64(0xF8, 0x140002000n, true);

    // Stack data — 5 u64s. Some land inside the module, some don't.
    const stackBase = 200;
    dv.setBigUint64(stackBase + 0,  0x1234567890ABCDEFn, true); // garbage
    dv.setBigUint64(stackBase + 8,  0x140005000n,         true); // in module
    dv.setBigUint64(stackBase + 16, 0xDEADBEEFn,          true); // garbage
    dv.setBigUint64(stackBase + 24, 0x140006000n,         true); // in module
    dv.setBigUint64(stackBase + 32, 0x140006000n,         true); // dup, must dedup

    const frames = walkCrashStack({
      dv,
      buf,
      threads: [{
        thread_id: 1,
        stack_start: 0x10000000n,
        stack_size: 40,
        context_size: 1232,
        context_rva: 0,
      }],
      exception: {
        thread_id: 1,
        code: 0xc0000005,
        code_hex: "0xC0000005",
        address: 0x140002000n,
      },
      modules: [{
        base: 0x140000000n,
        size: 0x10000,
        name: "C:\\myapp.exe",
        basename: "myapp.exe",
      }],
      mem64: { ranges: [{ addr: 0x10000000n, offset: stackBase, size: 40 }] },
    });

    // Faulting frame + 2 dedup'd candidates = 3 total.
    expect(frames.length).toBe(3);
    expect(frames[0]!.address).toBe(0x140002000n);
    expect(frames[0]!.module).toBe("myapp.exe");
    expect(frames[0]!.offset).toBe(0x2000n);
    expect(frames[1]!.address).toBe(0x140005000n);
    expect(frames[1]!.offset).toBe(0x5000n);
    expect(frames[2]!.address).toBe(0x140006000n);
  });

  it("returns just the faulting frame when there's no thread/context", () => {
    const buf = new ArrayBuffer(16);
    const dv = new DataView(buf);
    const frames = walkCrashStack({
      dv,
      buf,
      threads: [],
      exception: {
        thread_id: 99,
        code: 0xc0000005,
        code_hex: "0xC0000005",
        address: 0xdeadbeefn,
      },
      modules: [],
      mem64: null,
    });
    expect(frames.length).toBe(1);
    expect(frames[0]!.module).toBeNull();
  });
});

describe("parseMinidump", () => {
  it("rejects non-minidump bytes", () => {
    const buf = new ArrayBuffer(64);
    new DataView(buf).setUint32(0, 0x12345678, true);
    const r = parseMinidump(buf);
    expect(r.ok).toBe(false);
  });

  it("extracts exception code, address, and module", () => {
    const r = parseMinidump(buildFixture());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.exception).not.toBeNull();
    expect(r.exception!.code).toBe(0xc0000005);
    expect(r.exception!.code_hex).toBe("0xC0000005");
    expect(r.exception!.address).toBe(0x140001234n);

    expect(r.modules.length).toBe(1);
    expect(r.modules[0]!.basename).toBe("myapp.exe");
    expect(r.modules[0]!.base).toBe(0x140000000n);

    const m = moduleContaining(r.modules, r.exception!.address);
    expect(m?.basename).toBe("myapp.exe");

    expect(r.system).not.toBeNull();
    expect(r.system!.cpu_arch).toBe("x64");
    expect(r.system!.os_version).toBe("10.0.19045");
    expect(r.system!.num_processors).toBe(4);
  });
});
