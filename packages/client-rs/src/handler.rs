use std::fmt;
use std::path::PathBuf;
use std::sync::OnceLock;

use windows::Win32::Foundation::{HANDLE, NTSTATUS};
use windows::Win32::System::Diagnostics::Debug::{
    MiniDumpWithFullMemoryInfo, MiniDumpWithThreadInfo, MiniDumpWithUnloadedModules,
    MiniDumpWriteDump, MINIDUMP_EXCEPTION_INFORMATION, MINIDUMP_TYPE,
    RtlCaptureContext, SetUnhandledExceptionFilter, CONTEXT, EXCEPTION_POINTERS,
    EXCEPTION_RECORD,
};
use windows::Win32::System::Threading::{GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId};

use crate::uploader::pending_dir;

#[derive(Clone, Debug)]
pub struct Config {
    pub api_key:  &'static str,
    pub app:      &'static str,
    pub version:  &'static str,
    pub endpoint: &'static str,
}

#[derive(Debug)]
pub enum Error {
    AlreadyInstalled,
    NoAppData,
    Io(std::io::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyInstalled => write!(f, "install called more than once"),
            Self::NoAppData => write!(f, "could not resolve LOCALAPPDATA"),
            Self::Io(e) => write!(f, "io error: {e}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

static CONFIG: OnceLock<Config> = OnceLock::new();

pub fn install(cfg: Config) -> Result<(), Error> {
    CONFIG.set(cfg).map_err(|_| Error::AlreadyInstalled)?;
    let cfg = CONFIG.get().expect("just set");

    let dir = pending_dir(cfg.app).ok_or(Error::NoAppData)?;
    std::fs::create_dir_all(&dir)?;

    // SAFETY: SetUnhandledExceptionFilter is documented as the supported way
    // to register a top-level exception handler. We pass a real function ptr.
    unsafe { SetUnhandledExceptionFilter(Some(top_level_filter)) };

    install_panic_hook();
    Ok(())
}

// Rust panics (incl. divide-by-zero, abort, unwrap-on-None) bypass
// SetUnhandledExceptionFilter via __fastfail. A panic hook is the only way
// to catch them — we write a minidump from inside the hook, then chain to
// the previous hook (which prints the message and aborts).
fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(cfg) = CONFIG.get() {
            let _ = write_panic_dump(cfg);
        }
        prev(info);
    }));
}

// Synthesize an EXCEPTION_POINTERS with the current CPU context and a
// distinctive code (STATUS_ASSERTION_FAILURE) so the server-side parser
// can populate ExceptionStream like a real crash.
fn write_panic_dump(cfg: &Config) -> Result<PathBuf, Error> {
    const STATUS_ASSERTION_FAILURE: u32 = 0xC015000F;

    let dir = pending_dir(cfg.app).ok_or(Error::NoAppData)?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.dmp", uuid::Uuid::new_v4()));

    let file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)?;
    let file_handle = handle_from_file(&file);

    let mut context: CONTEXT = unsafe { std::mem::zeroed() };
    unsafe { RtlCaptureContext(&mut context as *mut _) };

    let mut record = EXCEPTION_RECORD {
        ExceptionCode: NTSTATUS(STATUS_ASSERTION_FAILURE as i32),
        ExceptionFlags: 1, // EXCEPTION_NONCONTINUABLE
        ExceptionRecord: std::ptr::null_mut(),
        ExceptionAddress: context.Rip as *mut _,
        NumberParameters: 0,
        ExceptionInformation: [0; 15],
    };
    let mut pointers = EXCEPTION_POINTERS {
        ExceptionRecord: &mut record,
        ContextRecord: &mut context,
    };
    let mut ex_info = MINIDUMP_EXCEPTION_INFORMATION {
        ThreadId:          unsafe { GetCurrentThreadId() },
        ExceptionPointers: &mut pointers,
        ClientPointers:    false.into(),
    };

    let flags = MINIDUMP_TYPE(
        MiniDumpWithThreadInfo.0
            | MiniDumpWithUnloadedModules.0
            | MiniDumpWithFullMemoryInfo.0,
    );

    let result = unsafe {
        MiniDumpWriteDump(
            GetCurrentProcess(),
            GetCurrentProcessId(),
            file_handle,
            flags,
            Some(&mut ex_info as *mut _),
            None,
            None,
        )
    };
    if result.is_err() {
        let _ = std::fs::remove_file(&path);
        return Err(Error::Io(std::io::Error::last_os_error()));
    }
    Ok(path)
}

unsafe extern "system" fn top_level_filter(info: *const EXCEPTION_POINTERS) -> i32 {
    // Constant from Win32 — EXCEPTION_CONTINUE_SEARCH = 0 (let default handler run after us,
    // so the process still terminates and Windows Error Reporting can also see it).
    const EXCEPTION_CONTINUE_SEARCH: i32 = 0;

    if let Some(cfg) = CONFIG.get() {
        let _ = write_dump(cfg, info);
    }
    EXCEPTION_CONTINUE_SEARCH
}

fn write_dump(cfg: &Config, info: *const EXCEPTION_POINTERS) -> Result<PathBuf, Error> {
    let dir = pending_dir(cfg.app).ok_or(Error::NoAppData)?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.dmp", uuid::Uuid::new_v4()));

    let file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)?;

    let file_handle = handle_from_file(&file);
    let mut ex_info = MINIDUMP_EXCEPTION_INFORMATION {
        ThreadId:          unsafe { GetCurrentThreadId() },
        ExceptionPointers: info as *mut _,
        ClientPointers:    false.into(),
    };

    let flags = MINIDUMP_TYPE(
        MiniDumpWithThreadInfo.0
            | MiniDumpWithUnloadedModules.0
            | MiniDumpWithFullMemoryInfo.0,
    );

    let result = unsafe {
        MiniDumpWriteDump(
            GetCurrentProcess(),
            GetCurrentProcessId(),
            file_handle,
            flags,
            Some(&mut ex_info as *mut _),
            None,
            None,
        )
    };

    if result.is_err() {
        let _ = std::fs::remove_file(&path);
        return Err(Error::Io(std::io::Error::last_os_error()));
    }
    Ok(path)
}

#[cfg(windows)]
fn handle_from_file(file: &std::fs::File) -> HANDLE {
    use std::os::windows::io::AsRawHandle;
    HANDLE(file.as_raw_handle() as *mut core::ffi::c_void)
}
