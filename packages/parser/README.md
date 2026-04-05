# crashtrack-parser

Rust → WASM module the crashtrack worker uses to parse PDBs and walk PE `.pdata` stacks at request time.

## Exports

| function | input | output |
|---|---|---|
| `pdb_identity(bytes)` | PDB file | `{ signature, age, pdb_name }` |
| `pdb_resolve(bytes, rva)` | PDB file + RVA | `{ function, file, line } \| null` |
| `pdb_resolve_bulk(bytes, rvas[])` | PDB file + RVAs | `[{ function, file, line }, ...]` (one bulk PDB scan resolves all frames) |
| `pe_walk_unwind({ peBytes, stackBytes, ... })` | EXE/DLL + captured stack | `{ frames, stopped }` — SEH `.pdata`-based unwind |

## Build

```sh
wasm-pack build --target web --release
```

Output lands in `pkg/`. The worker imports it directly:

```ts
import init, { pdb_resolve_bulk } from "../../../packages/parser/pkg/crashtrack_parser.js";
import wasm from "../../../packages/parser/pkg/crashtrack_parser_bg.wasm";
await init(wasm);
const symbols = pdb_resolve_bulk(pdbBytes, [0x12345, 0x14d7, ...]);
```
