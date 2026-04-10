// WASM glue for the PDB symbolicator. The wasm-bindgen ESM glue expects
// either `init()` (auto-fetch via import.meta.url) or `init(module)` with a
// WebAssembly.Module — wrangler bundles the .wasm import as a Module, so we
// pass that.

import init, { pdb_identity, pdb_resolve, pdb_resolve_bulk, pe_walk_unwind } from "../../../../packages/parser/pkg/crashtrack_parser.js";
import wasmModule from "../../../../packages/parser/pkg/crashtrack_parser_bg.wasm";

export type PdbIdentity = { signature: string; age: number; pdb_name: string | null };
export type SymbolHit = { function: string; file: string | null; line: number | null };

let initPromise: Promise<unknown> | null = null;
function ensureInit(): Promise<unknown> {
  if (!initPromise) initPromise = init(wasmModule);
  return initPromise!;
}

export async function pdbIdentity(bytes: ArrayBuffer): Promise<PdbIdentity> {
  await ensureInit();
  return pdb_identity(new Uint8Array(bytes)) as PdbIdentity;
}

export async function symbolicate(
  pdbBytes: ArrayBuffer,
  rva: number,
): Promise<SymbolHit | null> {
  await ensureInit();
  return pdb_resolve(new Uint8Array(pdbBytes), rva) as SymbolHit | null;
}

export type BulkSymbolHit = {
  function: string | null;
  file: string | null;
  line: number | null;
};

/** Resolve many RVAs in one PDB scan. Returns array aligned with input. */
export async function symbolicateBulk(
  pdbBytes: ArrayBuffer,
  rvas: number[],
): Promise<BulkSymbolHit[]> {
  await ensureInit();
  return pdb_resolve_bulk(new Uint8Array(pdbBytes), new Uint32Array(rvas)) as BulkSymbolHit[];
}

export type UnwoundFrame = {
  rip: string;          // hex
  module: string | null;
  offset: string | null;
};

export type UnwindResult = {
  frames: UnwoundFrame[];
  stopped: string;
};

export async function peWalkUnwind(input: {
  peBytes: ArrayBuffer;
  stackBytes: Uint8Array;
  stackBase: bigint;
  moduleBase: bigint;
  moduleBasename: string;
  rip: bigint;
  rsp: bigint;
}): Promise<UnwindResult> {
  await ensureInit();
  return pe_walk_unwind(
    new Uint8Array(input.peBytes),
    input.stackBytes,
    "0x" + input.stackBase.toString(16),
    "0x" + input.moduleBase.toString(16),
    input.moduleBasename,
    "0x" + input.rip.toString(16),
    "0x" + input.rsp.toString(16),
  ) as UnwindResult;
}
