import type { Parsed } from "./minidump";
import { moduleContaining } from "./minidump";
import { sha256Hex } from "./crypto";

export type GroupingResult = {
  signature: string;
  exception_code: string | null;
  top_module: string | null;
  top_function: string | null;   // "+0xOFFSET" until symbolication lands
};

// Stable per-(crash-shape) signature. Uses code + the top up to 3 stack
// frames (module + offset). ASLR-stable: same bug across runs collapses even
// when load addresses differ. Falls back to single-frame when no stack walked.
export async function groupSignature(parsed: Parsed): Promise<GroupingResult> {
  if (!parsed.ok || !parsed.exception) {
    return {
      signature: await sha256Hex("unknown"),
      exception_code: null,
      top_module: null,
      top_function: null,
    };
  }

  const ex = parsed.exception;
  const top = parsed.frames.slice(0, 3);

  // Build a stable key from up to 3 frames + exception code. For access
  // violations also include op type so read-vs-write at the same address
  // group separately (often different bugs).
  const frameKeys = top.length > 0
    ? top.map((f) => f.module && f.offset != null
        ? `${f.module}+0x${f.offset.toString(16)}`
        : `_:${f.address.toString(16)}`)
    : [
        moduleContaining(parsed.modules, ex.address)
          ? (() => {
              const m = moduleContaining(parsed.modules, ex.address)!;
              return `${m.basename}+0x${(ex.address - m.base).toString(16)}`;
            })()
          : `_:${ex.address.toString(16)}`,
      ];
  const opKey = ex.av_operation ? `:${ex.av_operation}` : "";

  // For display: use the FIRST frame (the actual crash point).
  const first = top[0];
  let topModule: string | null = null;
  let topFunction: string | null = null;
  if (first) {
    topModule = first.module;
    topFunction = first.offset != null
      ? `+0x${first.offset.toString(16)}`
      : `0x${first.address.toString(16)}`;
  } else {
    const m = moduleContaining(parsed.modules, ex.address);
    topModule = m?.basename ?? null;
    topFunction = m
      ? `+0x${(ex.address - m.base).toString(16)}`
      : `0x${ex.address.toString(16)}`;
  }

  return {
    signature: await sha256Hex(`${ex.code_hex}${opKey}|${frameKeys.join("|")}`),
    exception_code: ex.code_hex,
    top_module: topModule,
    top_function: topFunction,
  };
}
