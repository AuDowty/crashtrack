use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use crate::handler::Config;

/// `%LOCALAPPDATA%/<app>/crashtrack/pending`
pub fn pending_dir(app: &str) -> Option<PathBuf> {
    let mut p = dirs::data_local_dir()?;
    p.push(app);
    p.push("crashtrack");
    p.push("pending");
    Some(p)
}

/// Spawn a background thread that scans the pending dir and uploads anything
/// queued. Returns immediately. Failures are silent — a crash report isn't
/// load-bearing to the user's normal flow.
pub fn spawn(cfg: Config) {
    thread::spawn(move || {
        let Some(dir) = pending_dir(cfg.app) else {
            return;
        };
        if !dir.exists() {
            return;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("dmp") {
                continue;
            }
            match upload_one(&cfg, &path) {
                Ok(()) => {
                    let _ = fs::remove_file(&path);
                }
                Err(UploadErr::Permanent) => {
                    // 4xx — never going to work, drop it rather than retry forever.
                    let _ = fs::remove_file(&path);
                }
                Err(UploadErr::Transient) => {
                    // 5xx / network — keep on disk, try next launch.
                }
            }
            // Avoid hammering the server if there's a backlog.
            thread::sleep(Duration::from_millis(250));
        }
    });
}

enum UploadErr {
    Permanent,
    Transient,
}

fn upload_one(cfg: &Config, path: &Path) -> Result<(), UploadErr> {
    let bytes = fs::read(path).map_err(|_| UploadErr::Transient)?;

    let boundary = format!("----crashtrack-{}", uuid::Uuid::new_v4().simple());
    let body = build_multipart(&boundary, cfg.app, cfg.version, &bytes);
    let content_type = format!("multipart/form-data; boundary={boundary}");

    let url = format!("{}/api/v1/crashes", cfg.endpoint.trim_end_matches('/'));
    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", cfg.api_key))
        .set("Content-Type", &content_type)
        .send_bytes(&body);

    match resp {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(code, _)) if (400..500).contains(&code) => Err(UploadErr::Permanent),
        Err(_) => Err(UploadErr::Transient),
    }
}

fn build_multipart(boundary: &str, app: &str, version: &str, dump: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(dump.len() + 1024);

    let mut text_field = |name: &str, value: &str| {
        out.extend_from_slice(b"--");
        out.extend_from_slice(boundary.as_bytes());
        out.extend_from_slice(b"\r\nContent-Disposition: form-data; name=\"");
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(b"\"\r\n\r\n");
        out.extend_from_slice(value.as_bytes());
        out.extend_from_slice(b"\r\n");
    };
    text_field("app", app);
    text_field("version", version);

    out.extend_from_slice(b"--");
    out.extend_from_slice(boundary.as_bytes());
    out.extend_from_slice(b"\r\nContent-Disposition: form-data; name=\"dump\"; filename=\"crash.dmp\"\r\n");
    out.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    out.extend_from_slice(dump);
    out.extend_from_slice(b"\r\n--");
    out.extend_from_slice(boundary.as_bytes());
    out.extend_from_slice(b"--\r\n");
    out
}
