//! x64 SEH `.pdata` / `.xdata` unwinder.
//!
//! Walks the precise call chain by following Windows' own unwind metadata —
//! the same data the kernel uses for exception dispatch. Works regardless of
//! frame pointers, FPO, tail-call optimization, or inlining.
//!
//! Spec references:
//! - .pdata = array of `RUNTIME_FUNCTION { begin_rva, end_rva, unwind_info_rva }`  (12 bytes each)
//! - .xdata = `UNWIND_INFO { version:flags, prologue_size, unwind_count, frame_reg:offset, codes[N] }`
//! - https://learn.microsoft.com/en-us/cpp/build/exception-handling-x64

use goblin::pe::PE;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
pub struct UnwoundFrame {
    pub rip:    String,    // hex
    pub module: Option<String>,
    pub offset: Option<String>,
}

#[derive(Serialize)]
pub struct UnwindResult {
    pub frames: Vec<UnwoundFrame>,
    pub stopped: String,
}

// UNWIND_OP codes (UNWIND_CODE.UnwindOp).
const UWOP_PUSH_NONVOL:     u8 = 0;
const UWOP_ALLOC_LARGE:     u8 = 1;
const UWOP_ALLOC_SMALL:     u8 = 2;
const UWOP_SET_FPREG:       u8 = 3;
const UWOP_SAVE_NONVOL:     u8 = 4;
const UWOP_SAVE_NONVOL_FAR: u8 = 5;
const UWOP_SAVE_XMM128:     u8 = 8;
const UWOP_SAVE_XMM128_FAR: u8 = 9;
const UWOP_PUSH_MACHFRAME:  u8 = 10;

const UNW_FLAG_CHAININFO: u8 = 0x4;

/// Walk the call chain starting at (rip, rsp) using `.pdata` metadata from
/// the user's PE. Stops when:
/// - RIP falls outside the user's module (we walked into a system DLL — caller
///   can resume with a different walker from there if needed),
/// - We hit a leaf function (no RUNTIME_FUNCTION at RIP),
/// - We run out of stack memory,
/// - Frame count cap reached.
#[wasm_bindgen]
pub fn pe_walk_unwind(
    pe_bytes: &[u8],
    stack_bytes: &[u8],
    stack_base_hex: String,
    module_base_hex: String,
    module_basename: String,
    initial_rip_hex: String,
    initial_rsp_hex: String,
) -> Result<JsValue, JsError> {
    let stack_base   = u64::from_str_radix(&strip_hex(&stack_base_hex),   16).map_err(je)?;
    let module_base  = u64::from_str_radix(&strip_hex(&module_base_hex),  16).map_err(je)?;
    let initial_rip  = u64::from_str_radix(&strip_hex(&initial_rip_hex),  16).map_err(je)?;
    let initial_rsp  = u64::from_str_radix(&strip_hex(&initial_rsp_hex),  16).map_err(je)?;

    let pe = PE::parse(pe_bytes).map_err(|e| JsError::new(&e.to_string()))?;
    let pdata = pe.sections.iter().find(|s| s.name().map(|n| n == ".pdata").unwrap_or(false));
    let Some(pdata) = pdata else {
        return js(&UnwindResult { frames: vec![], stopped: "no_pdata_section".into() });
    };

    let module_size = pe.header.optional_header
        .map(|h| h.windows_fields.size_of_image as u64)
        .unwrap_or(0x1000_0000);
    let module_end = module_base.saturating_add(module_size);

    let mut frames = Vec::new();
    let mut rip = initial_rip;
    let mut rsp = initial_rsp;
    let mut stopped = "max_frames".to_string();

    for _ in 0..32 {
        // Emit current frame
        let in_module = rip >= module_base && rip < module_end;
        let off = if in_module { Some(rip - module_base) } else { None };
        frames.push(UnwoundFrame {
            rip: hex(rip),
            module: if in_module { Some(module_basename.clone()) } else { None },
            offset: off.map(hex),
        });

        if !in_module {
            stopped = "outside_module".into();
            break;
        }
        if rip == 0 {
            stopped = "rip_zero".into();
            break;
        }

        let rva = (rip - module_base) as u32;
        let Some(rf) = find_runtime_function(pe_bytes, pdata, rva) else {
            stopped = "no_runtime_function".into();
            break;
        };

        // Walk possibly-chained UNWIND_INFO records, accumulating effect on RSP.
        let mut cur_uir = rf.unwind_info_rva;
        let mut chain_limit = 8;
        loop {
            if chain_limit == 0 { break; }
            chain_limit -= 1;
            let Some(ui) = parse_unwind_info(pe_bytes, &pe, cur_uir) else {
                stopped = "bad_unwind_info".into();
                return js(&UnwindResult { frames, stopped });
            };
            // For frames that are NOT inside the prologue, apply ALL codes.
            // (Inside-prologue is rare for crashes and handling it precisely
            // requires knowing where in the prologue we are.)
            apply_unwind_codes(&ui, &mut rsp);
            if !ui.has_chain { break; }
            cur_uir = ui.chained_unwind_rva;
        }

        // Read return address from [rsp]; then pop it.
        let Some(ret) = read_stack_u64(stack_bytes, stack_base, rsp) else {
            stopped = "ret_addr_not_in_stack".into();
            break;
        };
        rsp = rsp.saturating_add(8);
        if ret == 0 {
            stopped = "ret_zero".into();
            break;
        }
        rip = ret;
    }

    js(&UnwindResult { frames, stopped })
}

struct RuntimeFunction {
    begin_rva:       u32,
    end_rva:         u32,
    unwind_info_rva: u32,
}

fn find_runtime_function(
    pe_bytes: &[u8],
    pdata: &goblin::pe::section_table::SectionTable,
    target_rva: u32,
) -> Option<RuntimeFunction> {
    let file_off = pdata.pointer_to_raw_data as usize;
    let size     = pdata.size_of_raw_data as usize;
    if file_off + size > pe_bytes.len() { return None; }
    let bytes = &pe_bytes[file_off..file_off + size];
    if bytes.len() < 12 { return None; }
    let n = bytes.len() / 12;

    // Binary search on begin_rva.
    let mut lo = 0usize;
    let mut hi = n;
    while lo < hi {
        let mid = (lo + hi) / 2;
        let off = mid * 12;
        let begin = u32::from_le_bytes(bytes[off..off + 4].try_into().ok()?);
        let end   = u32::from_le_bytes(bytes[off + 4..off + 8].try_into().ok()?);
        if target_rva < begin { hi = mid; }
        else if target_rva >= end { lo = mid + 1; }
        else {
            let uir = u32::from_le_bytes(bytes[off + 8..off + 12].try_into().ok()?);
            return Some(RuntimeFunction { begin_rva: begin, end_rva: end, unwind_info_rva: uir });
        }
    }
    None
}

struct UnwindInfo {
    has_chain: bool,
    chained_unwind_rva: u32,
    codes: Vec<UnwindCode>,
}

#[derive(Clone, Copy)]
struct UnwindCode {
    unwind_op: u8,
    op_info:   u8,
    extra:     u32,   // u16 immediately following the code, or larger for ALLOC_LARGE
}

fn parse_unwind_info(pe_bytes: &[u8], pe: &PE, unwind_info_rva: u32) -> Option<UnwindInfo> {
    let file_off = rva_to_file_offset(pe, unwind_info_rva)?;
    if file_off + 4 > pe_bytes.len() { return None; }
    let h0 = pe_bytes[file_off];
    let flags = h0 >> 3;
    let count = pe_bytes[file_off + 2] as usize;
    if count > 64 { return None; } // sanity

    // Each code is 2 bytes; some consume extra slot(s).
    let codes_off = file_off + 4;
    if codes_off + count * 2 > pe_bytes.len() { return None; }

    let mut codes = Vec::new();
    let mut i = 0usize;
    while i < count {
        let off = codes_off + i * 2;
        let unwind_op = pe_bytes[off + 1] & 0x0F;
        let op_info   = pe_bytes[off + 1] >> 4;

        let (extra, advance) = match unwind_op {
            UWOP_ALLOC_LARGE if op_info == 0 => {
                if i + 1 >= count { return None; }
                let v = u16::from_le_bytes(pe_bytes[off + 2..off + 4].try_into().ok()?);
                (v as u32 * 8, 2)
            }
            UWOP_ALLOC_LARGE if op_info == 1 => {
                if i + 2 >= count { return None; }
                let v = u32::from_le_bytes(pe_bytes[off + 2..off + 6].try_into().ok()?);
                (v, 3)
            }
            UWOP_SAVE_NONVOL | UWOP_SAVE_XMM128 => {
                if i + 1 >= count { return None; }
                let _ = u16::from_le_bytes(pe_bytes[off + 2..off + 4].try_into().ok()?);
                (0, 2)
            }
            UWOP_SAVE_NONVOL_FAR | UWOP_SAVE_XMM128_FAR => {
                if i + 2 >= count { return None; }
                (0, 3)
            }
            _ => (0, 1),
        };
        codes.push(UnwindCode { unwind_op, op_info, extra });
        i += advance;
    }

    // Chained UNWIND_INFO points at a RUNTIME_FUNCTION just after the codes
    // (aligned to next u32). For simplicity we read its unwind_info_rva.
    let mut has_chain = false;
    let mut chained_unwind_rva = 0u32;
    if (flags & UNW_FLAG_CHAININFO) != 0 {
        // RUNTIME_FUNCTION follows codes, padded to u32 alignment.
        let codes_end = codes_off + count * 2;
        let chain_off = (codes_end + 3) & !3;
        if chain_off + 12 <= pe_bytes.len() {
            let uir = u32::from_le_bytes(pe_bytes[chain_off + 8..chain_off + 12].try_into().ok()?);
            has_chain = true;
            chained_unwind_rva = uir;
        }
    }

    Some(UnwindInfo { has_chain, chained_unwind_rva, codes })
}

fn apply_unwind_codes(ui: &UnwindInfo, rsp: &mut u64) {
    for c in &ui.codes {
        match c.unwind_op {
            UWOP_PUSH_NONVOL => { *rsp = rsp.wrapping_add(8); }
            UWOP_ALLOC_SMALL => { *rsp = rsp.wrapping_add((c.op_info as u64 + 1) * 8); }
            UWOP_ALLOC_LARGE => { *rsp = rsp.wrapping_add(c.extra as u64); }
            UWOP_PUSH_MACHFRAME => {
                // PUSH_MACHFRAME pushes 5 or 6 u64 onto stack (40 or 48 bytes).
                let bytes = if c.op_info == 0 { 40 } else { 48 };
                *rsp = rsp.wrapping_add(bytes);
            }
            // SET_FPREG, SAVE_NONVOL, SAVE_XMM128: no RSP change.
            _ => {}
        }
    }
}

fn rva_to_file_offset(pe: &PE, rva: u32) -> Option<usize> {
    for s in &pe.sections {
        let vstart = s.virtual_address;
        let vend = vstart + s.virtual_size;
        if rva >= vstart && rva < vend {
            return Some((rva - vstart + s.pointer_to_raw_data) as usize);
        }
    }
    None
}

fn read_stack_u64(stack: &[u8], stack_base: u64, addr: u64) -> Option<u64> {
    if addr < stack_base { return None; }
    let off = (addr - stack_base) as usize;
    if off + 8 > stack.len() { return None; }
    Some(u64::from_le_bytes(stack[off..off + 8].try_into().ok()?))
}

fn strip_hex(s: &str) -> &str { s.trim_start_matches("0x").trim_start_matches("0X") }
fn hex(v: u64) -> String { format!("0x{:x}", v) }

fn je<E: std::fmt::Display>(e: E) -> JsError { JsError::new(&e.to_string()) }
fn js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(v).map_err(|e| JsError::new(&e.to_string()))
}
