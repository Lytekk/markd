use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

mod file_ops;

const PATH_AUTHORIZATION_ERROR_CODE: &str = "MARKD_PATH_NOT_AUTHORIZED";

#[derive(Serialize, Clone)]
struct OpenedFile {
    path: String,
    name: String,
    content: String,
}

fn get_file_path_from_args() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    let file_path = args.iter().skip(1).find(|arg| !arg.starts_with('-'))?;
    let path = PathBuf::from(file_path);
    if path.is_absolute() {
        Some(path)
    } else if path
        .components()
        .all(|component| !matches!(component, std::path::Component::ParentDir))
    {
        std::env::current_dir().ok().map(|cwd| cwd.join(path))
    } else {
        None
    }
}

fn path_authorization_error() -> String {
    format!(
        "{PATH_AUTHORIZATION_ERROR_CODE}: This path is not authorized. Open the file or folder through Markd first."
    )
}

/// Grant both command and asset-protocol scopes for a user-mediated OS file
/// event. Dialogs grant both scopes themselves; CLI and single-instance events
/// reach this helper directly.
fn grant_file_access(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    let canonical_path =
        file_ops::canonical_existing_path(path).map_err(|_| path_authorization_error())?;
    app.fs_scope()
        .allow_file(&canonical_path)
        .map_err(|_| path_authorization_error())?;
    app.asset_protocol_scope()
        .allow_file(&canonical_path)
        .map_err(|_| path_authorization_error())?;
    Ok(canonical_path)
}

fn get_opened_file_from_args(app: &tauri::AppHandle) -> Option<OpenedFile> {
    let file_path = get_file_path_from_args()?;
    let file_path = grant_file_access(app, &file_path).ok()?;

    let content = std::fs::read_to_string(&file_path).ok()?;
    let name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled.md")
        .to_string();

    Some(OpenedFile {
        path: file_path.to_string_lossy().to_string(),
        name,
        content,
    })
}

#[tauri::command]
fn get_opened_file(app: tauri::AppHandle) -> Option<OpenedFile> {
    get_opened_file_from_args(&app)
}

/// Custom commands execute in Rust, beyond Tauri's guest-side ACL enforcement.
/// Reuse the dialog-managed fs scope here so an IPC caller cannot turn an
/// arbitrary string into filesystem authority. Dialog selections and OS-open
/// events are the only grant sources; persisted-scope restores those grants.
fn ensure_allowed_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let canonical_path = match std::fs::symlink_metadata(path) {
        Ok(_) => file_ops::canonical_existing_path(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            file_ops::canonical_new_child_path(path)
        }
        Err(_) => return Err(path_authorization_error()),
    }
    .map_err(|_| path_authorization_error())?;

    // The submitted path must match the user grant, and its canonical parent
    // must still match after symlink resolution. Both checks are needed for a
    // new path because Tauri leaves a missing leaf lexical during scope checks.
    if app.fs_scope().is_allowed(path) && app.fs_scope().is_allowed(&canonical_path) {
        Ok(())
    } else {
        Err(path_authorization_error())
    }
}

fn io_error(action: &str, error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::AlreadyExists => {
            "A file or folder with that name already exists.".to_string()
        }
        std::io::ErrorKind::PermissionDenied => {
            format!("Markd does not have permission to {action}.")
        }
        _ => format!("Unable to {action}."),
    }
}

#[tauri::command]
fn read_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = Path::new(&path);
    ensure_allowed_path(&app, path)?;
    std::fs::read_to_string(path).map_err(|e| io_error("read this file", &e))
}

#[tauri::command]
fn write_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let path = Path::new(&path);
    ensure_allowed_path(&app, path)?;
    file_ops::write_atomic(path, content.as_bytes()).map_err(|e| {
        io_error(
            "save this file; its previous contents were left unchanged",
            &e,
        )
    })
}

#[derive(Serialize, Clone)]
struct DirEntry {
    name: String,
    path: String,
    is_directory: bool,
}

#[tauri::command]
fn read_dir(app: tauri::AppHandle, path: String) -> Result<Vec<DirEntry>, String> {
    let path = Path::new(&path);
    ensure_allowed_path(&app, path)?;
    file_ops::read_directory(path)
        .map(|entries| {
            entries
                .into_iter()
                .map(|entry| DirEntry {
                    name: entry.name,
                    path: entry.path.to_string_lossy().to_string(),
                    is_directory: entry.is_directory,
                })
                .collect()
        })
        .map_err(|e| io_error("read this folder", &e))
}

/// Create one empty file in an already-authorized directory. create_new makes
/// collision handling atomic and refuses symlink/dangling-symlink destinations.
#[tauri::command]
fn create_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    ensure_allowed_path(&app, path)?;
    file_ops::create_file(path).map_err(|e| io_error("create this file", &e))
}

/// Create one directory in an already-authorized parent. Recursive creation is
/// intentionally forbidden so an IPC caller cannot manufacture path hierarchy.
#[tauri::command]
fn create_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    ensure_allowed_path(&app, path)?;
    file_ops::create_folder(path).map_err(|e| io_error("create this folder", &e))
}

/// Rename without overwriting. renamore calls the platform's atomic no-replace
/// primitive and fails rather than falling back to check-then-rename.
#[tauri::command]
fn rename_path(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    let from = Path::new(&from);
    let to = Path::new(&to);
    ensure_allowed_path(&app, from)?;
    ensure_allowed_path(&app, to)?;
    file_ops::rename_without_overwrite(from, to)
        .map_err(|e| io_error("rename this file or folder", &e))
}

/// Move a path to the OS recycle bin/trash (recoverable), not a permanent
/// delete. Uses the `trash` crate, which is cross-platform.
#[tauri::command]
fn trash_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    ensure_allowed_path(&app, path)?;
    trash::delete(path).map_err(|_| "Unable to move this item to the recycle bin.".to_string())
}

/// True if an authorized path currently exists on disk. This distinguishes a real
/// deletion from a transient read failure without granting arbitrary path probes.
#[tauri::command]
fn path_exists(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    let path = Path::new(&path);
    ensure_allowed_path(&app, path)?;
    Ok(path.exists())
}

/// Holds the active file's OS filesystem watcher. Watching the file's PARENT
/// directory (non-recursive) survives atomic saves (write-temp + rename) that a
/// direct file watch would lose when the original inode is replaced. The callback
/// emits `file-changed-on-disk`; the frontend then content-compares and prompts.
/// Uses the `notify` crate (ReadDirectoryChangesW on Windows). The watched path
/// is still checked against the dialog-managed scope before native access begins.
#[derive(Default)]
struct FileWatchState(Mutex<Option<RecommendedWatcher>>);

#[tauri::command]
fn watch_file(
    app: tauri::AppHandle,
    state: State<'_, FileWatchState>,
    path: String,
) -> Result<(), String> {
    let watch_path = std::path::PathBuf::from(&path);
    ensure_allowed_path(&app, &watch_path)?;
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
                    if let Ok(path) = grant_file_access(app, path) {
                        let _ = app.emit("open-file-in-tab", path.to_string_lossy().to_string());
                    }
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
        .plugin(tauri_plugin_persisted_scope::init())
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
