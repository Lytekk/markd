# Codebase Ground Truth — native filesystem wiring (Markd) [rev: a44ffe7]

> **Re-derived from source on 2026-07-30.** This document is a direct trace of
> revisions `7dcd0a6` and `a44ffe7` (startup/path-identity/restore
> classification), which supersede parts of the `65a4a35` hardening trace.
> Symbols are durable; line numbers are not.
>
> **Verification boundary:** renderer tests and the isolated `file_ops.rs`
> harness ran locally on Linux. A Linux Tauri compile still cannot run in this
> WSL environment (Cairo, GTK, Pango, GDK, Libsoup development libraries are
> absent), but the crate now compiles and tests on Windows outside `tauri build`:
> `cargo check --lib` and `cargo test --lib` both succeed there since
> `protocol-asset` was declared on the `tauri` dependency. Interactive desktop
> scope behavior — an actual OS double-click into a running build — still needs
> an end-to-end native UI run for direct proof.

## 1. Renderer-to-native authorization boundary [RE-DERIVED]

| Claim | Source-verified edge |
|---|---|
| Renderer code has no direct filesystem-plugin permission or JS dependency. | `src-tauri/capabilities/default.json` omits all `fs:*` permissions; `package.json`/`pnpm-lock.yaml` remove `@tauri-apps/plugin-fs`; `src/lib/file-system.ts` invokes custom commands only. |
| File and folder pickers are the normal grants. | `tauriOpenFile`, `tauriSaveFileAs`, and `tauriOpenDirectory` in `src/lib/file-system.ts` use dialog APIs; every selected path reaches Rust through `read_file`/`write_file`/`read_dir`. Folder selection requests `recursive: true`. |
| Every renderer-controlled path command passes one scope gate. | `read_file`, `write_file`, `read_dir`, `create_file`, `create_folder`, `rename_path`, `trash_path`, `path_exists`, and `watch_file` in `src-tauri/src/lib.rs` call `ensure_allowed_path`. |
| The scope gate blocks lexical new-child escapes through a symlinked parent. | `ensure_allowed_path` chooses `file_ops::canonical_existing_path` or `canonical_new_child_path`, then requires both submitted and canonical paths to match `app.fs_scope()`. `file_ops::reject_symlink_components` rejects non-absolute paths, parent traversal, and every existing symbolic-link component. |
| A failure to *inspect* a path is distinguished from a denial. | `path_inspection_error` maps `ErrorKind::InvalidInput` (the only policy refusal `file_ops` raises) to `MARKD_PATH_NOT_AUTHORIZED` and every other io kind to `MARKD_PATH_UNAVAILABLE`. `src/lib/file-system.ts` exposes `isPathAuthorizationError`/`isPathUnavailableError`; `src/lib/restore-failure.ts` turns those plus a `path_exists` probe into `unauthorized`/`missing`/`unavailable`. Only the first two close a restored tab. |
| The renderer receives one spelling per file. | `grant_file_access` canonicalizes for the grant, but `get_opened_file` and the single-instance emit hand back `file_ops::display_path` (dunce-simplified, plus `simplify_verbatim_unc`), which is the spelling a dialog produces. `src/lib/path-identity.ts` `samePath`/`normalizePathKey` back every remaining identity comparison (tab lookup, Recent Files dedup, write-queue key). |
| A launch argument cannot reach outside the directory it was issued from. | `file_ops::resolve_launch_path` keeps absolute arguments, anchors relative ones to the launching process's cwd (`get_file_path_from_args` uses this process's, the single-instance handler uses the forwarded `cwd`), and refuses parent traversal outright. |
| An unopenable launch file is reported, not swallowed. | `get_opened_file` returns `Result<Option<OpenedFile>, String>`; the startup effect in `App.tsx` surfaces an "Open Failed" dialog instead of the previous silent `.ok()?`. |
| Dialog and OS-file paths also grant the asset protocol, and both scopes persist. | `tauri-plugin-fs::init()` precedes `tauri_plugin_persisted_scope::init()` in `run`; Cargo enables its `protocol-asset` feature and now also declares it on `tauri` itself. `grant_file_access` gives CLI/single-instance files both `fs_scope` and `asset_protocol_scope` access after no-link canonicalization. |
| Pre-hardening localStorage paths never self-authorize. | `App.handleRecentFileSelect` detects `MARKD_PATH_NOT_AUTHORIZED` and routes the user through `openFile(defaultPath)`; hydration reports failed restores without claiming the file was deleted. `Sidebar` preserves unchecked recent entries. |

**Regression evidence:** `src/native-file-hardening-wiring.test.ts`,
`src/lib/file-system.test.ts`, and `src/components/Sidebar.test.tsx` all pass.

**Blind spots:** authorization is checked before filesystem use, so a hostile
local process can still race by replacing a directory after validation; fully
descriptor-relative no-follow operations need a separately designed cross-platform
primitive. No native WebView scope flow was exercised on this machine.

## 2. Durable-save and mutation seams [RE-DERIVED]

| Claim | Source-verified edge |
|---|---|
| Active Save, autosave, background Save All, Save As, and HTML export all route to `write_file`. | `use-file-state.ts` and `background-tab-save.ts` call `saveToFile`/`saveFileAs`; `file-system.ts` sends `write_file`; export uses the native save dialog then `write_file`. |
| A failed native save has no direct renderer fallback. | `tauriSaveFile` returns `false` on command failure; `writeTextFile` is absent from `file-system.ts`. |
| Writes use a randomized sibling temporary file and atomic replacement. | `file_ops::write_atomic` uses `tempfile::NamedTempFile::new_in`, preserves existing permissions, writes/syncs, and persists once. No direct-write fallback exists. The Unix parent-directory sync is best-effort: it runs *after* the rename has already published the new contents, so its failure is a durability warning and no longer fails the save. |
| A save reports what actually happened. | `src/lib/save-outcome.ts` `SaveOutcome` is `written`/`cancelled`/`superseded`/`failed`; `saveFileAs` returns `SaveAsResult` so a cancel is distinguishable from a failed write. `App.saveActiveTab` raises "Save Failed" only for `failed`, including for an untitled document. |
| Creation and rename cannot overwrite an existing target. | `file_ops::create_file` uses `OpenOptions::create_new(true)`; `create_folder` uses non-recursive `create_dir`; `rename_without_overwrite` uses `renamore::rename_exclusive`. |

**Regression evidence:** the `file_ops.rs` test module ran **18/18** through an
isolated Linux harness and **16/16** in the real crate on Windows
(`cargo test --manifest-path src-tauri/Cargo.toml --lib`) on 2026-07-30 —
the Unix-only symlink cases account for the difference. It covers predictable
temp-symlink protection, symlinked-tree exclusion, dangling-symlink creation
rejection, intermediate-parent rejection, collision rejection, rename
success/no-clobber behavior, `simplify_verbatim_unc`/`display_path` on both
extended-length forms, and `resolve_launch_path`. `.github/workflows/ci.yml`
now runs that Windows job on every push and PR; before this revision CI never
compiled Rust at all, so the whole module was dead code.

**Blind spots:** Windows reparse points (junctions) are still exercised only by
inspection — `reject_symlink_components` refuses them, which makes a junctioned
or symlinked document unopenable; that remains open. Filesystem-specific
`renamore` behavior still needs release-CI execution.

## 3. Directory, asset, and observer seams [RE-DERIVED]

| Claim | Source-verified edge |
|---|---|
| Tree recursion never exposes a symlink as a directory child. | `file_ops::read_directory` uses `DirEntry::file_type()` and skips `is_symlink()` before `tauriReadDir` recurses. |
| The asset protocol starts with no global filesystem grant. | `src-tauri/tauri.conf.json` has `assetProtocol.enable: true` and `scope: []`; dialog/OS grants add only authorized files or recursive folders, then persisted scope restores them. |
| An authorized document's folder can serve that document's images. | `allow_document_assets` grants the canonical parent directory recursively to `asset_protocol_scope()` only — never `fs_scope()` — and is reached solely from `grant_file_access` and from `read_file` *after* `ensure_allowed_path` has passed. Without it, emptying the global asset scope in `65a4a35` left every relative `![](./img/x.png)` broken for a document opened by double-click or File > Open. `../` escapes are still refused because Tauri's scope check canonicalizes before glob-matching. |
| Markdown cannot inject a raw local-protocol URL. | `resolveImageSrc` returns an empty source for `asset:`, `file:`, and `tauri:`; only relative paths are converted with `convertFileSrc`, after asset-scope checks. |
| The file watcher remains parent-directory based to survive atomic replacement. | `watch_file` validates its target, watches the parent non-recursively, and filters events by the original filename; `App.tsx` does content comparison and an authorized `path_exists` check. |

**Regression evidence:** `src/lib/resolved-image.test.ts` rejects raw local
protocols; `src/native-file-hardening-wiring.test.ts` asserts empty global asset
scope, asset-scope persistence wiring, and that `allow_document_assets` touches
only the asset scope and only after `ensure_allowed_path`. That guard file's
`functionBody()` extractor now skips strings and comments when counting braces —
before, a truncated body made its `.not.toContain` assertions pass vacuously.

**Blind spots:** `csp` is still `null` in `tauri.conf.json`, which is what makes
the widened asset scope worth revisiting: a hostile document plus any injection
has unrestricted network access. Adding a policy needs a native run to confirm
mermaid, KaTeX and the updater survive it.

**Maintenance:** Re-derive an affected section from source before altering it;
replace falsified claims rather than appending around them. Re-run the named
tests after every filesystem-boundary change, and do not call the native desktop
flow verified until it runs on a machine with its Tauri system dependencies.
