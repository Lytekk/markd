import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { useFileState } from "@/hooks/use-file-state";
import { useTheme } from "@/hooks/use-theme";
import { Editor } from "@/components/Editor";
import { Toolbar } from "@/components/Toolbar";
import { Menubar } from "@/components/Menubar";
import { Sidebar, type FileTreeAction } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { FindReplace, type FindUiState } from "@/components/FindReplace";
import { SourceEditor } from "@/components/SourceEditor";
import { ContextMenu } from "@/components/ContextMenu";
import { ModalHost } from "@/components/ModalHost";
import { CommandPalette } from "@/components/CommandPalette";
import { TabSwitcher } from "@/components/TabSwitcher";
import { SnippetPicker } from "@/components/SnippetPicker";
import { SnippetManager } from "@/components/SnippetManager";
import { spliceSnippetText } from "@/lib/snippets";
import { insertSnippetIntoEditor } from "@/lib/snippet-insert";
import { useSnippets } from "@/hooks/use-snippets";
import { useRecentFiles } from "@/hooks/use-recent-files";
import { useFullWidth } from "@/hooks/use-full-width";
import { useLineNumbers } from "@/hooks/use-line-numbers";
import { useFileTabs, type FileTab } from "@/hooks/use-file-tabs";
import { copyToClipboard } from "@/lib/code-block-enhance";
import { revealInFileManager } from "@/lib/reveal";
import { useZoom } from "@/hooks/use-zoom";
import { TabBar, type TabAction } from "@/components/TabBar";
import { createFile, createFolder, exportAsHtml, exportAsPdf, isPathAuthorizationError, openFile, pathExists, readFileByPath, renamePath, saveFileAs, saveToFile, trashPath } from "@/lib/file-system";
import { ensureMdExtension, joinPath, parentPath, targetDirForEntry, validateName } from "@/lib/file-tree-ops";
import {
  shouldCheckForUpdate,
  makeUpdateCheckRecord,
  shouldOfferUpdate,
  UPDATE_SKIP_KEY,
} from "@/lib/updater";
import { shouldPromptForExternalChange, shouldPromptForDeletion } from "@/lib/file-change";
import { askDialog, messageDialog } from "@/lib/dialogs";
import { samePath } from "@/lib/path-identity";
import { isPathInside } from "@/lib/path-scope";
import { saveOutcomeMessage, type SaveOutcome } from "@/lib/save-outcome";
import { reloadDiscardPrompt } from "@/lib/reload-guard";
import {
  classifyRestoreFailure,
  restoreFailureNotice,
  type RestoreFailureCounts,
  type RestoreFailureKind,
} from "@/lib/restore-failure";
import { confirmModal, promptModal } from "@/lib/modal";
import { normalizeUrl, wordRangeAt } from "@/lib/links";
import { splitFrontmatter, joinFrontmatter } from "@/lib/frontmatter";
import { computeTextStats, type TextStats } from "@/lib/text-stats";
import { canRevertClean, docMatchesSaved, parseSavedDoc, sourceModeIsDirty } from "@/lib/dirty-check";
import { currentMarkdown, currentDocJSON, editorBufferIsClean, textareaText } from "@/lib/source-truth";
import { renderSourceHtml } from "@/lib/source-html";
import { editorSearchBackend, textareaSearchBackend, type SearchBackend } from "@/lib/search-backend";
import { wordAt, type TextRange } from "@/lib/text-search";
import { extractSourceHeadings } from "@/lib/source-outline";
import { revealRange } from "@/lib/textarea-metrics";
import { loadEditorContent } from "@/lib/editor-load";
import { tabDisplayInfo } from "@/lib/tab-display";
import { saveBackgroundTab } from "@/lib/background-tab-save";
import { createLatestRequestGuard } from "@/lib/latest-request";

function isTauri(): boolean {
  // Tauri v2 exposes the IPC bridge as __TAURI_INTERNALS__ by default;
  // __TAURI__ only exists when withGlobalTauri is enabled in tauri.conf.json.
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

// How long after the last edit to test whether the doc returned to the saved
// state. Long enough to coalesce undo bursts, short enough to feel instant.
const REVERT_CHECK_MS = 250;

export function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"files" | "outline">("outline");
  const [heldModifier, setHeldModifier] = useState<"ctrl" | "alt" | null>(null);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceShowReplace, setFindReplaceShowReplace] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [snippetPickerOpen, setSnippetPickerOpen] = useState(false);
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false);
  const [snippetManagerAdd, setSnippetManagerAdd] = useState(false);
  const { snippets, addSnippet, updateSnippet, deleteSnippet, resetSnippets } = useSnippets();
  // Source-mode caret captured at Ctrl+Space (before the picker steals focus).
  const sourceCaretRef = useRef<{ start: number; end: number } | null>(null);
  const lastSearchTermRef = useRef("");
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceMarkdown, setSourceMarkdown] = useState("");
  // Markdown captured when entering source mode, to detect a no-op toggle.
  const sourceEntryMdRef = useRef("");
  const [focusMode, setFocusMode] = useState(false);
  const { activeTheme, switchTheme, themes } = useTheme();
  const { fullWidth, toggleFullWidth } = useFullWidth();
  const { lineNumbers, toggleLineNumbers } = useLineNumbers();
  const { zoom, zoomIn, zoomOut, resetZoom } = useZoom();
  const fileState = useFileState();
  const { recentFiles, addRecentFile, removeRecentFile } = useRecentFiles();
  const fileTabs = useFileTabs();
  const bufferLoadGuardRef = useRef(createLatestRequestGuard());
  // Stable mirrors let asynchronous callbacks and TipTap transactions operate
  // on the current buffer rather than a render-time closure.
  const fileTabsRef = useRef(fileTabs);
  fileTabsRef.current = fileTabs;
  const fileStateRef = useRef(fileState);
  fileStateRef.current = fileState;
  // The generic fileState→tab mirror must not race an explicit active save.
  // Save owners settle their captured tab revision themselves; mirrors only
  // cover loads and autosaves that have no caller-held tab ownership.
  const activeSaveOwnerRef = useRef<{ tabId: string; revision: number } | null>(null);

  // Directory of the currently-open file. Read by ResolvedImage at renderHTML
  // time, so it must be updated BEFORE setContent runs — do it synchronously
  // inside the registerSetContent callback.
  const fileDirRef = useRef<string>("");
  // Leading YAML frontmatter, kept out of the editor (tiptap-markdown would
  // corrupt it) and re-prepended verbatim on serialize. Tracks the active file.
  const frontmatterRef = useRef<string>("");
  // Saved-state baseline for revert detection: the doc as of the last save (or
  // load), plus its frontmatter. Undoing back to this state clears dirty.
  const savedDocRef = useRef<PMNode | null>(null);
  const savedFrontmatterRef = useRef<string>("");
  const revertCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Word/char-count baselines per tab, captured at OPEN time (not save) — the
  // status bar shows deltas against these.
  const statsBaselineMapRef = useRef(new Map<string, TextStats>());
  const [statsBaseline, setStatsBaseline] = useState<TextStats | null>(null);
  // Find/replace UI state per tab (session-only) — Ctrl+F/Ctrl+H recall what
  // was last typed for the active tab.
  const findStateMapRef = useRef(new Map<string, FindUiState>());
  // Dirty flag captured when entering source mode — reverting the textarea to
  // its entry snapshot restores it (see sourceModeIsDirty).
  const sourceEntryDirtyRef = useRef(false);
  // savedContent captured when the entry snapshot was seeded — the entry
  // branch of sourceModeIsDirty is only valid while savedContent still equals
  // this (a source-mode save moves disk PAST the entry snapshot; reverting to
  // entry then differs from disk and must stay dirty).
  const sourceEntrySavedRef = useRef("");
  // Ref mirrors of the source-mode state for the content-truth accessors and
  // the setContent callback registered below — those are registered once per
  // editor, so reading the state there would capture stale closures.
  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;
  const sourceMarkdownRef = useRef(sourceMarkdown);
  sourceMarkdownRef.current = sourceMarkdown;

  const editor = useEditor({
    extensions: [
      ...getExtensions({ getFileDir: () => fileDirRef.current }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: "",
    onUpdate: ({ editor: ed }) => {
      fileState.markDirty();
      fileTabsRef.current.markTabDirty();
      // Debounced revert check: if the doc returns to the saved baseline
      // (undo past every change), clear the dirty flag — nothing to save.
      if (revertCheckTimerRef.current) clearTimeout(revertCheckTimerRef.current);
      revertCheckTimerRef.current = setTimeout(() => {
        // canRevertClean: a detached buffer (file trashed) keeps a stale
        // baseline that may still match — matching must NOT clear the
        // unsaved-changes guard there (the buffer can be the only copy).
        const fs = fileStateRef.current;
        if (
          canRevertClean(fs.filePath, fs.savedContent) &&
          docMatchesSaved(
            ed.state.doc,
            savedDocRef.current,
            frontmatterRef.current,
            savedFrontmatterRef.current,
          )
        ) {
          fs.markClean();
        }
      }, REVERT_CHECK_MS);
    },
    editorProps: {
      // Keep the caret line comfortably off the viewport edges (a bit of scroll
      // room — thin lines especially) instead of jamming against top/bottom.
      scrollThreshold: 120,
      scrollMargin: 120,
      attributes: {
        id: "write",
        // Disable the browser's native spellcheck: on a large, word-heavy doc
        // Chromium spellchecking the whole contenteditable is a documented severe
        // perf hit (re-runs on every content swap / keystroke). A markdown/spec
        // editor doesn't need red squiggles; this keeps switching + typing snappy.
        spellcheck: "false",
      },
    },
  });

  // Single serialize point for the rendered editor's full markdown (frontmatter
  // re-joined) — the registration accessors, source-mode entry serialize, and
  // the saved-doc baseline effect all read through this.
  const getEditorMarkdown = useCallback(
    () =>
      editor
        ? joinFrontmatter(frontmatterRef.current, editor.storage.markdown.getMarkdown() as string)
        : "",
    [editor],
  );

  // Register editor methods with file state. Every registration below answers
  // "what is the buffer's current content?" through the source-truth accessors:
  // in source mode the truth is the SourceEditor textarea, and serializing the
  // stale PM editor here silently dropped textarea edits from saves, autosaves,
  // tab snapshots and the closed-tab stack (see source-truth.ts).
  useEffect(() => {
    if (!editor) return;
    fileState.registerGetMarkdown(() =>
      currentMarkdown(sourceModeRef.current, sourceMarkdownRef.current, getEditorMarkdown),
    );
    fileState.registerSetContent(
      (md: string, fileDir: string, docJSON?: JSONContent, isDirty?: boolean) => {
        fileDirRef.current = fileDir;
        const { frontmatter, body } = splitFrontmatter(md);
        frontmatterRef.current = frontmatter;
        // loadEditorContent (NOT bare setContent): resets PM history so Ctrl+Z
        // can never pull the previous tab's doc into this one (see editor-load.ts).
        // Fast path: when the tab carries a cached PM JSON doc (set on switch-away),
        // load that — it skips the slow markdown re-parse (the large-doc switch lag).
        // First load / post-external-change has no cache → parse the markdown body.
        loadEditorContent(editor, docJSON ?? body);
        // Source mode: the textarea is the visible buffer — re-derive it VERBATIM
        // from the arriving content. Every load path funnels here (tab switch,
        // new tab, open, reload, reopen), so without this the textarea keeps
        // showing the DEPARTING tab's text and a later commit would bleed it
        // into this tab.
        if (sourceModeRef.current) {
          // textareaText: the DOM normalizes CRLF on write, so the view state
          // must match or every state-computed offset drifts (source-truth.ts).
          const viewMd = textareaText(md);
          setSourceMarkdown(viewMd);
          sourceEntryMdRef.current = viewMd;
          sourceEntryDirtyRef.current = isDirty ?? false;
          // Departing tab's savedContent (the arriving one hasn't flushed yet)
          // — conservative on purpose: a mismatch only DISABLES the entry
          // forgiveness branch, and exact-clean arrivals are already covered
          // by sourceModeIsDirty's md === savedContent branch.
          sourceEntrySavedRef.current = fileStateRef.current.savedContent;
          window.dispatchEvent(
            new CustomEvent("markd:stats", {
              detail: computeTextStats(splitFrontmatter(viewMd).body),
            }),
          );
        }
      },
    );
    fileTabs.registerGetMarkdown(() =>
      currentMarkdown(sourceModeRef.current, sourceMarkdownRef.current, getEditorMarkdown),
    );
    // The doc as PM JSON (body only — frontmatter lives in frontmatterRef), cached
    // per tab on switch-away for the fast JSON restore above. No cache in source
    // mode — the editor doc is stale relative to the textarea.
    fileTabs.registerGetJSON(() =>
      currentDocJSON(sourceModeRef.current, () => editor.getJSON()),
    );
    // Authoritative "buffer == saved" check (same doc.eq predicate as the
    // revert-check) so leaving a clean tab can skip the markdown serialize.
    // Never clean in source mode — the predicate can't see the textarea.
    fileTabs.registerIsClean(() =>
      editorBufferIsClean(sourceModeRef.current, () =>
        docMatchesSaved(
          editor.state.doc,
          savedDocRef.current,
          frontmatterRef.current,
          savedFrontmatterRef.current,
        ),
      ),
    );
  }, [
    editor,
    getEditorMarkdown,
    fileState.registerGetMarkdown,
    fileState.registerSetContent,
    fileTabs.registerGetMarkdown,
    fileTabs.registerGetJSON,
    fileTabs.registerIsClean,
  ]);

  // Capture the saved-state doc whenever savedContent changes (open / save /
  // tab switch). When the editor currently HOLDS the saved state, share its
  // doc — reference lineage keeps doc.eq cheap on every revert check. When a
  // dirty tab arrives, the saved state is not in the editor, so reconstruct
  // it with a standalone parse (null on failure → revert check stays dirty).
  useEffect(() => {
    if (!editor) return;
    const { frontmatter, body } = splitFrontmatter(fileState.savedContent);
    savedFrontmatterRef.current = frontmatter;
    const currentMd = getEditorMarkdown();
    savedDocRef.current =
      currentMd === fileState.savedContent
        ? editor.state.doc
        : parseSavedDoc(editor, body);
  }, [editor, fileState.savedContent, getEditorMarkdown]);

  // Track recent files when files are opened/saved
  useEffect(() => {
    if (fileState.filePath && fileState.fileName !== "Untitled") {
      addRecentFile(fileState.fileName, fileState.filePath);
    }
  }, [fileState.filePath, fileState.fileName, addRecentFile]);

  // Stable refs — used by event listeners and one-shot effects to avoid
  // stale closures and dependency-driven re-registration loops.
  // Latest handleCloseTab, callable from the [filePath]-keyed watcher effect
  // (which must not list it as a dep). Assigned just after its definition below.
  const handleCloseTabRef = useRef<(tabId: string) => Promise<void> | void>(() => {});
  // Set once the user has answered the quit prompt, so a re-entrant close
  // request does not ask again.
  const quitConfirmedRef = useRef(false);

  /**
   * Put a tab in the editor, reading it from disk first when its bytes have
   * never been loaded. Restoring an unhydrated tab directly would bind a blank
   * buffer and an empty savedContent to a real file path — the next save writes
   * that emptiness out. When the read fails, the editor is left alone rather
   * than bound to a file it does not hold.
   */
  const restoreTabIntoEditor = useCallback(
    async (tab: FileTab, isCurrent: () => boolean): Promise<boolean> => {
      if (tab.isHydrated || !tab.filePath) {
        fileStateRef.current.restoreState(tab);
        return true;
      }
      const revision = fileTabsRef.current.getTabRevision(tab.id);
      try {
        const content = await readFileByPath(tab.filePath);
        if (!isCurrent()) return false;
        if (!fileTabsRef.current.hydrateTab(tab.id, content, revision)) return false;
        fileStateRef.current.restoreState({
          fileName: tab.fileName,
          filePath: tab.filePath,
          content,
          savedContent: content,
          isDirty: false,
          docJSON: undefined,
        });
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  // Startup owner: restore persisted tabs from disk, then open the file the OS
  // handed us (CLI argument / file association).
  //
  // These were two effects. Both took a buffer-load request, and the second
  // one's begin() invalidated the first's — so on a cold start with no persisted
  // session the double-clicked file was fetched and then silently discarded.
  // They are one sequential owner now, holding ONE request, and the
  // get_opened_file step is unconditional: every startup path reaches it.
  const startupDone = useRef(false);
  useEffect(() => {
    if (!isTauri() || !editor || startupDone.current) return;
    startupDone.current = true;

    (async () => {
      const request = bufferLoadGuardRef.current.begin();
      const isCurrent = () => bufferLoadGuardRef.current.isCurrent(request);
      const ft = fileTabsRef.current;
      const fs = fileStateRef.current;
      const activeId = ft.activeTabId;
      const failures: RestoreFailureCounts = {};

      // Why a read failed decides what to do with the tab. A deleted file is
      // gone and its tab goes with it; an offline share is temporary, so the
      // tab stays and reloads when the user selects it. Closing on every error
      // used to delete the session over a sleeping network drive.
      const recordFailure = async (tab: FileTab, error: unknown): Promise<RestoreFailureKind> => {
        let exists: boolean | null = null;
        try {
          exists = tab.filePath ? await pathExists(tab.filePath) : null;
        } catch {
          exists = null;
        }
        const kind = classifyRestoreFailure(error, exists);
        failures[kind] = (failures[kind] ?? 0) + 1;
        return kind;
      };

      const needsHydration = ft.tabs.filter((t) => t.filePath && !t.isHydrated);

      // Hydrate active tab first — sets editor content directly
      const activeTab = needsHydration.find((t) => t.id === activeId);
      if (activeTab && activeTab.filePath) {
        const revision = ft.getTabRevision(activeTab.id);
        try {
          const content = await readFileByPath(activeTab.filePath);
          if (!isCurrent()) return;
          if (ft.hydrateTab(activeTab.id, content, revision)) {
            fs.handleOpenByPath(activeTab.filePath, content);
            requestAnimationFrame(() => {
              if (!isCurrent()) return;
              const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
              if (el) el.scrollTop = activeTab.scrollTop;
            });
          }
        } catch (error) {
          const kind = isCurrent() ? await recordFailure(activeTab, error) : null;
          if (kind === "unavailable") {
            // Keep the tab — the file is fine, the drive is not — but do not let
            // it stay ACTIVE over the blank startup buffer: switching to a tab
            // that is already active is a no-op, so it could never reload, and
            // anything typed there would end up bound to its real path. Park on
            // a scratch tab; selecting the parked one re-reads it.
            if (isCurrent()) {
              const other = ft.tabs.find((t) => t.id !== activeTab.id && t.isHydrated);
              if (other) {
                const switched = ft.switchTab(other.id);
                if (switched) fs.restoreState(other);
              } else {
                ft.newTab();
              }
            }
          } else if (kind !== null) {
            // Close it and put the successor in the editor — but only once the
            // successor actually holds its file's bytes. Restoring an unhydrated
            // tab binds a blank buffer and an empty savedContent to a real path,
            // and the next Ctrl+S truncates that file to zero.
            const { switchTo } = ft.closeTab(activeTab.id);
            if (switchTo && isCurrent()) await restoreTabIntoEditor(switchTo, isCurrent);
          }
        }
      }

      // Hydrate background tabs — update content in state without switching
      for (const tab of needsHydration) {
        if (!isCurrent()) return;
        if (tab.id === activeId) continue;
        if (!tab.filePath) continue;
        const revision = ft.getTabRevision(tab.id);
        try {
          const content = await readFileByPath(tab.filePath);
          if (!isCurrent()) return;
          ft.hydrateTab(tab.id, content, revision);
        } catch (error) {
          if (isCurrent() && (await recordFailure(tab, error)) !== "unavailable") {
            ft.closeTab(tab.id);
          }
        }
      }

      const notice = restoreFailureNotice(failures);
      if (notice && isCurrent()) {
        await messageDialog(notice.message, { title: notice.title, kind: "warning" });
        if (!isCurrent()) return;
      }

      // Open the file passed via CLI arg / OS file association (if any).
      // Runs after hydration so openInTab can match an already-restored tab and
      // snapshotActiveTab captures hydrated (not empty) content.
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const file = await invoke<{ path: string; name: string; content: string } | null>("get_opened_file");
        if (file && isCurrent()) {
          fileTabsRef.current.openInTab(file.name, file.path, file.content);
          fileStateRef.current.handleOpenByPath(file.path, file.content);
        }
      } catch (error) {
        // The OS named a file we could not open. Saying so beats the blank
        // window the user used to get with no explanation at all.
        if (isCurrent()) {
          await messageDialog(
            isPathAuthorizationError(error)
              ? "Markd could not open that file because the path is not authorized. Open it from File > Open to authorize access."
              : "Markd could not open that file. Its contents are unchanged.",
            { title: "Open Failed", kind: "error" },
          );
        }
      }
    })();
  }, [editor]);

  // Single-instance listener — registers once, uses refs for current state.
  useEffect(() => {
    if (!isTauri() || !editor) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const openPath = async (filePath: string) => {
      const ft = fileTabsRef.current;
      const fs = fileStateRef.current;
      const request = bufferLoadGuardRef.current.begin();
      const existing = ft.tabs.find((t) => samePath(t.filePath, filePath));
      if (existing) {
        let ready = existing;
        if (!existing.isHydrated) {
          const revision = ft.getTabRevision(existing.id);
          try {
            const content = await readFileByPath(filePath);
            if (!bufferLoadGuardRef.current.isCurrent(request)) return;
            if (!ft.hydrateTab(existing.id, content, revision)) return;
            ready = { ...existing, content, savedContent: content, isDirty: false, isHydrated: true, docJSON: undefined };
          } catch {
            return;
          }
        }
        if (!bufferLoadGuardRef.current.isCurrent(request)) return;
        const target = ft.switchTab(existing.id);
        if (target) fs.restoreState(ready);
        return;
      }
      try {
        const content = await readFileByPath(filePath);
        if (!bufferLoadGuardRef.current.isCurrent(request)) return;
        const name = filePath.split(/[/\\]/).pop() ?? "untitled.md";
        ft.openInTab(name, filePath, content);
        await fs.handleOpenByPath(filePath, content);
      } catch {
        // The file may have been removed between the OS event and this read.
      }
    };

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      unlisten = await listen<string>("open-file-in-tab", (event) => {
        void openPath(event.payload);
      });
      // The effect can be torn down while listen() is still resolving; without
      // this the handle is dropped on the floor and the listener outlives it.
      if (cancelled) {
        unlisten();
        unlisten = null;
        return;
      }

      // Tauri drops an emitted event when no JS listener is registered yet, and
      // never replays it. A second launch that lands while this window is still
      // booting — selecting several files in Explorer and pressing Enter starts
      // exactly that race — was therefore silently ignored. The native side
      // queues every path it could not deliver; drain it now that we are live.
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const pending = await invoke<string[]>("take_pending_opens");
        for (const filePath of pending) {
          if (cancelled) return;
          await openPath(filePath);
        }
      } catch {
        // Older backend without the queue — the live listener still covers the
        // common case.
      }
    })();

    return () => { cancelled = true; unlisten?.(); };
  }, [editor]);

  // Toggle source mode
  const handleToggleSource = useCallback(() => {
    if (!editor) return;
    // Defensive: a pending revert check from the rendered editor must not
    // fire across the mode boundary.
    if (revertCheckTimerRef.current) clearTimeout(revertCheckTimerRef.current);

    if (!sourceMode) {
      // Switching TO source: serialize current editor content
      const md = getEditorMarkdown();
      // The find panel survives the toggle: it is keyed by (tab, mode), so it
      // remounts onto the matching search backend with its state recalled.
      setSourceMarkdown(md);
      sourceEntryMdRef.current = md;
      sourceEntryDirtyRef.current = fileStateRef.current.isDirty;
      sourceEntrySavedRef.current = fileStateRef.current.savedContent;
      // Footer counts switch to the raw-markdown basis the textarea shows.
      window.dispatchEvent(
        new CustomEvent("markd:stats", {
          detail: computeTextStats(splitFrontmatter(md).body),
        }),
      );
      setSourceMode(true);
    } else {
      // Switching FROM source: re-parse only if the source actually changed.
      // Passing false suppresses onUpdate so a no-op toggle never flags a clean
      // doc dirty (dirty is driven solely by edits via handleSourceMarkdownChange),
      // and skipping the re-parse entirely keeps an unedited buffer byte-stable
      // (no markdown normalization of list markers / spacing on a round-trip).
      if (sourceMarkdown !== sourceEntryMdRef.current) {
        const { frontmatter, body } = splitFrontmatter(sourceMarkdown);
        frontmatterRef.current = frontmatter;
        editor.commands.setContent(body, false);
      }
      setSourceMode(false);
    }
  }, [editor, sourceMode, sourceMarkdown, getEditorMarkdown]);

  // Handle source markdown changes — track dirty (string compares only: the
  // buffer is raw text, so revert-to-saved/entry detection is plain equality)
  // and keep the footer counts live while the PM editor is unmounted.
  const handleSourceMarkdownChange = useCallback(
    (md: string) => {
      setSourceMarkdown(md);
      const fs = fileStateRef.current;
      // Every textarea mutation advances the save revision, even if it happens
      // to return to the saved bytes and clears dirty immediately afterward.
      // Otherwise an in-flight write could settle the newer buffer as clean.
      fileState.markDirty();
      fileTabsRef.current.markTabDirty();
      const isDirty =
        sourceModeIsDirty(
          md,
          fs.savedContent,
          sourceEntryMdRef.current,
          sourceEntryDirtyRef.current,
          sourceEntrySavedRef.current,
        ) || !canRevertClean(fs.filePath, fs.savedContent);
      if (!isDirty) fileState.markClean();
      window.dispatchEvent(
        new CustomEvent("markd:stats", {
          detail: computeTextStats(splitFrontmatter(md).body),
        }),
      );
    },
    [fileState.markDirty, fileState.markClean],
  );

  // Insert a snippet body at the caret. Rendered mode routes through the
  // caret-safe snippet-insert helper; source mode splices the raw text into the
  // textarea at the captured (or live, blur-retained) caret and restores it.
  const insertSnippet = useCallback(
    (body: string) => {
      if (sourceMode) {
        const live = document.querySelector(".markd-source-textarea") as HTMLTextAreaElement | null;
        const sel =
          sourceCaretRef.current ??
          (live
            ? { start: live.selectionStart, end: live.selectionEnd }
            : { start: sourceMarkdown.length, end: sourceMarkdown.length });
        const { text: next, caret: caretPos } = spliceSnippetText(sourceMarkdown, sel.start, sel.end, body);
        setSourceMarkdown(next);
        fileState.markDirty();
        fileTabsRef.current.markTabDirty();
        requestAnimationFrame(() => {
          const t = document.querySelector(".markd-source-textarea") as HTMLTextAreaElement | null;
          if (t) {
            t.focus();
            t.selectionStart = t.selectionEnd = caretPos;
          }
        });
      } else if (editor) {
        insertSnippetIntoEditor(editor, body);
      }
      sourceCaretRef.current = null;
    },
    [sourceMode, sourceMarkdown, editor, fileState.markDirty],
  );

  // Ref mirror so the search backend (created once per mode/tab) routes
  // replaces through the live dirty/stats handler without stale closures.
  const handleSourceMarkdownChangeRef = useRef(handleSourceMarkdownChange);
  handleSourceMarkdownChangeRef.current = handleSourceMarkdownChange;

  // Match ranges for the SourceEditor highlight backdrop (source mode only).
  const [sourceSearchView, setSourceSearchView] = useState<{
    ranges: TextRange[];
    current: number;
  } | null>(null);
  useEffect(() => {
    if (!sourceMode) setSourceSearchView(null);
  }, [sourceMode]);

  // One search backend per (mode, tab) — the find panel is keyed the same
  // way, so its unmount clear() always targets the backend that owned the
  // highlights. activeTabId is an intentional cache-bust: a fresh tab starts
  // with a fresh search, matching the per-tab panel state recall.
  const searchBackend = useMemo<SearchBackend | null>(() => {
    if (sourceMode) {
      return textareaSearchBackend({
        getText: () => sourceMarkdownRef.current,
        setText: (t) => handleSourceMarkdownChangeRef.current(t),
        getTextarea: () =>
          document.querySelector<HTMLTextAreaElement>(".markd-source-textarea"),
        onResults: (ranges, current) => setSourceSearchView({ ranges, current }),
      });
    }
    return editor ? editorSearchBackend(editor) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeTabId busts the cache on tab switch
  }, [sourceMode, editor, fileTabs.activeTabId]);
  const searchBackendRef = useRef(searchBackend);
  searchBackendRef.current = searchBackend;

  // Source-mode outline: parse headings live from the textarea buffer (the PM
  // doc is stale there). Offsets shift by the frontmatter prefix so a click
  // lands on the heading line in the FULL textarea text.
  const sourceHeadings = useMemo(() => {
    if (!sourceMode) return null;
    const { body } = splitFrontmatter(sourceMarkdown);
    const prefixLen = sourceMarkdown.length - body.length;
    const heads = extractSourceHeadings(body);
    return prefixLen === 0
      ? heads
      : heads.map((h) => ({ ...h, pos: h.pos + prefixLen }));
  }, [sourceMode, sourceMarkdown]);

  const handleSourceHeadingClick = useCallback((pos: number) => {
    const ta = document.querySelector<HTMLTextAreaElement>(".markd-source-textarea");
    if (!ta) return;
    ta.focus();
    revealRange(ta, { start: pos, end: pos });
  }, []);

  // Window title
  useEffect(() => {
    document.title = `${fileState.fileName}${fileState.isDirty ? " \u2022" : ""} \u2014 Markd`;
  }, [fileState.fileName, fileState.isDirty]);

  // Browser beforeunload — covers the dev server. Tauri windows ignore it, so
  // the desktop app needs the onCloseRequested guard below.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Any tab's unsaved edits count — a background tab's dirty buffer is as
      // lost on unload as the active one's (tabs read via ref at event time).
      if (fileState.isDirty || fileTabsRef.current.tabs.some((t) => t.isDirty)) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [fileState.isDirty]);

  const handleThemeToggle = useCallback(() => {
    const currentIdx = themes.findIndex((t) => t.id === activeTheme);
    const next = themes[(currentIdx + 1) % themes.length];
    if (next) switchTheme(next.id);
  }, [activeTheme, themes, switchTheme]);

  const handleExportHtml = useCallback(async () => {
    if (!editor) return;
    // Source mode: export what the textarea holds — the editor doc is stale
    // (entry-time). renderSourceHtml uses the same sanitized PM pipeline as
    // getHTML; on a parse failure it returns null and we fall back to the
    // editor rather than exporting nothing.
    const html = sourceMode
      ? renderSourceHtml(editor, splitFrontmatter(sourceMarkdown).body) ?? editor.getHTML()
      : editor.getHTML();
    try {
      await exportAsHtml(html, fileState.fileName);
    } catch {
      await messageDialog("The HTML export could not be saved.", {
        title: "Export Failed",
        kind: "error",
      });
    }
  }, [editor, sourceMode, sourceMarkdown, fileState.fileName]);

  // Sync tab state when fileState changes (after open/save/new operations).
  // Uses refs so the effect always reads the current activeTabId.
  //
  // React runs every effect once on mount, and at mount fileState is still its
  // initial empty value — filePath null, fileName "Untitled", savedContent "".
  // Mirroring THAT onto a tab restored from localStorage erased the tab's path
  // and name, advanced its revision (so the in-flight startup hydration was
  // rejected and aborted, taking the OS file-association open with it), and
  // re-persisted a session with no file-backed tabs at all.
  //
  // The guard tests the VALUE, not the run count: a "skip the first run" ref is
  // defeated by StrictMode's development double-invoke, which arms on pass one
  // and then applies the still-initial state on pass two — reintroducing exactly
  // this bug on every `pnpm dev`. Nothing has been opened or saved while
  // fileState is untouched, so there is nothing to mirror.
  useEffect(() => {
    const mirroringUntouchedInitialState =
      fileState.filePath === null &&
      fileState.fileName === "Untitled" &&
      fileState.savedContent === "" &&
      fileState.openCount === 0;
    if (mirroringUntouchedInitialState) return;
    const ft = fileTabsRef.current;
    if (activeSaveOwnerRef.current?.tabId === ft.activeTabId) return;
    // markTabSaved asserts "this tab is saved" and therefore clears isDirty.
    // A dirty buffer whose PATH changed has not been saved — renaming from the
    // sidebar, or choosing "Keep in Editor" after the file was deleted outside
    // Markd, both land here with unsaved edits. Marking those clean made the
    // close guard stop asking, so the only remaining copy of the user's work
    // could be discarded without a prompt. Mirror identity alone in that case.
    if (fileStateRef.current.isDirty) {
      ft.updateTabPath(ft.activeTabId, fileState.filePath, fileState.fileName);
      return;
    }
    ft.markTabSaved(ft.activeTabId, {
      filePath: fileState.filePath,
      fileName: fileState.fileName,
      savedContent: fileState.savedContent,
    });
  }, [fileState.filePath, fileState.fileName, fileState.savedContent, fileState.openCount]);

  useEffect(() => {
    const ft = fileTabsRef.current;
    if (fileState.isDirty) ft.markTabDirty();
    else ft.markTabClean();
  }, [fileState.isDirty]);

  // Word/char baseline for the status-bar deltas: reset on open-class loads
  // (openCount never bumps on tab switches), restored — or lazily created —
  // when the active tab changes, pruned alongside closed tabs.
  useEffect(() => {
    if (!editor) return;
    const stats = computeTextStats(editor.state.doc.textContent);
    statsBaselineMapRef.current.set(fileTabsRef.current.activeTabId, stats);
    setStatsBaseline(stats);
  }, [editor, fileState.openCount]);

  useEffect(() => {
    if (!editor) return;
    const map = statsBaselineMapRef.current;
    let stats = map.get(fileTabs.activeTabId);
    if (!stats) {
      stats = computeTextStats(editor.state.doc.textContent);
      map.set(fileTabs.activeTabId, stats);
    }
    setStatsBaseline(stats);
  }, [editor, fileTabs.activeTabId]);

  useEffect(() => {
    const live = new Set(fileTabs.tabs.map((t) => t.id));
    for (const id of [...statsBaselineMapRef.current.keys()]) {
      if (!live.has(id)) statsBaselineMapRef.current.delete(id);
    }
    for (const id of [...findStateMapRef.current.keys()]) {
      if (!live.has(id)) findStateMapRef.current.delete(id);
    }
  }, [fileTabs.tabs]);

  // Pin the app shell: the layout viewport must NEVER scroll — only
  // .markd-editor-scroll does. Some WebView2 focus handling scrolls the document
  // root when an off-screen element gains focus on a tab switch, sliding the
  // menubar/tabbar up under the native title bar (the shell is overflow:hidden,
  // so there's no scrollbar to undo it). Snap any root scroll back to 0,0. This
  // listener only fires for document-root scrolls, never for .markd-editor-scroll.
  useEffect(() => {
    const pin = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
      const de = document.documentElement;
      if (de.scrollTop !== 0) de.scrollTop = 0;
      if (de.scrollLeft !== 0) de.scrollLeft = 0;
      if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
    };
    window.addEventListener("scroll", pin, { passive: true });
    return () => window.removeEventListener("scroll", pin);
  }, []);

  const handleSwitchTab = useCallback(
    async (tabId: string) => {
      const request = bufferLoadGuardRef.current.begin();
      const target = fileTabsRef.current.tabs.find((tab) => tab.id === tabId);
      if (!target || target.id === fileTabsRef.current.activeTabId) return;

      // Never make an unloaded tab active before its content is ready. Doing so
      // leaves the old editor buffer visible under the new tab id; a second
      // click then snapshots that old buffer into the wrong tab. The request
      // guard also makes an older slow/UNC read inert after a newer selection.
      let ready = target;
      if (!target.isHydrated && target.filePath) {
        try {
          const content = await readFileByPath(target.filePath);
          if (!bufferLoadGuardRef.current.isCurrent(request)) return;
          fileTabsRef.current.hydrateTab(target.id, content);
          ready = {
            ...target,
            content,
            savedContent: content,
            isDirty: false,
            docJSON: undefined,
          };
        } catch {
          if (bufferLoadGuardRef.current.isCurrent(request)) {
            await messageDialog(`"${target.fileName}" could not be opened.`, {
              title: "File Open Failed",
              kind: "error",
            });
          }
          return;
        }
      }
      if (
        !bufferLoadGuardRef.current.isCurrent(request) ||
        !fileTabsRef.current.tabs.some((tab) => tab.id === tabId)
      ) {
        return;
      }

      // Defensive: don't let the departing tab's pending revert check fire
      // against the arriving tab's state (it would be a no-op today, but
      // only incidentally — see dirty-check.ts).
      if (revertCheckTimerRef.current) clearTimeout(revertCheckTimerRef.current);
      // Source-mode textarea edits need no pre-commit here: the registered
      // content-truth accessors (source-truth.ts) make switchTab's snapshot
      // read the textarea verbatim, and the registered setContent callback
      // re-derives the textarea for the arriving tab.
      const scrollEl = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
      const departingScroll = scrollEl?.scrollTop ?? 0;
      const switched = fileTabsRef.current.switchTab(tabId, departingScroll);
      if (!switched) return;
      fileStateRef.current.restoreState(ready);
      requestAnimationFrame(() => {
        if (!bufferLoadGuardRef.current.isCurrent(request)) return;
        const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
        if (el) el.scrollTop = ready.scrollTop;
      });
    },
    [],
  );

  const saveActiveTab = useCallback(async (saveAs = false): Promise<boolean> => {
    const ft = fileTabsRef.current;
    const fs = fileStateRef.current;
    const tabId = ft.activeTabId;
    const revision = ft.getTabRevision(tabId);
    const beforeSave = fs.getCurrentState();
    const owner = { tabId, revision };
    activeSaveOwnerRef.current = owner;
    try {
      let outcome: SaveOutcome = "failed";
      try {
        outcome = await (saveAs ? fs.handleSaveAs() : fs.handleSave());
      } catch {
        outcome = "failed";
      }
      if (outcome !== "written") {
        // Only a real write failure is worth interrupting for — and it is worth
        // interrupting for even when the document had no path yet, which the
        // old has-a-path gate silently excluded. A cancelled dialog is the
        // user's choice; a superseded write already reached the disk.
        const message = saveOutcomeMessage(outcome, beforeSave.fileName);
        if (message) {
          await messageDialog(message, { title: "Save Failed", kind: "error" });
        }
        return false;
      }
      const current = fs.getCurrentState();
      return ft.markTabSaved(tabId, {
        filePath: current.filePath,
        fileName: current.fileName,
        savedContent: current.savedContent,
        expectedRevision: revision,
      });
    } finally {
      if (activeSaveOwnerRef.current === owner) activeSaveOwnerRef.current = null;
    }
  }, []);
  const saveActiveTabAs = useCallback(() => saveActiveTab(true), [saveActiveTab]);

  /** Ask before a reload throws away unsaved edits. True means go ahead. */
  const confirmDiscardForReload = useCallback(async (candidates: FileTab[]): Promise<boolean> => {
    const prompt = reloadDiscardPrompt(
      candidates.filter((tab) => tab.isDirty).map((tab) => tab.fileName),
    );
    if (!prompt) return true;
    const choice = await confirmModal({
      title: prompt.title,
      message: prompt.message,
      defaultValue: "cancel",
      buttons: [
        { label: "Discard and Reload", value: "discard", variant: "danger" },
        { label: "Cancel", value: "cancel" },
      ],
    });
    return choice === "discard";
  }, []);

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const request = bufferLoadGuardRef.current.begin();
      const tab = fileTabsRef.current.tabs.find((t) => t.id === tabId);
      if (tab && tab.isDirty) {
        const choice = await confirmModal({
          title: "Unsaved Changes",
          message: `"${tab.fileName}" has unsaved changes.`,
          defaultValue: "cancel",
          buttons: [
            { label: "Save", value: "save", variant: "primary" },
            { label: "Don't Save", value: "discard", variant: "danger" },
            { label: "Cancel", value: "cancel" },
          ],
        });
        if (choice === "save") {
          if (tabId === fileTabsRef.current.activeTabId) {
            const saved = await saveActiveTab();
            if (!saved) return;
          } else {
            const revision = fileTabsRef.current.getTabRevision(tab.id);
            const saved = await saveBackgroundTab(tab, { saveToFile, saveFileAs }, () => (
              bufferLoadGuardRef.current.isCurrent(request) &&
              fileTabsRef.current.getTabRevision(tab.id) === revision
            ));
            if (!saved) return;
            if (!fileTabsRef.current.markTabSaved(tab.id, { ...saved, expectedRevision: revision })) {
              return;
            }
          }
        } else if (choice !== "discard") {
          return; // Cancel or dismissed — abort the close.
        }
      }
      if (
        !bufferLoadGuardRef.current.isCurrent(request) ||
        !fileTabsRef.current.tabs.some((candidate) => candidate.id === tabId)
      ) {
        return;
      }

      const currentTabs = fileTabsRef.current.tabs;
      const closingActive = tabId === fileTabsRef.current.activeTabId;
      const closeIndex = currentTabs.findIndex((candidate) => candidate.id === tabId);
      const remaining = currentTabs.filter((candidate) => candidate.id !== tabId);
      const planned = closingActive && remaining.length > 0
        ? remaining[Math.min(closeIndex, remaining.length - 1)] ?? null
        : null;
      let ready = planned;
      if (planned && !planned.content && planned.filePath) {
        try {
          const content = await readFileByPath(planned.filePath);
          if (!bufferLoadGuardRef.current.isCurrent(request)) return;
          fileTabsRef.current.hydrateTab(planned.id, content);
          ready = {
            ...planned,
            content,
            savedContent: content,
            isDirty: false,
            docJSON: undefined,
          };
        } catch {
          if (bufferLoadGuardRef.current.isCurrent(request)) {
            await messageDialog(`"${planned.fileName}" could not be opened.`, {
              title: "File Open Failed",
              kind: "error",
            });
          }
          return;
        }
      }
      if (!bufferLoadGuardRef.current.isCurrent(request)) return;

      const { switchTo } = fileTabsRef.current.closeTab(tabId);
      if (switchTo) {
        fileStateRef.current.restoreState(ready ?? switchTo);
        requestAnimationFrame(() => {
          if (!bufferLoadGuardRef.current.isCurrent(request)) return;
          const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
          if (el) el.scrollTop = (ready ?? switchTo).scrollTop;
        });
      }
    },
    [saveActiveTab],
  );
  handleCloseTabRef.current = handleCloseTab;

  // Tab right-click context-menu actions. Path ops use the shared WebView2-safe
  // clipboard helper + the opener reveal helper; Close routes through the
  // unsaved-changes-guarded handleCloseTab (never a raw close).
  const handleTabAction = useCallback(
    async (action: TabAction, tab: FileTab) => {
      if (action === "copy-path") {
        if (tab.filePath) await copyToClipboard(tab.filePath);
      } else if (action === "copy-name") {
        await copyToClipboard(tab.fileName);
      } else if (action === "reveal") {
        if (tab.filePath) await revealInFileManager(tab.filePath);
      } else if (action === "close") {
        void handleCloseTab(tab.id);
      }
    },
    [handleCloseTab],
  );

  const saveAllDirtyTabs = useCallback(async (): Promise<boolean> => {
    const ft = fileTabsRef.current;
    const activeTabId = ft.activeTabId;
    const activeTab = ft.tabs.find((tab) => tab.id === activeTabId);
    // Save the active buffer before any awaited background write. handleSave is
    // revision-bound inside useFileState; a tab switch or edit during the write
    // returns false rather than accidentally saving whichever tab is current.
    if (activeTab?.isDirty) {
      if (!await saveActiveTab()) return false;
    }

    // Each inactive write carries its tab revision through the await. A stale
    // completion is a failed Save All, never permission to close a newer buffer.
    const dirtyTabs = ft.tabs.filter((tab) => tab.isDirty && tab.id !== activeTabId);
    for (const tab of dirtyTabs) {
      const revision = ft.getTabRevision(tab.id);
      const saved = await saveBackgroundTab(tab, { saveToFile, saveFileAs }, () => (
        fileTabsRef.current.getTabRevision(tab.id) === revision
      ));
      if (!saved) return false;
      if (!ft.markTabSaved(tab.id, { ...saved, expectedRevision: revision })) return false;
    }
    // Read the synchronous snapshot: markTabSaved has already settled there,
    // while the rendered array still carries the pre-save dirty flags.
    return !fileTabsRef.current.getTabsSnapshot().some((tab) => tab.isDirty) &&
      !fileStateRef.current.getCurrentState().isDirty;
  }, [saveActiveTab]);

  const handleCloseAllTabs = useCallback(async () => {
    const dirtyTabs = fileTabsRef.current.tabs.filter((t) => t.isDirty);
    if (dirtyTabs.length > 0) {
      const choice = await confirmModal({
        title: "Unsaved Changes",
        message: `${dirtyTabs.length} file(s) have unsaved changes.`,
        defaultValue: "cancel",
        buttons: [
          { label: "Save All", value: "save", variant: "primary" },
          { label: "Don't Save", value: "discard", variant: "danger" },
          { label: "Cancel", value: "cancel" },
        ],
      });
      if (choice === "save") {
        if (!await saveAllDirtyTabs()) return;
      } else if (choice !== "discard") {
        return; // Cancel or dismissed — abort the close.
      }
    }
    bufferLoadGuardRef.current.invalidate();
    const { switchTo } = fileTabsRef.current.closeAllTabs();
    fileStateRef.current.restoreState(switchTo);
  }, [saveAllDirtyTabs]);

  // Desktop quit guard.
  //
  // Closing the window discarded every unsaved buffer in silence: beforeunload
  // is inert in a Tauri window, autosave only ever runs for a NAMED file 30s
  // after an edit, and the persisted session stores metadata only — so an
  // untitled buffer full of pasted notes simply ceased to exist. The historical
  // reason there was no handler here was that window.confirm is suppressed by
  // WebView2 inside a close-requested handler; confirmModal is an in-app React
  // modal and is not affected, and is already what Ctrl+W and Close All use.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (cancelled) return;
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested(async (event) => {
        // Second pass after the user confirmed: let it through.
        if (quitConfirmedRef.current) return;
        const dirty = fileTabsRef.current.tabs.filter((t) => t.isDirty);
        if (dirty.length === 0) return;
        // Hold the window open while we ask; destroy() below bypasses this
        // handler so the second pass cannot re-prompt.
        event.preventDefault();
        const choice = await confirmModal({
          title: "Unsaved Changes",
          message:
            dirty.length === 1
              ? `"${dirty[0]!.fileName}" has unsaved changes.`
              : `${dirty.length} files have unsaved changes.`,
          defaultValue: "cancel",
          buttons: [
            { label: "Save All", value: "save", variant: "primary" },
            { label: "Don't Save", value: "discard", variant: "danger" },
            { label: "Cancel", value: "cancel" },
          ],
        });
        if (choice === "save") {
          // saveAllDirtyTabs reports false for a failed or cancelled write —
          // quitting then would discard exactly the work the user asked to keep.
          if (!(await saveAllDirtyTabs())) return;
        } else if (choice !== "discard") {
          return;
        }
        quitConfirmedRef.current = true;
        try {
          await appWindow.destroy();
        } catch {
          // destroy() is ACL-gated; if the permission is ever dropped, fall back
          // to close(), which re-enters this handler and passes the ref check
          // above rather than leaving the window permanently unclosable.
          await appWindow.close();
        }
      });
      if (cancelled) {
        unlisten();
        unlisten = null;
      }
    })();

    return () => { cancelled = true; unlisten?.(); };
  }, [saveAllDirtyTabs]);

  const handleNewTab = useCallback(() => {
    bufferLoadGuardRef.current.invalidate();
    fileTabsRef.current.newTab();
    fileStateRef.current.handleNew();
    requestAnimationFrame(() => {
      const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
      if (el) el.scrollTop = 0;
    });
  }, []);

  const handleOpenFile = useCallback(async (defaultPath?: string) => {
    const request = bufferLoadGuardRef.current.begin();
    let opened: Awaited<ReturnType<typeof openFile>>;
    try {
      opened = await openFile(defaultPath);
    } catch {
      if (bufferLoadGuardRef.current.isCurrent(request)) {
        await messageDialog("The selected file could not be opened.", {
          title: "File Open Failed",
          kind: "error",
        });
      }
      return;
    }
    if (!opened || !bufferLoadGuardRef.current.isCurrent(request)) return;

    const existing = fileTabsRef.current.tabs.find((tab) => samePath(tab.filePath, opened.path));
    if (existing) {
      await handleSwitchTab(existing.id);
      return;
    }
    fileTabsRef.current.openInTab(opened.name, opened.path, opened.content);
    await fileStateRef.current.handleOpenByPath(opened.path, opened.content);
  }, [handleSwitchTab]);

  const handleReopenClosedTab = useCallback(async () => {
    const request = bufferLoadGuardRef.current.begin();
    const { tab } = fileTabsRef.current.reopenLastClosed();
    if (!tab) return;
    // Untitled tabs are inserted directly by reopenLastClosed; hydrate the editor.
    if (!tab.filePath) {
      fileStateRef.current.restoreState(tab);
      return;
    }
    // Named file — read from disk and route through openInTab.
    try {
      const content = await readFileByPath(tab.filePath);
      if (!bufferLoadGuardRef.current.isCurrent(request)) {
        fileTabsRef.current.restoreClosedTab(tab);
        return;
      }
      const { tab: inserted } = fileTabsRef.current.openInTab(tab.fileName, tab.filePath, content);
      fileStateRef.current.restoreState(inserted);
      requestAnimationFrame(() => {
        if (!bufferLoadGuardRef.current.isCurrent(request)) return;
        const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
        if (el) el.scrollTop = tab.scrollTop;
      });
    } catch {
      // File is gone — silently drop. The stack entry is already popped.
    }
  }, []);

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      const t = fileTabs.tabs;
      if (t.length <= 1) return;
      const idx = t.findIndex((tab) => tab.id === fileTabs.activeTabId);
      const nextIdx = (idx + direction + t.length) % t.length;
      const next = t[nextIdx];
      if (next) handleSwitchTab(next.id);
    },
    [fileTabs.tabs, fileTabs.activeTabId, handleSwitchTab],
  );

  // Ctrl+K: add / edit / remove a link on the selection (or insert a linked URL).
  const handleEditLink = useCallback(async () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const input = await promptModal({
      title: prev ? "Edit Link" : "Add Link",
      label: "URL",
      defaultValue: prev ?? "",
      placeholder: "https://…  (leave empty to remove)",
      okLabel: prev ? "Update" : "Add",
    });
    if (input === null) return; // cancelled
    const url = normalizeUrl(input);
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const { from, to } = editor.state.selection;
    if (from !== to || prev) {
      // A selection, or the caret on an existing link → (re)link that range.
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    } else {
      // No selection: link the word under the caret if there is one; otherwise
      // drop the URL in as its own linked text.
      const word = wordRangeAt(editor.state.doc, from);
      if (word) {
        editor.chain().focus().setTextSelection(word).setLink({ href: url }).run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "text",
            text: input.trim(),
            marks: [{ type: "link", attrs: { href: url } }],
          })
          .run();
      }
    }
  }, [editor]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "F3") {
          e.preventDefault();
          // Ctrl+F3: search the selection / word under the caret — from the
          // textarea in source mode, from the PM doc in rendered mode.
          let term = "";
          if (sourceModeRef.current) {
            const ta = document.querySelector<HTMLTextAreaElement>(".markd-source-textarea");
            if (ta) {
              term =
                ta.selectionStart !== ta.selectionEnd
                  ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
                  : wordAt(ta.value, ta.selectionStart);
            }
          } else if (editor) {
            const { from, to } = editor.state.selection;
            if (from !== to) {
              term = editor.state.doc.textBetween(from, to);
            } else {
              const $pos = editor.state.doc.resolve(from);
              term = wordAt($pos.parent.textContent, $pos.parentOffset);
            }
          }
          if (term) {
            // Seed the per-tab find state so the panel mounts prefilled with
            // this term; the find-seed event covers the already-open case.
            const prev = findStateMapRef.current.get(fileTabs.activeTabId);
            findStateMapRef.current.set(fileTabs.activeTabId, {
              searchTerm: term,
              replaceTerm: prev?.replaceTerm ?? "",
              caseSensitive: prev?.caseSensitive ?? false,
              useRegex: prev?.useRegex ?? false,
              wholeWord: prev?.wholeWord ?? false,
            });
            window.dispatchEvent(new CustomEvent("markd:find-seed", { detail: term }));
            setFindReplaceOpen(true);
            setFindReplaceShowReplace(false);
            window.dispatchEvent(new Event("markd:find-focus"));
          }
          return;
        }

        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        switch (key) {
          case "s":
            e.preventDefault();
            if (e.shiftKey) {
              // Ctrl+Shift+S: save all dirty tabs
              void saveAllDirtyTabs();
            } else {
              void saveActiveTab();
            }
            break;
          case "r":
            e.preventDefault();
            if (e.shiftKey) {
              // Ctrl+Shift+R: reload all tabs from disk
              (async () => {
                if (!(await confirmDiscardForReload(fileTabsRef.current.tabs))) return;
                const request = bufferLoadGuardRef.current.begin();
                const ft = fileTabsRef.current;
                const fs = fileStateRef.current;
                const activeTabId = ft.activeTabId;
                const tabs = ft.tabs.map((tab) => ({ tab, revision: ft.getTabRevision(tab.id) }));
                for (const { tab, revision } of tabs) {
                  if (!tab.filePath) continue;
                  try {
                    const content = await readFileByPath(tab.filePath);
                    if (!bufferLoadGuardRef.current.isCurrent(request)) return;
                    if (!ft.hydrateTab(tab.id, content, revision)) continue;
                    if (tab.id === activeTabId && ft.activeTabId === activeTabId) {
                      await fs.handleOpenByPath(tab.filePath, content);
                    }
                  } catch { /* file gone */ }
                }
              })();
            } else {
              // Ctrl+R: reload active tab from disk
              const active = fileTabsRef.current.tabs.find(
                (t) => t.id === fileTabsRef.current.activeTabId,
              );
              if (active?.filePath) {
                (async () => {
                  if (!(await confirmDiscardForReload([active]))) return;
                  const request = bufferLoadGuardRef.current.begin();
                  const revision = fileTabsRef.current.getTabRevision(active.id);
                  try {
                    const content = await readFileByPath(active.filePath!);
                    if (
                      !bufferLoadGuardRef.current.isCurrent(request) ||
                      fileTabsRef.current.activeTabId !== active.id ||
                      !fileTabsRef.current.hydrateTab(active.id, content, revision)
                    ) {
                      return;
                    }
                    await fileStateRef.current.handleOpenByPath(active.filePath!, content);
                  } catch { /* file gone */ }
                })();
              }
            }
            break;
          case "o":
            e.preventDefault();
            void handleOpenFile();
            break;
          case "n":
            e.preventDefault();
            handleNewTab();
            break;
          case "\\":
            e.preventDefault();
            setSidebarCollapsed((c) => !c);
            break;
          case "f":
            e.preventDefault();
            setFindReplaceShowReplace(false);
            setFindReplaceOpen(true);
            window.dispatchEvent(new Event("markd:find-focus"));
            break;
          case "h":
            e.preventDefault();
            setFindReplaceShowReplace(true);
            setFindReplaceOpen(true);
            break;
          case "/":
            e.preventDefault();
            handleToggleSource();
            break;
          case "w":
            e.preventDefault();
            if (e.shiftKey) {
              handleCloseAllTabs();
            } else {
              handleCloseTab(fileTabs.activeTabId);
            }
            break;
          case "Tab":
            e.preventDefault();
            cycleTab(e.shiftKey ? -1 : 1);
            break;
          case "t":
            e.preventDefault();
            if (e.shiftKey) {
              void handleReopenClosedTab();
            } else {
              handleNewTab();
            }
            break;
          case "=":
          case "+":
            e.preventDefault();
            zoomIn();
            break;
          case "-":
            e.preventDefault();
            zoomOut();
            break;
          case "0":
            e.preventDefault();
            resetZoom();
            break;
          case " ":
            // Ctrl+Space: snippet picker. Guard IME composition (Ctrl+Space also
            // toggles some input methods) so we don't fight it. Capture the source
            // textarea caret now, before the picker steals focus.
            if (e.isComposing) break;
            e.preventDefault();
            {
              const ta = document.querySelector(".markd-source-textarea") as HTMLTextAreaElement | null;
              sourceCaretRef.current = ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
            }
            setSnippetPickerOpen((o) => !o);
            break;
          case "k":
            e.preventDefault();
            // Source mode: the link editor mutates the hidden PM doc — inert.
            if (sourceModeRef.current) break;
            void handleEditLink();
            break;
          case "e":
            // Ctrl+Shift+E: quick-switch tabs. Bare Ctrl+E stays TipTap's inline
            // code (Mod-e) — only the Shift variant opens the switcher, and PM has
            // no Mod-Shift-e binding so there's no double-fire. No-op for 1 tab.
            if (e.shiftKey) {
              if (fileTabsRef.current.tabs.length <= 1) break;
              e.preventDefault();
              setTabSwitcherOpen((o) => !o);
            }
            break;
          case "p":
            // Ctrl+Shift+P only — bare Ctrl+P stays the webview's native print.
            if (e.shiftKey) {
              e.preventDefault();
              setCommandPaletteOpen((o) => !o);
            }
            break;
        }
      }

      if (e.altKey && !e.ctrlKey) {
        if (e.key === "1") {
          e.preventDefault();
          setSidebarTab("files");
          setSidebarCollapsed(false);
        } else if (e.key === "2") {
          e.preventDefault();
          setSidebarTab("outline");
          setSidebarCollapsed(false);
        }
      }

      if (e.key === "F3") {
        e.preventDefault();
        // Backend-routed: works in both modes, panel open or closed (the
        // backend retains the term; lastSearchTermRef covers a fresh backend).
        const backend = searchBackendRef.current;
        if (!backend) return;
        const fallback = lastSearchTermRef.current || undefined;
        if (e.shiftKey) backend.findPrevious(fallback);
        else backend.findNext(fallback);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    saveAllDirtyTabs,
    saveActiveTab,
    confirmDiscardForReload,
    handleOpenFile,
    handleToggleSource,
    handleCloseTab,
    handleCloseAllTabs,
    handleNewTab,
    handleReopenClosedTab,
    cycleTab,
    fileTabs.activeTabId,
    zoomIn,
    zoomOut,
    resetZoom,
    handleEditLink,
  ]);

  // Ctrl+MouseWheel zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [zoomIn, zoomOut]);

  // Show modifier-specific hotkey hints while Ctrl or Alt is held.
  // Reads e.ctrlKey/e.altKey (physical state) instead of matching e.key,
  // preventing desync when Windows menu bar activation swallows keyup.
  useEffect(() => {
    const sync = (e: KeyboardEvent) => {
      if (e.key === "Alt") e.preventDefault();
      if (e.ctrlKey && !e.altKey) setHeldModifier("ctrl");
      else if (e.altKey && !e.ctrlKey) setHeldModifier("alt");
      else setHeldModifier(null);
    };
    const blur = () => setHeldModifier(null);
    window.addEventListener("keydown", sync, true);
    window.addEventListener("keyup", sync, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", sync, true);
      window.removeEventListener("keyup", sync, true);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      lastSearchTermRef.current = (e as CustomEvent).detail;
    };
    window.addEventListener("markd:search-term", handler);
    return () => window.removeEventListener("markd:search-term", handler);
  }, []);

  // Detect external file modifications on the active tab via a NATIVE OS
  // filesystem watcher (Rust `notify` crate = ReadDirectoryChangesW on Windows,
  // the same mechanism Notepad++ uses). It fires the instant the file changes
  // regardless of window focus/foreground — unlike the old mtime poll (throttled
  // when backgrounded) + focus-event approach, which never reliably fired. The
  // Rust side emits `file-changed-on-disk`; we then compare on-disk CONTENT to
  // what Markd last loaded/saved. Content comparison (not mtime) means our OWN
  // saves never false-prompt (after a save, disk === savedContent).
  const fileChangePromptOpen = useRef(false);
  useEffect(() => {
    const filePath = fileState.filePath;
    if (!isTauri() || !filePath) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    const check = async () => {
      if (cancelled || fileChangePromptOpen.current) return;
      let onDisk: string | null = null;
      try {
        onDisk = await readFileByPath(filePath);
      } catch {
        onDisk = null; // read failed — could be a real deletion or a transient race
      }
      if (cancelled) return;

      // Read failed: the file may have been deleted/moved, or the read just raced
      // an atomic save (write-temp + rename). A definitive existence check tells
      // them apart — only a true deletion prompts.
      if (onDisk === null) {
        let exists = true;
        try {
          exists = await pathExists(filePath);
        } catch {
          exists = true; // can't determine → don't nag
        }
        // Bail if torn down meanwhile — e.g. the user trashed this file from the
        // sidebar, which detaches it (filePath→null) and re-runs this effect.
        if (cancelled || fileStateRef.current.filePath !== filePath) return;
        if (!shouldPromptForDeletion(exists, fileChangePromptOpen.current)) return;
        fileChangePromptOpen.current = true;
        try {
          const keep = await askDialog(
            `"${fileStateRef.current.fileName}" no longer exists on disk — it may have been deleted or moved.\n\nKeep it open in the editor? It becomes an unsaved document you can re-save anywhere.`,
            { title: "File Deleted", kind: "warning", okLabel: "Keep in Editor", cancelLabel: "Close Tab" },
          );
          if (keep) {
            // Detach from the now-missing path: the buffer becomes the only copy
            // — kept dirty + close-guarded, autosave timer cancelled, and the
            // watcher torn down (filePath→null re-runs this effect). Same
            // primitive the sidebar trash uses.
            fileStateRef.current.detachActiveFile();
          } else {
            await handleCloseTabRef.current(fileTabsRef.current.activeTabId);
          }
        } finally {
          fileChangePromptOpen.current = false;
        }
        return;
      }

      if (
        !shouldPromptForExternalChange(
          onDisk,
          fileStateRef.current.savedContent,
          fileChangePromptOpen.current,
        )
      )
        return;
      fileChangePromptOpen.current = true;
      try {
        const reload = await askDialog(
          `"${fileStateRef.current.fileName}" has been modified outside Markd.\n\nReload from disk?`,
          { title: "File Changed on Disk", kind: "warning" },
        );
        if (reload) {
          const request = bufferLoadGuardRef.current.begin();
          const ft = fileTabsRef.current;
          const activeTabId = ft.activeTabId;
          const revision = ft.getTabRevision(activeTabId);
          if (
            cancelled ||
            fileStateRef.current.filePath !== filePath ||
            !bufferLoadGuardRef.current.isCurrent(request) ||
            !ft.hydrateTab(activeTabId, onDisk, revision)
          ) {
            return;
          }
          await fileStateRef.current.handleOpenByPath(filePath, onDisk);
        }
      } finally {
        // Reset in finally so a thrown dialog can't permanently wedge the watcher.
        fileChangePromptOpen.current = false;
      }
    };

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");
        if (cancelled) return;
        unlisten = await listen("file-changed-on-disk", () => void check());
        if (cancelled) {
          unlisten();
          return;
        }
        // Re-check whenever Markd regains focus (alt-tab back from another editor).
        // The native window-focus event is reliable in WebView2 and guarantees
        // detection of a change made while Markd was backgrounded — independent of
        // the live watcher's longevity across atomic saves (Notepad++ et al.).
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (!cancelled) {
          unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (focused) void check();
          });
          if (cancelled) unlistenFocus?.();
        }
        // Best-effort live watch. ReadDirectoryChangesW (notify) can fail on some
        // network / UNC (\\wsl.localhost\...) filesystems — detection must NOT
        // depend on it, so its failure is caught separately and the initial check
        // below still runs.
        try {
          await invoke("watch_file", { path: filePath });
        } catch (e) {
          console.error("[file-watcher] live watch unavailable for this path:", e);
        }
        // The live watcher only fires on FUTURE events, and may be unavailable
        // (UNC). Always run an initial content check on arm — this catches a
        // change that happened while the file was unwatched: another tab was
        // active, the app was starting, or the filesystem can't be watched. It is
        // what makes switching to a tab whose file changed externally prompt.
        if (!cancelled) void check();
      } catch (e) {
        // Surface arm-time failures instead of swallowing them (a silent catch
        // hid the dead watcher across multiple releases).
        console.error("[file-watcher] failed to arm:", e);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      unlistenFocus?.();
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("unwatch_file"))
        .catch(() => {});
    };
  }, [fileState.filePath, fileState.fileName]);

  // Check for updates. `manual` surfaces "you're up to date" and errors via a
  // dialog; the startup check stays quiet on no-update but NEVER swallows a
  // thrown check() silently — a swallowed error hid a broken updater (a build
  // compiled without the updater capability) for 21 days.
  const checkForUpdates = useCallback(async (manual: boolean) => {
    if (!isTauri()) {
      if (manual) {
        const { message } = await import("@tauri-apps/plugin-dialog");
        await message("Updates are only available in the desktop app.", {
          title: "Check for Updates",
          kind: "info",
        });
      }
      return;
    }
    if (
      !manual &&
      !shouldCheckForUpdate(
        localStorage.getItem("markd-update-check"),
        __APP_VERSION__,
        Date.now(),
      )
    ) {
      return;
    }

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { message } = await import("@tauri-apps/plugin-dialog");
      const update = await check();
      // Record only AFTER a successful check, so a thrown check() keeps
      // retrying rather than being debounced away with a stale marker.
      localStorage.setItem(
        "markd-update-check",
        makeUpdateCheckRecord(__APP_VERSION__, Date.now()),
      );
      if (!update) {
        if (manual) {
          await message(`You're on the latest version — Markd ${__APP_VERSION__}.`, {
            title: "No Updates Available",
            kind: "info",
          });
        }
        return;
      }

      // Honor "Skip This Version" on automatic checks only — a manual check is
      // an explicit ask, so a stored skip must never silently eat its result.
      if (
        !shouldOfferUpdate(update.version, localStorage.getItem(UPDATE_SKIP_KEY), manual)
      ) {
        return;
      }

      // In-app modal (not dialog.ask) so we get three buttons; immune to
      // WebView2 native-dialog gating like the rest of the modal system.
      const choice = await confirmModal({
        title: "Update Available",
        message: `Markd ${update.version} is available.\nThe app will close to install and reopen automatically.`,
        buttons: [
          { label: "Install Now", value: "install", variant: "primary" },
          { label: "Remind Me Later", value: "later" },
          { label: "Skip This Version", value: "skip" },
        ],
        defaultValue: "install",
      });
      if (choice === "skip") {
        localStorage.setItem(UPDATE_SKIP_KEY, update.version);
        return;
      }
      // "later" and Esc are both no-ops: the next eligible check re-prompts.
      // Deliberately NOT clearing a stored skip here — "later" is the weaker
      // choice and must never silently erase an explicit same-version skip
      // (re-prompted via manual check); stale skips are inert by exact-match.
      if (choice !== "install") return;
      await update.downloadAndInstall();
    } catch (err) {
      console.error("Update check failed:", err);
      if (manual) {
        const { message } = await import("@tauri-apps/plugin-dialog");
        await message(`Update check failed:\n${err}`, {
          title: "Update Error",
          kind: "error",
        });
      }
    }
  }, []);

  // Auto-update check on startup (debounced to 1 hour).
  useEffect(() => {
    void checkForUpdates(false);
  }, [checkForUpdates]);

  const handleFileSelectWithTabs = useCallback(
    async (entry: { kind: string; name: string; path: string }) => {
      if (entry.kind !== "file") return;
      const request = bufferLoadGuardRef.current.begin();
      const existing = fileTabsRef.current.tabs.find((t) => samePath(t.filePath, entry.path));
      if (existing) {
        await handleSwitchTab(existing.id);
        return;
      }
      let content: string;
      try {
        content = await readFileByPath(entry.path);
      } catch {
        if (bufferLoadGuardRef.current.isCurrent(request)) {
          await messageDialog(`"${entry.name}" could not be opened.`, {
            title: "File Open Failed",
            kind: "error",
          });
        }
        return;
      }
      if (!bufferLoadGuardRef.current.isCurrent(request)) return;
      fileTabsRef.current.openInTab(entry.name, entry.path, content);
      await fileStateRef.current.handleOpenByPath(entry.path, content);
    },
    [handleSwitchTab],
  );

  const handleRecentFileSelect = useCallback(
    async (file: { name: string; path: string }) => {
      const request = bufferLoadGuardRef.current.begin();
      const existing = fileTabsRef.current.tabs.find((t) => samePath(t.filePath, file.path));
      if (existing) {
        await handleSwitchTab(existing.id);
        return;
      }
      // Read the content FIRST, then seed it into both the tab and the editor in
      // one synchronous step (the proven open path — see the initial-load and
      // single-instance handlers). The previous form passed "" to openInTab and
      // relied on a separate handleOpenByPath read, leaving the new tab's content
      // empty across the async gap. An authorization failure is not proof that
      // the file is gone: it may be a legacy entry from before persisted scopes.
      let content: string;
      try {
        content = await readFileByPath(file.path);
      } catch (error) {
        if (!bufferLoadGuardRef.current.isCurrent(request)) return;
        if (isPathAuthorizationError(error)) {
          await handleOpenFile(file.path);
          return;
        }
        removeRecentFile(file.path);
        await messageDialog(`"${file.name}" no longer exists — removed from Recent Files.`, {
          title: "File Not Found",
          kind: "warning",
        });
        return;
      }
      if (!bufferLoadGuardRef.current.isCurrent(request)) return;
      fileTabsRef.current.openInTab(file.name, file.path, content);
      await fileStateRef.current.handleOpenByPath(file.path, content);
    },
    [handleOpenFile, handleSwitchTab, removeRecentFile],
  );

  // File-tree CRUD from the sidebar context menu. The data-safety rule: when the
  // ACTIVE file is renamed/trashed, update useFileState's path (or detach it) so
  // the 30s autosave can't write to / resurrect the old path, and keep the open
  // tab's label in sync. All four ops go through Rust (file-system.ts).
  const handleFileAction = useCallback(
    async (action: FileTreeAction, entry: { kind: string; name: string; path: string } | null) => {
      // Path ops are root-independent — handle them before the open-folder guard.
      if (action === "copy-path") {
        if (entry) await copyToClipboard(entry.path);
        return;
      }
      if (action === "reveal") {
        if (entry) await revealInFileManager(entry.path);
        return;
      }
      const root = fileState.dirRoot;
      if (!root) return;
      const showError = (msg: string) =>
        confirmModal({
          title: "File operation failed",
          message: msg,
          buttons: [{ label: "OK", value: "ok" }],
          defaultValue: "ok",
        });
      try {
        if (action === "new-file" || action === "new-folder") {
          const dir = targetDirForEntry(
            entry ? { path: entry.path, isDirectory: entry.kind === "directory" } : null,
            root,
          );
          const isFile = action === "new-file";
          const name = await promptModal({
            title: isFile ? "New file" : "New folder",
            label: "Name",
            placeholder: isFile ? "notes.md" : "folder",
            okLabel: "Create",
            validate: validateName,
          });
          if (name == null) return;
          const finalName = isFile ? ensureMdExtension(name.trim()) : name.trim();
          const targetPath = joinPath(dir, finalName);
          if (isFile) {
            await createFile(targetPath);
            await fileState.refreshTree();
            await handleFileSelectWithTabs({ kind: "file", name: finalName, path: targetPath });
          } else {
            await createFolder(targetPath);
            await fileState.refreshTree();
          }
        } else if (action === "rename" && entry) {
          const next = await promptModal({
            title: `Rename "${entry.name}"`,
            label: "New name",
            defaultValue: entry.name,
            okLabel: "Rename",
            validate: validateName,
          });
          if (next == null || next.trim() === entry.name) return;
          const finalName = entry.kind === "file" ? ensureMdExtension(next.trim()) : next.trim();
          const newPath = joinPath(parentPath(entry.path), finalName);
          await renamePath(entry.path, newPath);
          if (samePath(fileState.filePath, entry.path)) {
            fileState.updateActiveFilePath(newPath, finalName);
            fileTabs.updateTabPath(fileTabs.activeTabId, newPath, finalName);
          } else {
            const t = fileTabs.tabs.find((tab) => samePath(tab.filePath, entry.path));
            if (t) fileTabs.updateTabPath(t.id, newPath, finalName);
          }
          await fileState.refreshTree();
        } else if (action === "delete" && entry) {
          const choice = await confirmModal({
            title: "Delete",
            message: `Move "${entry.name}" to the recycle bin?`,
            buttons: [
              { label: "Delete", value: "delete", variant: "danger" },
              { label: "Cancel", value: "cancel" },
            ],
            defaultValue: "cancel",
          });
          if (choice !== "delete") return;
          await trashPath(entry.path);
          // Detach EVERY open tab under the trashed path, not just the active
          // one. A dirty background tab kept its filePath, so the next Save All
          // wrote it straight back — recreating the file the user had just sent
          // to the recycle bin, with no prompt.
          if (isPathInside(fileState.filePath, entry.path)) fileState.detachActiveFile();
          for (const tab of fileTabsRef.current.tabs) {
            if (isPathInside(tab.filePath, entry.path)) {
              fileTabsRef.current.updateTabPath(tab.id, null, tab.fileName);
            }
          }
          await fileState.refreshTree();
        }
      } catch (e) {
        await showError(e instanceof Error ? e.message : String(e));
      }
    },
    [
      fileState.dirRoot,
      fileState.filePath,
      fileState.refreshTree,
      fileState.updateActiveFilePath,
      fileState.detachActiveFile,
      fileTabs.tabs,
      fileTabs.updateTabPath,
      fileTabs.activeTabId,
      handleFileSelectWithTabs,
    ],
  );

  const handleCloseFindReplace = useCallback(() => {
    setFindReplaceOpen(false);
    editor?.commands.clearDecorations();
  }, [editor]);

  // Footer filename mirrors the active tab's label (incl. the parent-dir
  // disambiguation prefix) so the two never disagree.
  const footerFileName = useMemo(() => {
    const d = tabDisplayInfo(fileTabs.tabs).get(fileTabs.activeTabId);
    if (!d) return fileState.fileName;
    return d.parentDir ? `${d.parentDir}/${d.fileName}` : d.fileName;
  }, [fileTabs.tabs, fileTabs.activeTabId, fileState.fileName]);

  return (
    <div className="markd-app" data-mod={heldModifier ?? undefined}>
      <Sidebar
        tree={fileState.dirTree}
        activeFile={fileState.fileName}
        activeFilePath={fileState.filePath}
        collapsed={sidebarCollapsed}
        editor={editor}
        sourceHeadings={sourceHeadings}
        onSourceHeadingClick={handleSourceHeadingClick}
        recentFiles={recentFiles}
        activeTab={sidebarTab}
        onTabChange={setSidebarTab}
        heldModifier={heldModifier}
        onFileSelect={handleFileSelectWithTabs}
        onOpenFolder={fileState.handleOpenFolder}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        onRecentFileSelect={handleRecentFileSelect}
        onRecentFileRemove={removeRecentFile}
        canEditTree={!!fileState.dirRoot}
        onFileAction={handleFileAction}
      />
      <div className="markd-editor-area">
        <TabBar
          tabs={fileTabs.tabs}
          activeTabId={fileTabs.activeTabId}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
          onTabAction={handleTabAction}
        />
        <Menubar
          editor={editor}
          sidebarCollapsed={sidebarCollapsed}
          sourceMode={sourceMode}
          focusMode={focusMode}
          fullWidth={fullWidth}
          activeTheme={activeTheme}
          themes={themes}
          onNew={handleNewTab}
          onOpen={handleOpenFile}
          onOpenFolder={fileState.handleOpenFolder}
          onSave={saveActiveTab}
          onSaveAs={saveActiveTabAs}
          onExportHtml={handleExportHtml}
          onExportPdf={exportAsPdf}
          onFind={() => {
            setFindReplaceShowReplace(false);
            setFindReplaceOpen(true);
          }}
          onReplace={() => {
            setFindReplaceShowReplace(true);
            setFindReplaceOpen(true);
          }}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          onToggleSource={handleToggleSource}
          onToggleFocusMode={() => setFocusMode((f) => !f)}
          onToggleFullWidth={toggleFullWidth}
          onThemeSelect={(id) => switchTheme(id as typeof activeTheme)}
          onCheckForUpdates={() => checkForUpdates(true)}
          onNewTab={handleNewTab}
          onCloseTab={() => handleCloseTab(fileTabs.activeTabId)}
          onNextTab={() => cycleTab(1)}
          onPrevTab={() => cycleTab(-1)}
        />
        <div className="markd-topbar">
          {sidebarCollapsed && (
            <button
              className="markd-sidebar-toggle"
              onClick={() => setSidebarCollapsed(false)}
              title="Show Sidebar (Ctrl+\)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="2" width="4" height="12" rx="1" opacity="0.3" />
                <rect x="6" y="2" width="9" height="12" rx="1" opacity="0.6" />
              </svg>
            </button>
          )}
          <Toolbar editor={editor} heldModifier={heldModifier} disabled={sourceMode} />
        </div>
        <div className="markd-editor-content">
          {findReplaceOpen && (
            <FindReplace
              key={`${fileTabs.activeTabId}:${sourceMode ? "src" : "wys"}`}
              backend={searchBackend}
              showReplace={findReplaceShowReplace}
              onClose={handleCloseFindReplace}
              initialState={findStateMapRef.current.get(fileTabs.activeTabId)}
              onStateChange={(s) => {
                findStateMapRef.current.set(fileTabs.activeTabId, s);
              }}
            />
          )}
          {sourceMode ? (
            <SourceEditor
              markdown={sourceMarkdown}
              onMarkdownChange={handleSourceMarkdownChange}
              lineNumbers={lineNumbers}
              searchRanges={sourceSearchView?.ranges ?? null}
              searchCurrent={sourceSearchView?.current ?? -1}
            />
          ) : (
            <Editor
              editor={editor}
              focusMode={focusMode}
            />
          )}
        </div>
        <StatusBar
          fileName={footerFileName}
          filePath={fileState.filePath}
          statsBaseline={statsBaseline}
          isDirty={fileState.isDirty}
          theme={activeTheme}
          lastSaved={fileState.lastSaved}
          sourceMode={sourceMode}
          focusMode={focusMode}
          fullWidth={fullWidth}
          onThemeChange={handleThemeToggle}
          onExportHtml={handleExportHtml}
          onExportPdf={exportAsPdf}
          onToggleSource={handleToggleSource}
          onToggleFocusMode={() => setFocusMode((f) => !f)}
          onToggleFullWidth={toggleFullWidth}
          lineNumbers={lineNumbers}
          onToggleLineNumbers={toggleLineNumbers}
          zoom={zoom}
        />
      </div>
      <ContextMenu editor={editor} />
      <ModalHost />
      <TabSwitcher
        open={tabSwitcherOpen}
        tabs={fileTabs.tabs}
        getMru={fileTabs.getMru}
        onSwitch={(id) => {
          void handleSwitchTab(id);
        }}
        onClose={() => setTabSwitcherOpen(false)}
      />
      <SnippetPicker
        open={snippetPickerOpen}
        snippets={snippets}
        onInsert={insertSnippet}
        onManage={() => {
          setSnippetPickerOpen(false);
          setSnippetManagerAdd(true); // picker → land on the add form
          setSnippetManagerOpen(true);
        }}
        onClose={() => setSnippetPickerOpen(false)}
      />
      <SnippetManager
        open={snippetManagerOpen}
        snippets={snippets}
        startInAdd={snippetManagerAdd}
        onAdd={addSnippet}
        onUpdate={updateSnippet}
        onDelete={deleteSnippet}
        onReset={resetSnippets}
        onClose={() => setSnippetManagerOpen(false)}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={[
          { id: "new", label: "New File", hint: "Ctrl+N", keywords: "create blank", run: handleNewTab },
          { id: "new-tab", label: "New Tab", hint: "Ctrl+T", run: handleNewTab },
          { id: "switch-tab", label: "Switch Tab…", hint: "Ctrl+Shift+E", keywords: "go to file quick open buffer change", run: () => setTabSwitcherOpen(true) },
          { id: "insert-snippet", label: "Insert Snippet…", hint: "Ctrl+Space", keywords: "template shortcut macro abbreviation typed", run: () => setSnippetPickerOpen(true) },
          { id: "manage-snippets", label: "Manage Snippets…", keywords: "customize edit add delete snippet template shortcut", run: () => { setSnippetManagerAdd(false); setSnippetManagerOpen(true); } },
          { id: "open", label: "Open File…", hint: "Ctrl+O", keywords: "load", run: handleOpenFile },
          { id: "open-folder", label: "Open Folder…", keywords: "directory workspace", run: fileState.handleOpenFolder },
          { id: "save", label: "Save", hint: "Ctrl+S", run: saveActiveTab },
          { id: "save-as", label: "Save As…", hint: "Ctrl+Shift+S", run: saveActiveTabAs },
          { id: "reopen-tab", label: "Reopen Closed Tab", hint: "Ctrl+Shift+T", keywords: "restore", run: handleReopenClosedTab },
          { id: "close-tab", label: "Close Tab", hint: "Ctrl+W", run: () => handleCloseTab(fileTabs.activeTabId) },
          { id: "close-all", label: "Close All Tabs", hint: "Ctrl+Shift+W", run: handleCloseAllTabs },
          { id: "find", label: "Find", hint: "Ctrl+F", keywords: "search", run: () => { setFindReplaceShowReplace(false); setFindReplaceOpen(true); window.dispatchEvent(new Event("markd:find-focus")); } },
          { id: "replace", label: "Find and Replace", hint: "Ctrl+H", keywords: "search substitute", run: () => { setFindReplaceShowReplace(true); setFindReplaceOpen(true); } },
          // Link editing stays PM-bound — hidden while source mode owns the
          // buffer (it would mutate the invisible rendered doc).
          ...(sourceMode ? [] : [
            { id: "link", label: "Add / Edit Link", hint: "Ctrl+K", keywords: "url href hyperlink anchor", run: handleEditLink },
          ]),
          { id: "toggle-source", label: "Toggle Source / Rendered View", hint: "Ctrl+/", keywords: "markdown raw code", run: handleToggleSource },
          { id: "toggle-theme", label: "Toggle Theme (Day / Night)", keywords: "dark light appearance", run: handleThemeToggle },
          { id: "full-width", label: "Toggle Full Width", keywords: "column wide narrow", run: toggleFullWidth },
          { id: "line-numbers", label: "Toggle Line Numbers", keywords: "gutter", run: toggleLineNumbers },
          { id: "sidebar", label: "Toggle Sidebar", hint: "Ctrl+\\", keywords: "files outline panel", run: () => setSidebarCollapsed((c) => !c) },
          { id: "focus-mode", label: "Toggle Focus Mode", keywords: "zen distraction-free dim", run: () => setFocusMode((f) => !f) },
          { id: "export-html", label: "Export as HTML…", keywords: "save download", run: handleExportHtml },
          { id: "export-pdf", label: "Export as PDF…", keywords: "print save download", run: exportAsPdf },
          { id: "zoom-in", label: "Zoom In", hint: "Ctrl+=", run: zoomIn },
          { id: "zoom-out", label: "Zoom Out", hint: "Ctrl+-", run: zoomOut },
          { id: "zoom-reset", label: "Reset Zoom", hint: "Ctrl+0", run: resetZoom },
          ...(editor
            ? [
                { id: "h1", label: "Heading 1", keywords: "title section", run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
                { id: "h2", label: "Heading 2", keywords: "section", run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
                { id: "h3", label: "Heading 3", keywords: "section", run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
                { id: "bullet", label: "Bullet List", keywords: "unordered", run: () => editor.chain().focus().toggleBulletList().run() },
                { id: "ordered", label: "Numbered List", keywords: "ordered", run: () => editor.chain().focus().toggleOrderedList().run() },
                { id: "task", label: "Task List", keywords: "checkbox todo", run: () => editor.chain().focus().toggleTaskList().run() },
                { id: "quote", label: "Blockquote", keywords: "citation", run: () => editor.chain().focus().toggleBlockquote().run() },
                { id: "code-block", label: "Code Block", keywords: "fenced pre", run: () => editor.chain().focus().toggleCodeBlock().run() },
                { id: "table", label: "Insert Table", keywords: "grid", run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
                { id: "hr", label: "Horizontal Rule", keywords: "divider separator", run: () => editor.chain().focus().setHorizontalRule().run() },
              ]
            : []),
        ]}
      />
    </div>
  );
}
