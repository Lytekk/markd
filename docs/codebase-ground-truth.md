# Codebase Ground Truth — native filesystem, active-buffer, and chrome wiring (Markd) [rev: 68db938]

> **Re-derived from source on 2026-08-09.** This is a direct trace of the
> shipped `68db938` tree (v0.4.9), including source metrics/tab synchronization
> (`2c1d69f`) and the active-buffer, in-app-dialog, watcher, and chrome work
> merged as `9816e61`. It supersedes the v0.4.7 (`6a38adf`) trace wherever they
> disagree. Symbols are durable; line numbers are not.
>
> **Verification boundary:** v0.4.9 CI run `31312907836` passed Typecheck + test
> and Rust check + test; the release matrix `31312913463` built and published
> signed Windows and macOS-universal artifacts. The current renderer suite is
> **70 files / 717 tests**. A native Windows WebView2 replay covered the wide
> table, sidebar/min-width, footer, and theme paths. Local Linux Tauri compilation
> remains unavailable in this WSL environment because Cairo, GTK, Pango, GDK, and
> Libsoup development packages are absent. CI/package success is not direct proof
> of every OS double-click, persisted-scope, or asset-scope lifecycle.

## 1. Renderer-to-native authorization boundary [RE-DERIVED]

| Claim | Source-verified edge |
|---|---|
| Renderer code has no direct filesystem-plugin permission or JS dependency. | `src-tauri/capabilities/default.json` omits all `fs:*` permissions; `package.json`/`pnpm-lock.yaml` remove `@tauri-apps/plugin-fs`; path reads/writes/tree mutation in `src/lib/file-system.ts` invoke custom Rust commands only. |
| File and folder pickers are the normal grants. | `tauriOpenFile`, `tauriSaveFileAs`, and `tauriOpenDirectory` in `src/lib/file-system.ts` use dialog APIs; every selected path reaches Rust through `read_file`/`write_file`/`read_dir`. Folder selection requests `recursive: true`. |
| Native dialogs are OS pickers only. | The capability surface grants exactly `dialog:allow-open` and `dialog:allow-save`; `src/lib/file-system.ts` uses them for file open, Save As, folder open, and HTML export. `dialog:default`/ask/message/confirm are absent. App notices, choices, and text input use `src/lib/modal.ts` + `ModalHost`. |
| Reveal is a deliberately separate, non-filesystem exception. | `src/lib/reveal.ts` calls the opener plugin's `revealItemInDir`; `opener:allow-reveal-item-in-dir` is explicitly granted. It is capability-gated but does not call `ensure_allowed_path`, because it is not a read/write command. |
| Every custom filesystem command that accepts a renderer path passes one scope gate. | `read_file`, `write_file`, `read_dir`, `create_file`, `create_folder`, `rename_path`, `trash_path`, `path_exists`, and `watch_file` in `src-tauri/src/lib.rs` call `ensure_allowed_path`. |
| The scope gate blocks lexical new-child escapes through a symlinked parent. | `ensure_allowed_path` chooses `file_ops::canonical_existing_path` or `canonical_new_child_path`, then requires both submitted and canonical paths to match `app.fs_scope()`. `file_ops::reject_symlink_components` rejects non-absolute paths, parent traversal, and every existing symbolic-link component. |
| A failure to *inspect* a path is distinguished from a denial. | `path_inspection_error` maps `ErrorKind::InvalidInput` (the only policy refusal `file_ops` raises) to `MARKD_PATH_NOT_AUTHORIZED` and every other io kind to `MARKD_PATH_UNAVAILABLE`. `src/lib/file-system.ts` exposes `isPathAuthorizationError`/`isPathUnavailableError`; `src/lib/restore-failure.ts` turns those plus a `path_exists` probe into `unauthorized`/`missing`/`unavailable`. Only the first two close a restored tab. |
| Cross-source file identity is normalized rather than assumed to have one spelling. | Picker/tree strings and CLI/single-instance strings can differ; `file_ops::display_path` simplifies the latter while `samePath`/`normalizePathKey` reconcile tab lookup, Recent Files, and write-queue identity. Exact string equality remains deliberate inside a captured active-save owner, where a changed path invalidates that owner. |
| The scope is asked once for a path that exists. | `ensure_allowed_path` sets `path_exists_for_scope` on the `symlink_metadata` Ok arm and then checks only `is_allowed(&canonical_path)`. Tauri's `Scope::is_allowed` canonicalizes its own argument, so for an existing path both spellings resolve to the same query; a MISSING leaf cannot be canonicalized and still has both forms checked. It returns the canonical `PathBuf` so callers do not re-derive it — `read_file` used to walk and canonicalize the whole path a second time for the asset grant. |
| A launch file is delivered exactly once, by exactly one route. | `PendingOpensState` holds the queue and `renderer_ready` under ONE mutex, so the single-instance forwarder's "is anyone listening?" check and its push are atomic against `take_pending_opens`. A live renderer gets the emit; one still booting finds the path queued. `get_opened_file` sets `launch_file_taken` so a webview reload cannot re-open (or re-alert about) the same argv. |
| A relative launch argument cannot escape the directory it was issued from. | `file_ops::resolve_launch_path` preserves an absolute argument; it anchors a relative argument to the launching process's cwd (`get_file_path_from_args` uses this process's, the single-instance handler uses forwarded `cwd`) and refuses any relative `..` component. The resulting path still must pass the ordinary scope and no-link checks before opening. |
| Initial-argv open failures are reported instead of swallowed. | `get_opened_file` returns `Result<Option<OpenedFile>, String>`; the startup effect surfaces an in-app "Open Failed" notice instead of the previous silent `.ok()?`. A forwarded single-instance path that fails `is_file` or `grant_file_access` is still dropped by the native forwarder without a renderer notice. |
| Dialog and OS-file paths also grant the asset protocol, and both scopes persist. | `tauri-plugin-fs::init()` precedes `tauri_plugin_persisted_scope::init()` in `run`; Cargo enables its `protocol-asset` feature and now also declares it on `tauri` itself. `grant_file_access` gives CLI/single-instance files both `fs_scope` and `asset_protocol_scope` access after no-link canonicalization. |
| An existence probe can answer for a path whose parent is gone. | `path_exists` treats a `MARKD_PATH_UNAVAILABLE` inspection failure as `false` ONLY when `nearest_existing_ancestor_is_allowed` finds an existing ancestor inside the grant. Without that, a deleted folder was indistinguishable from an offline drive and its tabs were kept forever. |
| Pre-hardening localStorage paths never self-authorize. | `App.handleRecentFileSelect` detects `MARKD_PATH_NOT_AUTHORIZED` and routes the user through `openFile(defaultPath)`; hydration reports failed restores without claiming the file was deleted. `Sidebar` preserves unchecked recent entries. |

**Regression evidence:** `src/native-file-hardening-wiring.test.ts`,
`src/lib/file-system.test.ts`, `src/tauri-capabilities.test.ts`,
`src/dialog-surface-policy.test.ts`, and `src/components/Sidebar.test.tsx` are
in the passing v0.4.9 suite.

**Blind spots:** authorization is checked before filesystem use, so a hostile
local process can still race by replacing a directory after validation; fully
descriptor-relative no-follow operations need a separately designed cross-platform
primitive. No native WebView scope flow has yet exercised the actual OS
double-click → running-build → persisted-scope/asset-scope lifecycle end to end.

## 2. Durable-save and mutation seams [RE-DERIVED]

| Claim | Source-verified edge |
|---|---|
| In Tauri, Active Save, autosave, background Save All, Save As, and HTML export route to `write_file`. | `use-file-state.ts` and `background-tab-save.ts` call `saveToFile`/`saveFileAs`; the native paths in `file-system.ts` send `write_file`; export uses the native save dialog then `write_file`. Browser/dev fallbacks deliberately use File System Access or a blob download instead. |
| A failed native save has no direct renderer fallback. | `tauriSaveFile` returns `false` on command failure; `writeTextFile` is absent from `file-system.ts`. |
| Writes use a randomized sibling temporary file and atomic replacement. | `file_ops::write_atomic` uses `tempfile::NamedTempFile::new_in`, preserves existing permissions, writes/syncs, and persists once. No direct-write fallback exists. The Unix parent-directory sync is best-effort: it runs *after* the rename has already published the new contents, so its failure is a durability warning and no longer fails the save. |
| A save reports what actually happened. | `src/lib/save-outcome.ts` `SaveOutcome` is `written`/`cancelled`/`superseded`/`failed`; `saveFileAs` returns `SaveAsResult` so a cancel is distinguishable from a failed write. `App.saveActiveTab` raises "Save Failed" only for `failed`, including for an untitled document; any remaining foreground `superseded` outcome after an eligible single retry is surfaced as "Saved — Newer Changes Pending." |
| A write can settle only the buffer/path revision that started it. | `useFileState` captures `contentRevision` and `filePath` before each active write; its queued callback and post-write settlement both reject a changed revision/path as `superseded`. `queueFileWrite` serializes the same normalized path so an older issued write cannot land after newer bytes. `saveBackgroundTab` also receives a caller ownership predicate before writing or returning saved identity. |
| A superseded foreground Save cannot retry another buffer or reopen Save As. | `App.saveActiveTab` retries once only when `shouldRetrySupersededActiveSave` sees an in-place save, the original tab still active, and `samePath(beforeSave.filePath, current.filePath)`. It then captures the current tab revision and calls `markTabSaved` only while that tab remains active. A switched, detached, renamed, pathless, or newly edited buffer stays unsaved rather than being written through the shared active hook. |
| Watcher classification cannot race autosave over an unseen external version. | `pauseAutoSave` cancels the due timer while a file-change check/prompt owns the path; both the timer callback and its queued writer recheck the pause token. `resumeAutoSave` starts a fresh debounce only after the safe path/choice branch; unreadable-but-existing files retry while paused. |
| Creation and rename cannot overwrite an existing target. | `file_ops::create_file` uses `OpenOptions::create_new(true)`; `create_folder` uses non-recursive `create_dir`; `rename_without_overwrite` uses `renamore::rename_exclusive`. |
| A direct rename of an open file, and a trash of any open subtree, cannot leave autosave bound to the deleted path. | For a file entry, `App.handleFileAction` updates the live active state and matching tab after rename. On trash it detaches the active buffer and removes `filePath` from every open tab inside the trashed path before refreshing the tree, so autosave/Save All cannot recreate the deleted file. Directory-rename descendants are a separate known gap. |

**Regression evidence:** the current v0.4.9 CI Rust job passes, and the release
matrix builds the Windows and macOS bundles. `src/native-file-hardening-wiring.test.ts`,
`src/lib/file-write-queue.test.ts`, `src/lib/background-tab-save.test.ts`,
`src/hooks/use-file-state.test.ts`, `src/lib/save-outcome.test.ts`, and
`src/buffer-transition-wiring.test.ts` pin the scope, atomic-write, queue, outcome,
and ownership contracts. The isolated `file_ops.rs` harness remains Linux-only;
the Unix-only symlink cases explain why its historical count differed from the
Windows crate test.

**Blind spots:** Windows reparse points (junctions) are still exercised only by
inspection — `reject_symlink_components` refuses them, which makes a junctioned
or symlinked document unopenable; that remains open. Filesystem-specific
`renamore`'s collision/no-clobber behavior is not deliberately exercised in a
Windows release-environment collision scenario; successful package builds are
not that adversarial test. Renaming a directory currently updates only a tab
whose path exactly equals the renamed entry; open descendant file tabs retain
their old paths, so a later autosave can target a stale location. This document
does not claim directory-rename path propagation is safe.

## 3. Directory, asset, and observer seams [RE-DERIVED]

| Claim | Source-verified edge |
|---|---|
| Tree recursion never exposes a symlink as a directory child. | `file_ops::read_directory` uses `DirEntry::file_type()` and skips `is_symlink()` before `tauriReadDir` recurses. |
| The asset protocol starts with no global filesystem grant. | `src-tauri/tauri.conf.json` has `assetProtocol.enable: true` and `scope: []`; dialog/OS grants add only authorized files or recursive folders, then persisted scope restores them. |
| An authorized document's folder can serve that document's images. | `allow_document_assets` grants the canonical parent directory recursively to `asset_protocol_scope()` only — never `fs_scope()` — and is reached solely from `grant_file_access` and from `read_file` *after* `ensure_allowed_path` has passed. It returns early when the folder is already in the asset scope: every grant fires a scope event and `tauri-plugin-persisted-scope` rewrites its whole state file per event, which the NEXT launch re-canonicalizes entry by entry before the window exists. Without it, emptying the global asset scope in `65a4a35` left every relative `![](./img/x.png)` broken for a document opened by double-click or File > Open. `../` escapes are still refused because Tauri's scope check canonicalizes before glob-matching. |
| Markdown cannot inject a raw local-protocol URL. | `resolveImageSrc` rejects `asset:`, `file:`, and `tauri:` directly. HTTP(S), data, and blob sources pass through; other strings (relative or absolute) are converted with `convertFileSrc`. Native asset-protocol scope, not a renderer-side precheck, decides whether that resulting fetch is servable. |
| The watcher is one active-file, parent-directory watcher that survives atomic replacement. | Rust stores one `RecommendedWatcher`, validates the target, watches its parent non-recursively, and filters by original filename. The renderer arms it only for the active `fileState.filePath`; it re-arms on a tab/path change, performs an initial content check, and checks again on native focus, so a change made while another tab was active is classified when this one becomes active. |
| External-change prompts are content- and ownership-bound. | `App.tsx` compares fresh disk bytes with live `savedContent`, then binds each request to `{tabId, filePath, contentRevision, tabRevision}`. `createFileChangePromptCoordinator` absorbs duplicates but schedules one trailing different-owner check. Reload uses a fresh read and the exact target; deletion defaults to keep/detach unless Close Tab is explicit. Stale/dismissed same-path requests reclassify before autosave resumes. |

**Regression evidence:** `src/lib/resolved-image.test.ts` rejects raw local
protocols; `src/native-file-hardening-wiring.test.ts` asserts empty global asset
scope, asset-scope persistence wiring, and that `allow_document_assets` touches
only the asset scope and only after `ensure_allowed_path`; `src/lib/file-change.test.ts`
and `src/buffer-transition-wiring.test.ts` pin watcher ownership, stale-choice,
and autosave behavior. That guard file's `functionBody()` extractor skips strings
and comments when counting braces so a truncated body cannot make its
`.not.toContain` assertions pass vacuously.

**Blind spots:** `csp` is still `null` in `tauri.conf.json`, which is what makes
the widened asset scope worth revisiting: a hostile document plus any injection
has unrestricted network access. Adding a policy needs a native run to confirm
mermaid, KaTeX and the updater survive it.

## 4. Tab state, prompt ownership, and startup ordering [RE-DERIVED]

These are not filesystem edges, but every one of them decides which bytes reach
which path, so they belong with the rest of the wiring.

| Claim | Source-verified edge |
|---|---|
| Documented async ownership paths read live tab state rather than a captured render snapshot. | `useFileTabs` exposes `getTabsSnapshot()` / `getActiveTabId()` from refs because its public `tabs` and `activeTabId` values belong to a render. Startup, Save All, reload-all, and single-instance open paths use those accessors or their equivalent ref-backed functions. This scope is intentional: other code may inspect `fileTabsRef.current.tabs` only where its surrounding latest-request/tab-revision guard establishes ownership. |
| A tab that names a file it has never read is never treated as authoritative. | Persisted path tabs and named closed-tab sentinels begin unhydrated; a fresh in-memory tab begins hydrated. `hydrateTab` marks an existing unhydrated tab loaded after a read. `openInTab` can create/replace a tab with supplied bytes, but its matched-existing path only activates it and needs `hydrateTab` separately. `snapshotActiveTab` returns early for an unhydrated tab, and `restoreTabIntoEditor` reads it before binding it to the editor. `content === ""` cannot express this state. |
| The OS-handed document is opened before the session is restored. | The startup effect invokes `get_opened_file` first, then reads `activeId`/`needsHydration` from the live accessors — so a launch file that claimed the editor is already hydrated, drops out of `needsHydration`, and the active-tab branch (with its failure-recovery paths, each of which pushes a document into the editor) is skipped. `openInTab`'s matched-existing branch activates a tab without writing content, so the launch bytes are handed to it explicitly. The failed-open dialog is reported last. |
| Awaited destructive/reload actions own an exact active-buffer generation. | `useFileState.getContentRevision()` advances on every edit/replacement. Close, Close All, quit, reload, file watcher, link/slash/math prompts, and active Save use latest-request, tab, path, and/or document-generation checks before applying late results. A successful Save intentionally refreshes its owned token; a late tab switch or edit aborts rather than mutating the new buffer. |
| Application dialogs are one accessible in-app surface, not native message boxes. | `modal.ts` sends prompt/confirm/notice requests to one `ModalHost`. Normal requests queue FIFO; an unattended update offer is the only replaceable class. The host validates safe defaults, drops stale owner-gated requests, traps focus, makes the background inert, and returns focus after the full modal session. Global shortcuts also consult `isModalOpen`; caller continuations still verify their own ownership after awaits. |
| Startup is configured to avoid a white first frame, and day transitions remain bounded. | `tauri.conf.json` sets `backgroundColor: #1e1e2e` and uses invisible geometry restore; `index.html` paints `data-theme="night"` first and records the real target in `data-boot-theme`. `useTheme` applies immediately for reduced motion or an already-correct/no-handshake boot; otherwise it changes the root inside `document.startViewTransition` when available, falling back to an rAF-staged, 600ms-bounded CSS transition. Day's reading surface is `#FCF5E5`. This startup first-frame behavior still needs its own native timing replay. |

**Regression evidence:** `src/hooks/use-file-tabs.test.ts` covers the live
accessors, hydration flags, and closed-tab stack; `src/buffer-transition-wiring.test.ts`
and `src/lib/file-change.test.ts` cover active-buffer and watcher ownership;
`src/components/ModalHost.test.tsx` and `src/dialog-surface-policy.test.ts` cover
queueing, focus/inertness, safe defaults, capability policy, and stale requests;
`src/hooks/use-theme.test.ts` covers boot hand-off, View Transition, and reduced
motion. `src/styles/base.test.ts` pins the native background, boot palette, and
day theme surface.

**Blind spots:** some wiring guards remain source-structure assertions and cannot
prove a full runtime lifecycle; prefer behavioural tests for new ownership paths.
The v0.4.9 native WebView2 replay exercised the supplied wide-table, responsive
sidebar/footer, and theme paths, but not every OS double-click, persisted-scope,
file-watch, multi-tab-save, or native close lifecycle.

## 5. Source content and metrics [RE-DERIVED]

Source mode is not a cosmetic view: its textarea, not the retained ProseMirror
document, owns the current user bytes. The following seams prevent that split
representation from corrupting a save, restore, or status count.

| Claim | Source-verified edge |
|---|---|
| Source-mode saves and tab snapshots use the textarea verbatim. | `currentMarkdown` returns `sourceMarkdown` in source mode; `App.tsx` registers it with both `useFileState` and `useFileTabs`. The stale ProseMirror JSON is withheld by `currentDocJSON`, and the clean-serialize skip is disabled by `editorBufferIsClean`. |
| Source text offsets match the browser textarea, not raw CRLF bytes. | `textareaText` normalizes CRLF/lone CR for the textarea view only, so source find ranges, outline offsets, highlights, and selections share the DOM's coordinate system. Clean saves retain original `savedContent` verbatim; dirty saves use the existing line-ending fidelity path. |
| Rendered and source stats use one visible-text basis. | Rendered stats use `doc.textBetween(..., "\\n")`, which preserves block boundaries. Source stats tokenize the configured Markdown parser, exclude frontmatter, and reproduce the same logical text blocks. Saved baselines derive from authoritative `savedContent`, so deltas appear while dirty in either mode and disappear when the bytes are saved. |
| Large source buffers do not let a departed result overwrite the current tab's stats. | `MarkdownStatsWorkerClient` assigns a monotonic request id, ignores stale replies, cancels on mode/tab changes, and falls back synchronously to the Markdown token parser if Worker startup or execution fails. |

**Regression evidence:** `src/source-truth-wiring.test.ts`, `src/lib/source-truth.test.ts`,
`src/lib/text-stats.test.ts`, `src/lib/text-stats-worker-client.test.ts`, and
`src/components/Editor.test.tsx` are in the v0.4.9 passing suite.

**Blind spots:** source stats deliberately reproduce parser/ProseMirror visible
text rather than the exact painted DOM. Worker delivery and fallback are unit
tested; a very large real WebView document remains a performance acceptance
surface, not a proof supplied by the worker tests.

## 6. Chrome and responsive-layout invariants [RE-DERIVED]

These presentation rules are load-bearing because they determine whether active
content and controls remain reachable as tabs, tables, sidebar state, and window
width change.

| Claim | Source-verified edge |
|---|---|
| Source line numbers describe logical Markdown lines only. | `SourceEditor` measures each logical line's soft-wrapped height, including the final line, and syncs the gutter to textarea scroll. A width-only `ResizeObserver` debounces remeasurement so Full/Column, sidebar, and window changes cannot leave stale row heights. Rendered mode does not present block counters as source lines. |
| The active tab is reachable without moving the New Tab affordance. | `.markd-tab-list` owns horizontal overflow while hiding only its scrollbar; `TabBar` compares the active tab's offset box with the list viewport and minimally updates that list's `scrollLeft` on activation or resize. The outer bar keeps the New Tab button fixed. |
| A live wide table has one persistent horizontal scroll owner. | `.markd-editor-scroll` owns horizontal overflow. In the live shell, TipTap's `.tableWrapper` and table overflow remain visible and the table stays intrinsic-width, so every column contributes to the outer scrollbar. Standalone HTML exports and print retain their bounded table-local fallback because they lack that live owner. |
| Footer membership and tracks do not move neighboring controls. | `StatusBar` keeps named slots mounted; CSS assigns fixed grid tracks, fixed delta subtracks, tabular numerals, and an inner focus-following horizontal rail for narrow widths. The Width control stays labeled `Full`; state is expressed through paint/pressed state rather than text replacement. |
| Sidebar state cannot hide keyboard focus or strand the editor below its usable width. | The persistent 35px toggle sits before `TabBar`, owns `aria-expanded`, and controls an `inert`/`aria-hidden` collapsed sidebar. The native capability surface explicitly grants `core:window:allow-set-min-size` and `core:window:allow-set-size`; minimum width follows state: 640px collapsed, 900px open. Opening grows a too-small restored window, collapsing only lowers the floor. |

**Regression evidence:** `src/components/SourceEditor.test.tsx`,
`src/lib/textarea-metrics.test.ts`, `src/components/TabBar.test.tsx`,
`src/components/StatusBar.test.tsx`, `src/components/Sidebar.test.tsx`, and
`src/styles/base.test.ts` cover these contracts. The v0.4.9 native WebView2 replay
opened the supplied 74-row/77-column document, reached its final table cell,
exercised sidebar minimum widths, verified footer containment, and replayed the
day/night transition.

**Blind spots:** print and standalone export intentionally preserve their prior
bounded-table behavior; that is not a promise that an arbitrary 77-column table
fits a printed page. The native replay covers the stated geometry cases, not all
HiDPI/window-manager combinations.

**Maintenance:** Re-derive an affected section from source before altering it;
replace falsified claims rather than appending around them. Re-run the named
tests after every affected wiring change. Distinguish a native package/CI build,
a native UI replay, and an end-to-end OS scope lifecycle; none is evidence for
the others.
