use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

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

/// Create an empty file. Fails if it already exists (never clobber), creating
/// any missing parent directories. Like read_file/write_file this uses std::fs
/// directly and so bypasses the fs-plugin ACL — no capability entry needed.
#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err("A file with that name already exists".to_string());
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, "").map_err(|e| e.to_string())
}

/// Create a directory (and any missing parents). Fails if it already exists.
#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err("A folder with that name already exists".to_string());
    }
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Rename/move a path. Fails if the destination already exists so a rename can
/// never silently overwrite another file.
#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    if std::path::Path::new(&to).exists() {
        return Err("A file or folder with that name already exists".to_string());
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Move a path to the OS recycle bin/trash (recoverable), not a permanent
/// delete. Uses the `trash` crate, which is cross-platform.
#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// True if `path` currently exists on disk. A definitive existence check (not a
/// content read) so the frontend can tell a real external deletion apart from a
/// transient read failure mid atomic-save, and flag stale Recent Files. Bypasses
/// the fs ACL like the other custom commands → no capability needed.
#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Holds the active file's OS filesystem watcher. Watching the file's PARENT
/// directory (non-recursive) survives atomic saves (write-temp + rename) that a
/// direct file watch would lose when the original inode is replaced. The callback
/// emits `file-changed-on-disk`; the frontend then content-compares and prompts.
/// Uses the `notify` crate (ReadDirectoryChangesW on Windows) — like
/// read_file/write_file it bypasses the fs-plugin ACL, so no capability is needed.
#[derive(Default)]
struct FileWatchState(Mutex<Option<RecommendedWatcher>>);

#[tauri::command]
fn watch_file(
    app: tauri::AppHandle,
    state: State<'_, FileWatchState>,
    path: String,
) -> Result<(), String> {
    let watch_path = std::path::PathBuf::from(&path);
    let target_name = watch_path.file_name().map(|n| n.to_os_string());
    let parent = watch_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let app_handle = app.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            if !matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            ) {
                return;
            }
            // The dir watch also reports siblings — only react to the target file.
            if event
                .paths
                .iter()
                .any(|p| p.file_name().map(|n| n.to_os_string()) == target_name)
            {
                let _ = app_handle.emit("file-changed-on-disk", ());
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    // Replacing the stored watcher drops (and stops) any previous one.
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

#[tauri::command]
fn unwatch_file(state: State<'_, FileWatchState>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(FileWatchState::default())
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_opened_file,
            read_file,
            write_file,
            read_dir,
            create_file,
            create_folder,
            rename_path,
            trash_path,
            path_exists,
            watch_file,
            unwatch_file
        ])
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
