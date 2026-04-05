//! crashtrack WASM helpers.
//!
//! Exports:
//! - `pdb_identity(bytes)` — extract signature + age from a PDB.
//! - `pdb_resolve(bytes, rva)` — function name covering an RVA in a PDB.
//! - `pe_walk_unwind(...)` — SEH `.pdata`-based stack walker (Phase 1 of v0.2 plan).
//!
//! Keep this tiny — every byte ships to every CF Worker request.

pub mod pe_unwind;

use pdb::{FallibleIterator, PDB};
use serde::Serialize;
use std::io::Cursor;
use wasm_bindgen::prelude::*;

// The pdb crate hides its Source impl on Cursor<Vec<u8>> behind a feature.
// Source<'s> bound forces 'static-ish data; we own the bytes so this is fine.

#[derive(Serialize)]
struct Identity {
    /// PDB GUID rendered as 32-char uppercase hex (no dashes) — matches the
    /// format Windows uses in the symbol-server path.
    signature: String,
    age:       u32,
    /// The original PDB filename ("myapp.pdb"). Useful for matching back to
    /// the executable.
    pdb_name: Option<String>,
}

#[derive(Serialize, Clone)]
struct Symbol {
    function: String,
    file: Option<String>,
    line: Option<u32>,
}

#[derive(Serialize, Clone)]
struct BulkSymbol {
    function: Option<String>,
    file: Option<String>,
    line: Option<u32>,
}

#[wasm_bindgen]
pub fn pdb_identity(bytes: Vec<u8>) -> Result<JsValue, JsError> {
    let cursor = Cursor::new(bytes);
    let mut pdb = PDB::open(cursor).map_err(jserr)?;
    let info = pdb.pdb_information().map_err(jserr)?;
    // Render the GUID as 32-char uppercase hex (windows symbol-server format).
    let mut sig = String::with_capacity(32);
    for byte in info.guid.as_bytes() {
        use std::fmt::Write;
        write!(&mut sig, "{:02X}", byte).unwrap();
    }
    let id = Identity {
        signature: sig,
        age:       info.age,
        pdb_name:  None, // PDB stream doesn't carry the source filename
    };
    serde_wasm_bindgen::to_value(&id).map_err(jserr2)
}

#[wasm_bindgen]
pub fn pdb_resolve(bytes: Vec<u8>, rva: u32) -> Result<JsValue, JsError> {
    let cursor = Cursor::new(bytes);
    let mut pdb = PDB::open(cursor).map_err(jserr)?;
    let address_map = pdb.address_map().map_err(jserr)?;
    let target = pdb::Rva(rva);

    // 1. Look in the global symbols first (DLL exports etc end up here).
    let mut found_function: Option<String> = None;
    let global_symbols = pdb.global_symbols().map_err(jserr)?;
    let mut syms = global_symbols.iter();
    while let Some(symbol) = syms.next().map_err(jserr)? {
        if let Ok(data) = symbol.parse() {
            if let pdb::SymbolData::Procedure(proc) = data {
                if let Some(start) = proc.offset.to_rva(&address_map) {
                    let end = pdb::Rva(start.0.saturating_add(proc.len));
                    if target >= start && target < end {
                        found_function = Some(proc.name.to_string().into_owned());
                        break;
                    }
                }
            }
        }
    }

    // 2. Walk every module's local symbol stream + line program. Rust binaries
    //    put almost all procedure symbols here, not in the global stream.
    let mut found_file: Option<String> = None;
    let mut found_line: Option<u32> = None;
    let string_table = pdb.string_table().ok();

    if let Ok(dbi) = pdb.debug_information() {
        if let Ok(mut modules) = dbi.modules() {
            while let Ok(Some(module)) = modules.next() {
                let info = match pdb.module_info(&module) {
                    Ok(Some(i)) => i,
                    _ => continue,
                };

                // 2a. Per-module procedure symbols.
                if found_function.is_none() {
                    if let Ok(mod_syms) = info.symbols() {
                        let mut iter = mod_syms;
                        while let Ok(Some(sym)) = iter.next() {
                            if let Ok(data) = sym.parse() {
                                if let pdb::SymbolData::Procedure(proc) = data {
                                    if let Some(start) = proc.offset.to_rva(&address_map) {
                                        let end = pdb::Rva(start.0.saturating_add(proc.len));
                                        if target >= start && target < end {
                                            found_function = Some(proc.name.to_string().into_owned());
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // 2b. Lines for this module — try regardless of which symbol stream the
                //     procedure name lived in.
                if found_line.is_none() {
                    if let Ok(lp) = info.line_program() {
                        let mut lines = lp.lines();
                        while let Ok(Some(line)) = lines.next() {
                            let line_rva = match line.offset.to_rva(&address_map) {
                                Some(r) => r,
                                None => continue,
                            };
                            let line_end = pdb::Rva(line_rva.0.saturating_add(line.length.unwrap_or(0)));
                            if target >= line_rva && target < line_end {
                                if let Some(ref st) = string_table {
                                    if let Ok(file_info) = lp.get_file_info(line.file_index) {
                                        if let Ok(name) = file_info.name.to_string_lossy(st) {
                                            found_file = Some(name.into_owned());
                                        }
                                    }
                                }
                                found_line = Some(line.line_start);
                                break;
                            }
                        }
                    }
                }

                if found_function.is_some() && found_line.is_some() { break; }
            }
        }
    }

    // 3. Last-resort fallback: public symbols (mangled but at least something).
    if found_function.is_none() {
        let pub_symbols = pdb.global_symbols().map_err(jserr)?;
        let mut iter = pub_symbols.iter();
        let mut best: Option<(pdb::Rva, String)> = None;
        while let Some(sym) = iter.next().map_err(jserr)? {
            if let Ok(pdb::SymbolData::Public(p)) = sym.parse() {
                if !p.function { continue; }
                if let Some(start) = p.offset.to_rva(&address_map) {
                    if start <= target {
                        match &best {
                            Some((cur, _)) if start <= *cur => {}
                            _ => best = Some((start, p.name.to_string().into_owned())),
                        }
                    }
                }
            }
        }
        if let Some((_, name)) = best {
            found_function = Some(name);
        }
    }

    let Some(function) = found_function else { return Ok(JsValue::NULL) };
    serde_wasm_bindgen::to_value(&Symbol { function, file: found_file, line: found_line })
        .map_err(jserr2)
}

/// Bulk RVA → symbol lookup. ONE PDB scan, ALL frames resolved.
/// Each module's symbol stream + line program is parsed once and matched
/// against every requested RVA, instead of scanning the whole PDB per frame.
/// 10-20x faster than calling pdb_resolve once per frame.
#[wasm_bindgen]
pub fn pdb_resolve_bulk(bytes: Vec<u8>, rvas: Vec<u32>) -> Result<JsValue, JsError> {
    let cursor = Cursor::new(bytes);
    let mut pdb = PDB::open(cursor).map_err(jserr)?;
    let address_map = pdb.address_map().map_err(jserr)?;

    let n = rvas.len();
    let mut results: Vec<BulkSymbol> = vec![
        BulkSymbol { function: None, file: None, line: None };
        n
    ];

    // 1. Global symbols (rare for Rust binaries but catches some).
    let global_symbols = pdb.global_symbols().map_err(jserr)?;
    let mut syms = global_symbols.iter();
    while let Some(symbol) = syms.next().map_err(jserr)? {
        if let Ok(pdb::SymbolData::Procedure(proc)) = symbol.parse() {
            if let Some(start) = proc.offset.to_rva(&address_map) {
                let end = pdb::Rva(start.0.saturating_add(proc.len));
                for (i, &rva) in rvas.iter().enumerate() {
                    if results[i].function.is_some() { continue; }
                    let target = pdb::Rva(rva);
                    if target >= start && target < end {
                        results[i].function = Some(proc.name.to_string().into_owned());
                    }
                }
            }
        }
    }

    // 2. Per-module symbol streams + line programs (one pass each).
    let string_table = pdb.string_table().ok();
    if let Ok(dbi) = pdb.debug_information() {
        if let Ok(mut modules) = dbi.modules() {
            while let Ok(Some(module)) = modules.next() {
                let info = match pdb.module_info(&module) {
                    Ok(Some(i)) => i,
                    _ => continue,
                };

                // Module procedures.
                if let Ok(mod_syms) = info.symbols() {
                    let mut iter = mod_syms;
                    while let Ok(Some(sym)) = iter.next() {
                        if let Ok(pdb::SymbolData::Procedure(proc)) = sym.parse() {
                            if let Some(start) = proc.offset.to_rva(&address_map) {
                                let end = pdb::Rva(start.0.saturating_add(proc.len));
                                for (i, &rva) in rvas.iter().enumerate() {
                                    if results[i].function.is_some() { continue; }
                                    let target = pdb::Rva(rva);
                                    if target >= start && target < end {
                                        results[i].function = Some(proc.name.to_string().into_owned());
                                    }
                                }
                            }
                        }
                    }
                }

                // Module lines.
                if let Ok(lp) = info.line_program() {
                    let mut lines = lp.lines();
                    while let Ok(Some(line)) = lines.next() {
                        let line_rva = match line.offset.to_rva(&address_map) {
                            Some(r) => r,
                            None => continue,
                        };
                        let line_end = pdb::Rva(line_rva.0.saturating_add(line.length.unwrap_or(0)));
                        for (i, &rva) in rvas.iter().enumerate() {
                            if results[i].line.is_some() { continue; }
                            let target = pdb::Rva(rva);
                            if target >= line_rva && target < line_end {
                                if let Some(ref st) = string_table {
                                    if let Ok(file_info) = lp.get_file_info(line.file_index) {
                                        if let Ok(name) = file_info.name.to_string_lossy(st) {
                                            results[i].file = Some(name.into_owned());
                                        }
                                    }
                                }
                                results[i].line = Some(line.line_start);
                            }
                        }
                    }
                }

                // Early exit: every requested RVA has fn AND line.
                if results.iter().all(|r| r.function.is_some() && r.line.is_some()) {
                    break;
                }
            }
        }
    }

    // 3. Public-symbol fallback for any still-unresolved fn.
    if results.iter().any(|r| r.function.is_none()) {
        let pub_syms = pdb.global_symbols().map_err(jserr)?;
        let mut iter = pub_syms.iter();
        // Build vec of (rva, name) for unresolved ones; pick closest <= target.
        let mut bests: Vec<Option<(pdb::Rva, String)>> = vec![None; n];
        while let Some(sym) = iter.next().map_err(jserr)? {
            if let Ok(pdb::SymbolData::Public(p)) = sym.parse() {
                if !p.function { continue; }
                if let Some(start) = p.offset.to_rva(&address_map) {
                    for (i, &rva) in rvas.iter().enumerate() {
                        if results[i].function.is_some() { continue; }
                        let target = pdb::Rva(rva);
                        if start <= target {
                            match &bests[i] {
                                Some((cur, _)) if start <= *cur => {}
                                _ => bests[i] = Some((start, p.name.to_string().into_owned())),
                            }
                        }
                    }
                }
            }
        }
        for (i, best) in bests.into_iter().enumerate() {
            if let Some((_, name)) = best {
                results[i].function = Some(name);
            }
        }
    }

    serde_wasm_bindgen::to_value(&results).map_err(jserr2)
}

fn jserr(e: pdb::Error) -> JsError {
    JsError::new(&e.to_string())
}

fn jserr2(e: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&e.to_string())
}
