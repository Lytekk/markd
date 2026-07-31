use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

mod file_ops;

const PATH_AUTHORIZATION_ERROR_CODE: &str = "MARKD_PATH_NOT_AUTHORIZED";
const PATH_UNAVAILABLE_ERROR_CODE: &str = "MARKD_PATH_UNAVAILABLE";

#[derive(Serialize, Clone)]
struct OpenedFile {
    path: String,
    name: String,
    content: String,
}

fn launch_file_argument(args: &[String]) -> Option<&String> {
    args.iter().skip(1).find(|arg| !arg.starts_with('-'))
}

fn get_file_path_from_args() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    let file_path = launch_file_argument(&args)?;
    let cwd = std::env::current_dir().ok()?;
    file_ops::resolve_launch_path(file_path, &cwd)
}

fn path_authorization_error() -> String {
    format!(
        "{PATH_AUTHORIZATION_ERROR_CODE}: This path is not authorized. Open the file or folder through Markd first."
    )
}

fn path_unavailable_error() -> String {
    format!(
        "{PATH_UNAVAILABLE_ERROR_CODE}: This path could not be reached right now. The drive or share may be offline."
    )
}

/// Map a failure to *inspect* a path onto the two codes the renderer acts on.
///
/// `InvalidInput` is how `file_ops` refuses a path on policy grounds — a symlink
/// component, parent traversal, a relative path. Everything else is an I/O
/// condition (offline share, sleeping VM filesystem, device error, missing
/// parent) that a later attempt can clear, so it must not be reported as a
/// revoked authorization: the renderer would tell the user to re-authorize a
/// grant that is still perfectly intact, and discard their tab.
fn path_inspection_error(error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::InvalidInput => path_authorization_error(),
        _ => path_unavailable_error(),
    }
}

/// Let the asset protocol serve the folder of a document the user has already
/// opened, so the document's relative images render.
///
/// A markdown image is written relative to its document (`./img/plot.png`), so
/// the document's folder — not the document file — is what has to be servable.
/// v0.4.4 dropped the blanket `assetProtocol.scope: ["**"]` and granted only the
/// opened `.md` file, which silently broke every relative image in a document
/// opened by double-click or File > Open. This restores those images without
/// restoring ambient authority: the grant is read-only display scope, it is
/// bounded to one folder, and it is only ever taken for a path that already
/// passed the filesystem authorization gate. Paths that climb out with `..` are
/// still refused, because the scope check canonicalizes before matching.
fn allow_document_assets(app: &tauri::AppHandle, canonical_path: &Path) {
    let Some(parent) = canonical_path.parent() else {
        return;
    };
    // Re-granting a folder we already serve is not free: every grant fires a
    // scope event, and tauri-plugin-persisted-scope rewrites its whole state
    // file on each one. Without this check, opening files from one folder
    // rewrote that file once per open and grew it forever — and the plugin
    // re-canonicalizes every stored entry at the NEXT startup, before the window
    // exists.
    //
    // The check is not free either — Scope::is_allowed canonicalizes its
    // argument — but it is one canonicalize against a grant plus a whole-file
    // rewrite, and it is bounded, whereas the growth it prevents is not.
    if app.asset_protocol_scope().is_allowed(parent) {
        return;
    }
    let _ = app.asset_protocol_scope().allow_directory(parent, true);
}

/// Grant both command and asset-protocol scopes for a user-mediated OS file
/// event. Dialogs grant both scopes themselves; CLI and single-instance events
/// reach this helper directly.
fn grant_file_access(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    let canonical_path =
        file_ops::canonical_existing_path(path).map_err(|e| path_inspection_error(&e))?;
    app.fs_scope()
        .allow_file(&canonical_path)
        .map_err(|_| path_authorization_error())?;
    app.asset_protocol_scope()
        .allow_file(&canonical_path)
        .map_err(|_| path_authorization_error())?;
    allow_document_assets(app, &canonical_path);
    Ok(canonical_path)
}

fn get_opened_file_from_args(app: &tauri::AppHandle) -> Result<Option<OpenedFile>, String> {
    let Some(file_path) = get_file_path_from_args() else {
        return Ok(None);
    };
    let canonical_path = grant_file_access(app, &file_path)?;

    let content = std::fs::read_to_string(&canonical_path)
        .map_err(|e| io_error("read this file", &e))?;
    let name = canonical_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled.md")
        .to_string();

    Ok(Some(OpenedFile {
        // The renderer keys tabs, Recent Files and the file watcher off this
        // string, so hand it the same spelling a file dialog would produce.
        path: file_ops::display_path(&canonical_path)
            .to_string_lossy()
            .to_string(),
        name,
        content,
    }))
}

/// Content of the file the OS launched Markd with, if any.
///
/// Returns an error rather than `None` when a file WAS named but could not be
/// opened. Swallowing that with `.ok()?` meant double-clicking an unreadable or
/// unauthorized document did nothing at all — no window content, no message, no
/// way for the user to tell Markd had even seen the file.
#[tauri::command]
fn get_opened_file(
    app: tauri::AppHandle,
    state: State<'_, PendingOpens>,
) -> Result<Option<OpenedFile>, String> {
    match state.0.lock() {
        Ok(mut pending) => {
            if pending.launch_file_taken {
                return Ok(None);
            }
            pending.launch_file_taken = true;
        }
        // Poisoned lock: answering once more beats never opening the file.
        Err(_) => {}
    }
    get_opened_file_from_args(&app)
}

/// Custom commands execute in Rust, beyond Tauri's guest-side ACL enforcement.
/// Reuse the dialog-managed fs scope here so an IPC caller cannot turn an
/// arbitrary string into filesystem authority. Dialog selections and OS-open
/// events are the only grant sources; persisted-scope restores those grants.
/// Returns the canonical path so callers that need it do not have to walk and
/// canonicalize a second time — on a network share every component stat is a
/// round trip, so re-deriving it doubled the cost of opening a file.
fn ensure_allowed_path(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    let mut path_exists_for_scope = false;
    let canonical_path = match std::fs::symlink_metadata(path) {
        Ok(_) => {
            path_exists_for_scope = true;
            file_ops::canonical_existing_path(path)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            file_ops::canonical_new_child_path(path)
        }
        Err(error) => return Err(path_inspection_error(&error)),
    }
    .map_err(|error| path_inspection_error(&error))?;

    // The submitted path must match the user grant, and its canonical form must
    // still match after symlink resolution.
    //
    // For a path that EXISTS these are the same question: Tauri's is_allowed
    // canonicalizes its argument first, so is_allowed(path) resolves to exactly
    // canonical_path and the second call repeats the first — including its
    // canonicalize, which on a network share is another round trip per
    // component. Ask once. For a path whose leaf does NOT exist, is_allowed
    // cannot canonicalize and falls back to a lexical match, so both forms
    // genuinely have to be checked.
    let allowed = if path_exists_for_scope {
        app.fs_scope().is_allowed(&canonical_path)
    } else {
        app.fs_scope().is_allowed(path) && app.fs_scope().is_allowed(&canonical_path)
    };
    if allowed {
        Ok(canonical_path)
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
    let canonical_path = ensure_allowed_path(&app, path)?;
    let content = std::fs::read_to_string(path).map_err(|e| io_error("read this file", &e))?;
    // Every document open the renderer performs — dialog, Recent Files, file
    // tree, session restore — arrives here, so this is the one place that has to
    // make the document's images loadable. Reuse the canonical path the
    // authorization gate already produced rather than deriving it again.
    allow_document_assets(&app, &canonical_path);
    Ok(content)
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
///
/// A path whose PARENT is gone cannot be canonicalized, so the authorization gate
/// can only report "could not inspect". Answering `false` for that case is both
/// true and necessary: without it the renderer cannot tell a deleted folder from
/// an offline drive, and keeps a tab alive forever for a file that will never
/// come back. The grant is still required — the fallback only applies once the
/// scope has already accepted the path's nearest existing ancestor.
#[tauri::command]
fn path_exists(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    let path = Path::new(&path);
    match ensure_allowed_path(&app, path) {
        Ok(_) => Ok(path.exists()),
        Err(error) if error.starts_with(PATH_UNAVAILABLE_ERROR_CODE) => {
            if nearest_existing_ancestor_is_allowed(&app, path) {
                Ok(false)
            } else {
                Err(error)
            }
        }
        Err(error) => Err(error),
    }
}

/// True when some existing ancestor of `path` is inside the user's grant.
///
/// Used only to answer an existence probe for a path whose parent has been
/// removed. Walking up stops at the first ancestor that exists, so this never
/// reaches past the tree the user actually authorized.
fn nearest_existing_ancestor_is_allowed(app: &tauri::AppHandle, path: &Path) -> bool {
    let mut ancestors = path.ancestors().skip(1);
    for ancestor in ancestors.by_ref() {
        if ancestor.as_os_str().is_empty() {
            break;
        }
        match std::fs::symlink_metadata(ancestor) {
            Ok(_) => {
                return file_ops::canonical_existing_path(ancestor)
                    .map(|canonical| app.fs_scope().is_allowed(&canonical))
                    .unwrap_or(false);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return false,
        }
    }
    false
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

/// Paths a second launch handed us before the renderer was listening.
///
/// `Manager::emit` only reaches webviews that already registered a JS listener
/// for that event, and it never replays. The renderer's listener is registered
/// from an effect that first awaits a dynamic import, so anything forwarded
/// during startup was dropped on the floor — which is exactly what selecting
/// several documents in Explorer and pressing Enter produces, since that starts
/// one instance and forwards the rest into it immediately.
#[derive(Default)]
struct PendingOpensState {
    queue: Vec<String>,
    renderer_ready: bool,
    /// The launch argument is consumed once per process. `std::env::args()` never
    /// changes, so re-reading it on a webview reload re-opened (and, once the
    /// command started reporting errors, re-alerted about) the same file.
    launch_file_taken: bool,
}

#[derive(Default)]
struct PendingOpens(Mutex<PendingOpensState>);

/// Drain the queue and mark the renderer live.
///
/// The renderer calls this once, immediately after its `open-file-in-tab`
/// listener is registered. `renderer_ready` lives inside the same mutex as the
/// queue so the forwarder's "is anyone listening?" check and its push are atomic
/// against this drain — otherwise a path could be queued just after a drain and
/// then sit there until the next launch, or be delivered twice.
#[tauri::command]
fn take_pending_opens(state: State<'_, PendingOpens>) -> Vec<String> {
    match state.0.lock() {
        Ok(mut pending) => {
            pending.renderer_ready = true;
            std::mem::take(&mut pending.queue)
        }
        Err(_) => Vec::new(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(FileWatchState::default())
        .manage(PendingOpens::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // A second launch can forward a relative argument, so resolve it
            // against the *launching* process's directory, not this one's.
            if let Some(path) = launch_file_argument(&args)
                .and_then(|arg| file_ops::resolve_launch_path(arg, std::path::Path::new(&cwd)))
            {
                let valid_ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| matches!(e, "md" | "markdown" | "mdx" | "txt"))
                    .unwrap_or(false);
                if valid_ext && path.is_file() {
                    if let Ok(canonical_path) = grant_file_access(app, &path) {
                        // Same spelling the dialog produces, so an already-open
                        // tab is recognised instead of duplicated.
                        let display = file_ops::display_path(&canonical_path)
                            .to_string_lossy()
                            .to_string();
                        // Exactly one delivery route. A live renderer gets the
                        // event; one that is still booting would never see it,
                        // so the path waits in the queue it drains on startup.
                        let renderer_ready = match app.state::<PendingOpens>().0.lock() {
                            Ok(mut pending) => {
                                if !pending.renderer_ready {
                                    pending.queue.push(display.clone());
                                }
                                pending.renderer_ready
                            }
                            // Poisoned lock: fall back to emitting rather than
                            // dropping the user's file.
                            Err(_) => true,
                        };
                        if renderer_ready {
                            let _ = app.emit("open-file-in-tab", display);
                        }
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
            unwatch_file,
            take_pending_opens
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
