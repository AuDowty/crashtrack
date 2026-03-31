import { describe, it, expect } from "vitest";
import { groupSignature } from "../src/lib/grouping";
import type { Parsed } from "../src/lib/minidump";

function ok(opts: {
  code?: number;
  address: bigint;
  modules: { base: bigint; size: number; basename: string }[];
}): Parsed {
  const modules = opts.modules.map((m) => ({ ...m, name: `C:\\${m.basename}` }));
  const containing = modules.find(
    (m) => opts.address >= m.base && opts.address < m.base + BigInt(m.size),
  );
  // Synthesize a 1-frame stack so groupSignature uses the frame path
  // (its real production input). Tests still exercise the same observable behavior.
  const frames = [{
    address: opts.address,
    module: containing?.basename ?? null,
    offset: containing ? opts.address - containing.base : null,
  }];
  return {
    ok: true,
    occurred_at: null,
    system: null,
    modules,
    exception: {
      thread_id: 1,
      code: opts.code ?? 0xc0000005,
      code_hex: "0x" + (opts.code ?? 0xc0000005).toString(16).toUpperCase().padStart(8, "0"),
      address: opts.address,
    },
    thread_count: 1,
    frames,
  };
}

describe("groupSignature", () => {
  it("is identical for identical crashes across two runs", async () => {
    const a = await groupSignature(ok({
      address: 0x140001234n,
      modules: [{ base: 0x140000000n, size: 0x100000, basename: "myapp.exe" }],
    }));
    const b = await groupSignature(ok({
      address: 0x140001234n,
      modules: [{ base: 0x140000000n, size: 0x100000, basename: "myapp.exe" }],
    }));
    expect(a.signature).toBe(b.signature);
  });

  it("groups crashes at the same offset even if the module was loaded at a different base", async () => {
    // Same bug at offset +0x1234 in myapp.exe, ASLR moved the load address.
    const a = await groupSignature(ok({
      address: 0x140001234n,
      modules: [{ base: 0x140000000n, size: 0x100000, basename: "myapp.exe" }],
    }));
    const b = await groupSignature(ok({
      address: 0x7ff7_abc01234n,
      modules: [{ base: 0x7ff7_abc00000n, size: 0x100000, basename: "myapp.exe" }],
    }));
    expect(a.signature).toBe(b.signature);
  });

  it("distinguishes different exception codes at the same address", async () => {
    const a = await groupSignature(ok({
      code: 0xc0000005,
      address: 0x140001234n,
      modules: [{ base: 0x140000000n, size: 0x100000, basename: "myapp.exe" }],
    }));
    const b = await groupSignature(ok({
      code: 0xc0000094, // EXCEPTION_INT_DIVIDE_BY_ZERO
      address: 0x140001234n,
      modules: [{ base: 0x140000000n, size: 0x100000, basename: "myapp.exe" }],
    }));
    expect(a.signature).not.toBe(b.signature);
  });

  it("distinguishes different modules", async () => {
    const a = await groupSignature(ok({
      address: 0x140001234n,
      modules: [{ base: 0x140000000n, size: 0x100000, basename: "myapp.exe" }],
    }));
    const b = await groupSignature(ok({
      address: 0x180001234n,
      modules: [{ base: 0x180000000n, size: 0x100000, basename: "otherlib.dll" }],
    }));
    expect(a.signature).not.toBe(b.signature);
  });

  it("falls back to address-based grouping when faulting address is outside any module", async () => {
    const r = await groupSignature(ok({
      address: 0xdeadbeefn,
      modules: [{ base: 0x140000000n, size: 0x100000, basename: "myapp.exe" }],
    }));
    expect(r.top_module).toBeNull();
    expect(r.signature).toMatch(/^[0-9a-f]{64}$/);
  });
});
