# Codebase Ground Truth — native filesystem wiring (Markd) [rev: 6a38adf]

> **Re-derived from source on 2026-07-31.** A direct trace of the shipped tree at
> `6a38adf` (v0.4.7), covering the `7dcd0a6`/`a44ffe7` restore-classification work
> and the `a30ed63`..`a891c2f` startup and performance pass. Supersedes the
> `65a4a35` hardening trace where they disagree. Symbols are durable; line
> numbers are not.
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
| The scope is asked once for a path that exists. | `ensure_allowed_path` sets `path_exists_for_scope` on the `symlink_metadata` Ok arm and then checks only `is_allowed(&canonical_path)`. Tauri's `Scope::is_allowed` canonicalizes its own argument, so for an existing path both spellings resolve to the same query; a MISSING leaf cannot be canonicalized and still has both forms checked. It returns the canonical `PathBuf` so callers do not re-derive it — `read_file` used to walk and canonicalize the whole path a second time for the asset grant. |
| A launch file is delivered exactly once, by exactly one route. | `PendingOpensState` holds the queue and `renderer_ready` under ONE mutex, so the single-instance forwarder's "is anyone listening?" check and its push are atomic against `take_pending_opens`. A live renderer gets the emit; one still booting finds the path queued. `get_opened_file` sets `launch_file_taken` so a webview reload cannot re-open (or re-alert about) the same argv. |
| A launch argument cannot reach outside the directory it was issued from. | `file_ops::resolve_launch_path` keeps absolute arguments, anchors relative ones to the launching process's cwd (`get_file_path_from_args` uses this process's, the single-instance handler uses the forwarded `cwd`), and refuses parent traversal outright. |
| An unopenable launch file is reported, not swallowed. | `get_opened_file` returns `Result<Option<OpenedFile>, String>`; the startup effect in `App.tsx` surfaces an "Open Failed" dialog instead of the previous silent `.ok()?`. |
| Dialog and OS-file paths also grant the asset protocol, and both scopes persist. | `tauri-plugin-fs::init()` precedes `tauri_plugin_persisted_scope::init()` in `run`; Cargo enables its `protocol-asset` feature and now also declares it on `tauri` itself. `grant_file_access` gives CLI/single-instance files both `fs_scope` and `asset_protocol_scope` access after no-link canonicalization. |
| An existence probe can answer for a path whose parent is gone. | `path_exists` treats a `MARKD_PATH_UNAVAILABLE` inspection failure as `false` ONLY when `nearest_existing_ancestor_is_allowed` finds an existing ancestor inside the grant. Without that, a deleted folder was indistinguishable from an offline drive and its tabs were kept forever. |
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
| An authorized document's folder can serve that document's images. | `allow_document_assets` grants the canonical parent directory recursively to `asset_protocol_scope()` only — never `fs_scope()` — and is reached solely from `grant_file_access` and from `read_file` *after* `ensure_allowed_path` has passed. It returns early when the folder is already in the asset scope: every grant fires a scope event and `tauri-plugin-persisted-scope` rewrites its whole state file per event, which the NEXT launch re-canonicalizes entry by entry before the window exists. Without it, emptying the global asset scope in `65a4a35` left every relative `![](./img/x.png)` broken for a document opened by double-click or File > Open. `../` escapes are still refused because Tauri's scope check canonicalizes before glob-matching. |
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

## 4. Tab state and startup ordering [RE-DERIVED]

These are not filesystem edges, but every one of them decides which bytes reach
which path, so they belong with the rest of the wiring.

| Claim | Source-verified edge |
|---|---|
| State read after an `await` comes from a live accessor, never the captured hook object. | `useFileTabs` returns a plain object literal: `tabs` and `activeTabId` on it are `useState` VALUES frozen into the render an effect fired in, while every function member is ref-backed. `getTabsSnapshot()` and `getActiveTabId()` expose `tabsRef.current` / `activeTabIdRef.current`. The startup effect, `saveAllDirtyTabs`, the reload-all handler and the single-instance `openPath` all read through them. Reading the frozen fields instead made the session restore load a DIFFERENT document over the launch file and left `fileState` pointing at it, and made `saveAllDirtyTabs` write a stale `tab.content`. |
| A tab that names a file it has never read is never treated as authoritative. | `FileTab.isHydrated` is false for tabs from `loadPersistedTabs` and for `reopenLastClosed`'s named sentinel; only `hydrateTab`/`openInTab` set it true. `snapshotActiveTab` returns early for an unhydrated tab rather than writing the live editor buffer into it, and `restoreTabIntoEditor` reads a tab from disk before binding it to the editor. `content === ""` cannot carry this: a document the user emptied on purpose is indistinguishable from one that was never loaded. |
| The OS-handed document is opened before the session is restored. | The startup effect invokes `get_opened_file` first, then reads `activeId`/`needsHydration` from the live accessors — so a launch file that claimed the editor is already hydrated, drops out of `needsHydration`, and the active-tab branch (with its failure-recovery paths, each of which pushes a document into the editor) is skipped. `openInTab`'s matched-existing branch activates a tab without writing content, so the launch bytes are handed to it explicitly. The failed-open dialog is reported last. |
| The window never paints white. | `tauri.conf.json` sets the window `backgroundColor` to `#1e1e2e` (Tauri applies it to the window AND the webview) and keeps `visible: false` for geometry restore; `index.html` sets `data-theme="night"` unconditionally before first paint and records the real target in `data-boot-theme`; `use-theme` applies instantly when it booted correct, else cross-fades one `requestAnimationFrame` later so the dark frame is committed first. The animated path requires the handshake, so a host without the boot script behaves exactly as before. |

**Regression evidence:** `src/hooks/use-file-tabs.test.ts` covers the live
accessor, the hydration flags and the closed-tab stack behaviourally;
`src/hooks/use-theme.test.ts` covers both boot hand-offs;
`src/native-file-hardening-wiring.test.ts` pins the startup ordering, the live
reads and the isHydrated checks; `src/styles/base.test.ts` pins that the window
`backgroundColor`, the night theme's `--bg-color` and the boot script agree.

**Blind spots:** the wiring guards are regex-over-source and cannot see runtime
behaviour — the stale-capture bug shipped green past them, and only a test that
executed the real hooks caught it. Prefer a behavioural test for anything in
this section. No native desktop run has exercised any of it.

**Maintenance:** Re-derive an affected section from source before altering it;
replace falsified claims rather than appending around them. Re-run the named
tests after every filesystem-boundary change, and do not call the native desktop
flow verified until it runs on a machine with its Tauri system dependencies.
