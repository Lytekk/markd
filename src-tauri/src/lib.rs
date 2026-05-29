use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Serialize, Clone)]
struct OpenedFile {
    path: String,
    name: String,
    content: String,
}

fn get_file_from_args() -> Option<OpenedFile> {
    let args: Vec<String> = std::env::args().collect();
    let file_path = args.iter().skip(1).find(|arg| !arg.starts_with('-'))?;

    let content = std::fs::read_to_string(file_path).ok()?;
    let name = std::path::Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled.md")
        .to_string();

    Some(OpenedFile {
        path: file_path.clone(),
        name,
        content,
    })
}

#[tauri::command]
fn get_opened_file() -> Option<OpenedFile> {
    get_file_from_args()
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write `bytes` to `target` atomically: write a sibling temp file, fsync it,
/// then rename it over the target. Rename is atomic within a volume, so a crash,
/// power loss, or disk-full mid-write can never leave a truncated/empty document.
/// Cross-volume targets (UNC / \\wsl.localhost mounts) return a rename error, in
/// which case we fall back to a direct write (non-atomic but functional).
fn write_atomic(target: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled");
    let tmp = dir.join(format!(".{file_name}.markd-tmp"));

    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }

    match std::fs::rename(&tmp, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            // EXDEV (cross-volume) or other rename failure — fall back to a
            // direct write, then best-effort clean up the temp file.
            let res = std::fs::write(target, bytes);
            let _ = std::fs::remove_file(&tmp);
            res
        }
    }
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    write_atomic(std::path::Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
struct DirEntry {
    name: String,
    path: String,
    is_directory: bool,
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    let read = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    for item in read {
        let item = item.map_err(|e| e.to_string())?;
        let meta = item.metadata().map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        entries.push(DirEntry {
            name,
            path: item.path().to_string_lossy().to_string(),
            is_directory: meta.is_dir(),
        });
    }
    Ok(entries)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(file_path) = args.iter().skip(1).find(|a| !a.starts_with('-')) {
                let path = std::path::Path::new(file_path);
                let valid_ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| matches!(e, "md" | "markdown" | "mdx" | "txt"))
                    .unwrap_or(false);
                if valid_ext && path.is_file() {
                    let _ = app.emit("open-file-in-tab", file_path.clone());
                }
            }
            // Focus the existing window.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_opened_file, read_file, write_file, read_dir])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Window starts hidden (tauri.conf.json visible:false) so the
            // window-state plugin can restore size before the user sees it.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
