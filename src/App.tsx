import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { useFileState, type AutoSavePause } from "@/hooks/use-file-state";
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
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { createFile, createFolder, exportAsHtml, exportAsPdf, isPathAuthorizationError, isPathUnavailableError, openFile, pathExists, readFileByPath, renamePath, saveFileAs, saveToFile, trashPath } from "@/lib/file-system";
import { ensureMdExtension, joinPath, parentPath, targetDirForEntry, validateName } from "@/lib/file-tree-ops";
import {
  createUpdateCheckCoordinator,
  shouldCheckForUpdate,
  makeUpdateCheckRecord,
  shouldOfferUpdate,
  shouldShowUpdateError,
  UPDATE_SKIP_KEY,
} from "@/lib/updater";
import {
  createFileChangePromptCoordinator,
  defaultExternalChangeChoice,
  fileChangeReadRetryDelay,
  fileChangeTargetOwnsActivePath,
  fileChangeTargetIsCurrent,
  type FileChangeTarget,
  resolveExternalChangeChoice,
  shouldKeepDeletedFileOpen,
  shouldPromptForExternalChange,
  shouldPromptForDeletion,
} from "@/lib/file-change";
import { samePath } from "@/lib/path-identity";
import { isPathInside } from "@/lib/path-scope";
import {
  saveOutcomeMessage,
  shouldRetrySupersededActiveSave,
  type SaveOutcome,
} from "@/lib/save-outcome";
import { reloadDiscardPrompt } from "@/lib/reload-guard";
import {
  classifyRestoreFailure,
  restoreFailureNotice,
  type RestoreFailureCounts,
  type RestoreFailureKind,
} from "@/lib/restore-failure";
import { confirmModal, isModalOpen, messageModal, promptModal } from "@/lib/modal";
import { normalizeUrl, wordRangeAt } from "@/lib/links";
import { splitFrontmatter, joinFrontmatter } from "@/lib/frontmatter";
import {
  computeDocumentTextStats,
  computeMarkdownTextStats,
  type TextStats,
} from "@/lib/text-stats";
import { MarkdownStatsWorkerClient } from "@/lib/text-stats-worker-client";
import { canRevertClean, docMatchesSaved, parseSavedDoc, sourceModeIsDirty } from "@/lib/dirty-check";
import { currentMarkdown, currentDocJSON, editorBufferIsClean, textareaText } from "@/lib/source-truth";
import { renderSourceHtml } from "@/lib/source-html";
import { editorSearchBackend, textareaSearchBackend, type SearchBackend } from "@/lib/search-backend";
import { wordAt, type TextRange } from "@/lib/text-search";
import { extractSourceHeadings } from "@/lib/source-outline";
import { revealRange } from "@/lib/textarea-metrics";
import { loadEditorContent } from "@/lib/editor-load";
import { tabDisplayInfo } from "@/lib/tab-display";
import { liveDirtyTabs, tabIsLiveDirty } from "@/lib/tab-dirty-state";
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
// Word/char counting is O(document); this coalesces it to the end of a typing
// burst so the status bar still feels live without paying per keystroke.
const STATS_COALESCE_MS = 150;
// The footer needs 640 logical px when the content rail owns the whole window.
// Opening the fixed 260px sidebar adds that rail to the same usable floor.
const COLLAPSED_WINDOW_MIN_WIDTH = 640;
const EXPANDED_WINDOW_MIN_WIDTH = 900;
const WINDOW_MIN_HEIGHT = 400;

interface CloseTabOptions {
  /** The caller already proved this exact buffer clean before detaching it. */
  skipDirtyPrompt?: boolean;
}

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

  // Keep native resizing aligned with the collapsible layout. A static 900px
  // minimum wastes space while the sidebar is closed; a static 640px minimum
  // lets the open sidebar consume the footer's usable width.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const minWidth = sidebarCollapsed
      ? COLLAPSED_WINDOW_MIN_WIDTH
      : EXPANDED_WINDOW_MIN_WIDTH;
    const appWindow = getCurrentWindow();
    void (async () => {
      await appWindow.setMinSize(new LogicalSize(minWidth, WINDOW_MIN_HEIGHT));
      const [physicalSize, scaleFactor] = await Promise.all([
        appWindow.innerSize(),
        appWindow.scaleFactor(),
      ]);
      if (cancelled) return;
      const logicalSize = physicalSize.toLogical(scaleFactor);
      // Raising a Windows minimum does not resize a window that is already
      // below it (for example after restoring a compact collapsed-sidebar
      // session). Grow only in that case; lowering the floor never shrinks.
      if (logicalSize.width < minWidth) {
        await appWindow.setSize(new LogicalSize(minWidth, logicalSize.height));
      }
    })().catch((error: unknown) => console.error("Failed to update window minimum size", error));
    return () => {
      cancelled = true;
    };
  }, [sidebarCollapsed]);
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
  // Word/char baseline derived from the active buffer's authoritative saved
  // bytes. It advances only when savedContent does (open, successful save or
  // autosave, tab restore), never on a failed/cancelled/superseded write.
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
  // Latest source buffer awaiting a coalesced stats pass. Immediate stats
  // publications (tab load / mode toggle) cancel it so a departed buffer can
  // never overwrite the active tab's counts 150ms later.
  const pendingStatsMdRef = useRef<string | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const statsWorkerClientRef = useRef<MarkdownStatsWorkerClient | null>(null);

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

  // Source mode owns a raw Markdown textarea, but its status-bar counts must
  // mean the same thing as rendered mode. Tokenize in a lazy Web Worker — never
  // setContent on the live editor — then dispatch canonical visible-text stats.
  // The synchronous configured-tokenizer path is fail-safe only (no Worker or
  // worker failure); normal Source typing never blocks the UI with a full parse.
  const dispatchMarkdownStats = useCallback(
    (markdown: string) => {
      if (!editor) return;
      let client = statsWorkerClientRef.current;
      if (!client) {
        client = new MarkdownStatsWorkerClient(
          () => new Worker(new URL("./lib/text-stats.worker.ts", import.meta.url), { type: "module" }),
          (stats) => window.dispatchEvent(new CustomEvent("markd:stats", { detail: stats })),
          (source) => computeMarkdownTextStats(editor, source),
        );
        statsWorkerClientRef.current = client;
      }
      client.request(markdown);
    },
    [editor],
  );

  const cancelPendingMarkdownStats = useCallback(() => {
    if (statsTimerRef.current !== null) {
      window.clearTimeout(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    pendingStatsMdRef.current = null;
    statsWorkerClientRef.current?.cancel();
  }, []);

  useEffect(
    () => () => {
      statsWorkerClientRef.current?.dispose();
      statsWorkerClientRef.current = null;
    },
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
          cancelPendingMarkdownStats();
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
          dispatchMarkdownStats(viewMd);
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
    cancelPendingMarkdownStats,
    dispatchMarkdownStats,
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
    // A clean rendered buffer IS the saved state — that is what clean means —
    // so share the editor's own doc without asking. Source mode is the exception
    // after a save because its textarea advances while the detached editor does not.
    //
    // The serialize this replaces is quadratic: prosemirror-markdown's
    // atBlank() is an unanchored /(^|\n)$/ tested against the ENTIRE
    // accumulated output, once per block write. Measured in this browser with
    // that exact call pattern: 3.6ms at 50KB, 7.3ms at 100KB, 86.1ms at 200KB,
    // 469.2ms at 400KB. It ran on every open, every save and every tab switch —
    // including the clean loads that make up almost all of them, where the
    // answer was already known. A dirty tab arriving still needs the standalone
    // parse: the saved state genuinely is not in the editor then.
    // The rendered editor can be shared only when it is both visible and clean.
    // In Source mode it intentionally trails the textarea even after a save.
    const savedDoc = fileState.isDirty || sourceModeRef.current
      ? parseSavedDoc(editor, body)
      : editor.state.doc;
    savedDocRef.current = savedDoc;
    // Reuse that authoritative saved document for the delta baseline instead
    // of parsing savedContent a second time in a separate effect.
    setStatsBaseline(savedDoc ? computeDocumentTextStats(savedDoc) : null);
  }, [editor, fileState.savedContent, fileState.isDirty]);

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
  const handleCloseTabRef = useRef<(
    tabId: string,
    options?: CloseTabOptions,
  ) => Promise<void> | void>(() => {});
  // Set once the user has answered the quit prompt, so a re-entrant close
  // request does not ask again.
  const quitConfirmedRef = useRef(false);
  const quitFlowInFlightRef = useRef(false);
  const updateCheckCoordinatorRef = useRef(createUpdateCheckCoordinator());
  const fileChangePromptCoordinatorRef = useRef(createFileChangePromptCoordinator());

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
      const failures: RestoreFailureCounts = {};

      // Why a read failed decides what to do with the tab. A deleted file is
      // gone and its tab goes with it; an offline share is temporary, so the
      // tab stays and reloads when the user selects it. Closing on every error
      // used to delete the session over a sleeping network drive.
      const recordFailure = async (tab: FileTab, error: unknown): Promise<RestoreFailureKind> => {
        // The existence probe only breaks a tie. When the native error already
        // names the class, skip the IPC round trip — it was being serialized
        // into startup once per failed tab for no answer.
        const needsProbe =
          !!tab.filePath &&
          !isPathAuthorizationError(error) &&
          !isPathUnavailableError(error);
        let exists: boolean | null = null;
        if (needsProbe) {
          try {
            exists = await pathExists(tab.filePath!);
          } catch {
            exists = null;
          }
        }
        const kind = classifyRestoreFailure(error, exists);
        failures[kind] = (failures[kind] ?? 0) + 1;
        return kind;
      };

      // Open the file the OS handed us BEFORE restoring the session.
      //
      // This used to run last, so the document the user double-clicked waited
      // behind a disk read and a full ProseMirror render of every persisted tab
      // — and when it was itself the persisted active tab, it was parsed and
      // rendered twice. Rust has had the path since process start.
      let openFailure: unknown = null;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const file = await invoke<{ path: string; name: string; content: string } | null>("get_opened_file");
        if (file && isCurrent()) {
          const { tab } = ft.openInTab(file.name, file.path, file.content);
          // openInTab's matched-existing branch activates a tab without writing
          // content, so a restored tab would still read as unhydrated while the
          // editor showed this document — the state that lets a later switch
          // bind a blank buffer to a real path. Give it the bytes.
          if (!tab.isHydrated) ft.hydrateTab(tab.id, file.content);
          fs.handleOpenByPath(file.path, file.content);
        }
      } catch (error) {
        openFailure = error;
      }

      // Recomputed AFTER the open above. When a launch file claimed the editor
      // it is now the active tab and is already hydrated, so it drops out of
      // needsHydration and the active-tab branch below is skipped entirely —
      // which is what keeps the restore (and its failure-recovery paths) from
      // pushing another document over the one the user asked for.
      // Through the LIVE accessors, not the captured object. `ft` is the value
      // useFileTabs returned for the render this effect fired in, and its `tabs`
      // and `activeTabId` are useState values — they do not follow the open
      // above. Reading them here meant activeId was always the PRE-open tab and
      // needsHydration still contained the launch file: the restore then loaded
      // a DIFFERENT document over the one the user double-clicked, left
      // fileState pointing at that other file, and a later tab switch snapshotted
      // it into the launch tab, so a save wrote the wrong bytes to the path.
      const activeId = ft.getActiveTabId();
      const needsHydration = ft.getTabsSnapshot().filter((t) => t.filePath && !t.isHydrated);

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
          // recordFailure awaits; a newer load may have taken over meanwhile.
          if (!isCurrent()) return;
          if (kind === "unavailable") {
            // Keep the tab — the file is fine, the drive is not — but do not let
            // it stay ACTIVE over the blank startup buffer: switching to a tab
            // that is already active is a no-op, so it could never reload, and
            // anything typed there would end up bound to its real path. Park on
            // a scratch tab; selecting the parked one re-reads it.
            if (isCurrent()) {
              const other = ft.getTabsSnapshot().find((t) => t.id !== activeTab.id && t.isHydrated);
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
          if (!isCurrent()) return;
          const kind = await recordFailure(tab, error);
          if (isCurrent() && kind !== "unavailable") {
            ft.closeTab(tab.id);
          }
        }
      }

      const notice = restoreFailureNotice(failures);
      if (notice && isCurrent()) {
        await messageModal(notice.message, { title: notice.title, kind: "warning" });
      }

      // Reported last: a modal in front of the editor is the one thing that
      // would undo the point of opening the document first.
      if (openFailure !== null && isCurrent()) {
        await messageModal(
          isPathAuthorizationError(openFailure)
            ? "Markd could not open that file. Try File > Open — if that is refused too, the path goes through a symbolic link or junction, which Markd does not currently open."
            : "Markd could not open that file. Its contents are unchanged.",
          { title: "Open Failed", kind: "error" },
        );
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
      // Live: the pending-opens drain calls this in a loop with awaits between
      // iterations, and fileTabsRef only re-points on render, so the second call
      // would otherwise search a tab list that predates the first call's open.
      const existing = ft.getTabsSnapshot().find((t) => samePath(t.filePath, filePath));
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
    cancelPendingMarkdownStats();
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
      dispatchMarkdownStats(md);
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
  }, [
    editor,
    sourceMode,
    sourceMarkdown,
    getEditorMarkdown,
    dispatchMarkdownStats,
    cancelPendingMarkdownStats,
  ]);

  // Handle source markdown changes — track dirty (string compares only: the
  // buffer is raw text, so revert-to-saved/entry detection is plain equality)
  // and keep the footer counts live while the PM editor is unmounted.
  const handleSourceMarkdownChange = useCallback(
    (md: string) => {
      setSourceMarkdown(md);
      // SourceEditor is controlled by React. Refresh search from the same
      // onChange path, after this state update commits, instead of attaching a
      // competing native input listener that can reset Enter to EOF.
      queueMicrotask(() => {
        const backend = searchBackendRef.current;
        if (sourceModeRef.current && backend?.getState().count) backend.refresh();
      });
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
      // Word/char counting walks the whole buffer. Running it per keystroke cost
      // tens of milliseconds a character on a large document, to update a status
      // bar nobody reads mid-word. Coalesce to the end of the typing burst.
      pendingStatsMdRef.current = md;
      if (statsTimerRef.current) window.clearTimeout(statsTimerRef.current);
      statsTimerRef.current = window.setTimeout(() => {
        statsTimerRef.current = null;
        const latest = pendingStatsMdRef.current;
        if (latest === null) return;
        pendingStatsMdRef.current = null;
        dispatchMarkdownStats(latest);
      }, STATS_COALESCE_MS);
    },
    [fileState.markDirty, fileState.markClean, dispatchMarkdownStats],
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
        listenToInput: false,
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
    // Nobody can see the outline unless the sidebar is expanded on its tab, and
    // this re-parses the ENTIRE buffer line by line on every keystroke — tens of
    // milliseconds on a large document, for a panel that is not mounted.
    // OutlinePanel falls back to the ProseMirror headings when this is null.
    if (sidebarCollapsed || sidebarTab !== "outline") return null;
    const { body } = splitFrontmatter(sourceMarkdown);
    const prefixLen = sourceMarkdown.length - body.length;
    const heads = extractSourceHeadings(body);
    return prefixLen === 0
      ? heads
      : heads.map((h) => ({ ...h, pos: h.pos + prefixLen }));
  }, [sourceMode, sourceMarkdown, sidebarCollapsed, sidebarTab]);

  // A coalesced stats pass must not land after the buffer it measured stopped
  // being the visible one — rendered mode dispatches its own counts from the
  // editor, and a late source-mode event would overwrite them.
  useEffect(() => {
    return () => {
      if (statsTimerRef.current) {
        window.clearTimeout(statsTimerRef.current);
        statsTimerRef.current = null;
      }
      pendingStatsMdRef.current = null;
    };
  }, [sourceMode, fileTabs.activeTabId]);

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

  // Browser beforeunload — covers only the dev/preview server, where browsers
  // do not permit custom async UI during unload. The desktop app never
  // registers this native fallback; it uses the in-app onCloseRequested guard.
  useEffect(() => {
    if (isTauri()) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Any tab's unsaved edits count — a background tab's dirty buffer is as
      // lost on unload as the active one's (tabs read via ref at event time).
      const ft = fileTabsRef.current;
      if (
        liveDirtyTabs(
          ft.getTabsSnapshot(),
          ft.getActiveTabId(),
          fileStateRef.current.getCurrentState().isDirty,
        ).length > 0
      ) {
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
      await messageModal("The HTML export could not be saved.", {
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

  useEffect(() => {
    const live = new Set(fileTabs.tabs.map((t) => t.id));
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
            await messageModal(`"${target.fileName}" could not be opened.`, {
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
      let savedRevision = revision;
      try {
        outcome = await (saveAs ? fs.handleSaveAs() : fs.handleSave());
        // A keystroke landing during the write supersedes it: the bytes reached
        // disk but newer ones exist, so the buffer is still dirty. Callers only
        // see a boolean, so this aborted a close or a Save All with no message
        // at all. The user asked to save what is in front of them — write the
        // newer bytes too. Once only: someone who keeps typing would loop
        // forever, and the second outcome is reported honestly either way.
        // Never retry a Save As; that would re-open the file chooser.
        if (
          shouldRetrySupersededActiveSave(
            outcome,
            saveAs,
            ft.getActiveTabId(),
            tabId,
            samePath(beforeSave.filePath, fs.getCurrentState().filePath),
          )
        ) {
          // The retry owns the newer active-A revision, not the revision that
          // started the first write. markTabSaved must settle that exact state.
          savedRevision = ft.getTabRevision(tabId);
          outcome = await fs.handleSave();
        }
      } catch {
        outcome = "failed";
      }
      // Switching tabs while the write was pending makes the active hook state
      // belong to a different document. It is neither a failure nor an excuse
      // to save/announce against that later tab.
      if (outcome === "superseded" && ft.getActiveTabId() !== tabId) return false;
      if (outcome !== "written") {
        // A real write failure is worth interrupting for — including when the
        // document had no path yet, which the old has-a-path gate silently
        // excluded. A cancelled dialog is the user's own choice, so it stays
        // silent. A still-superseded save is neither: the bytes landed but the
        // buffer moved on again, so say so rather than aborting in silence.
        const failure = saveOutcomeMessage(outcome, beforeSave.fileName);
        if (failure) {
          await messageModal(failure, { title: "Save Failed", kind: "error" });
        } else if (outcome === "superseded") {
          await messageModal(
            `"${beforeSave.fileName}" was saved, but you have edited it again since. Save once more to store those changes.`,
            { title: "Saved — Newer Changes Pending", kind: "info" },
          );
        }
        return false;
      }
      if (ft.getActiveTabId() !== tabId) return false;
      const current = fs.getCurrentState();
      return ft.markTabSaved(tabId, {
        filePath: current.filePath,
        fileName: current.fileName,
        savedContent: current.savedContent,
        expectedRevision: savedRevision,
      });
    } finally {
      if (activeSaveOwnerRef.current === owner) activeSaveOwnerRef.current = null;
    }
  }, []);
  const saveActiveTabAs = useCallback(() => saveActiveTab(true), [saveActiveTab]);

  /** Ask before a reload throws away unsaved edits. True means go ahead. */
  const confirmDiscardForReload = useCallback(async (candidates: FileTab[]): Promise<boolean> => {
    const ft = fileTabsRef.current;
    const prompt = reloadDiscardPrompt(
      liveDirtyTabs(
        candidates,
        ft.getActiveTabId(),
        fileStateRef.current.getCurrentState().isDirty,
      ).map((tab) => tab.fileName),
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
    async (tabId: string, options: CloseTabOptions = {}) => {
      const request = bufferLoadGuardRef.current.begin();
      const ft = fileTabsRef.current;
      const activeTabId = ft.getActiveTabId();
      const fs = fileStateRef.current;
      const activeBufferDirty = fs.getCurrentState().isDirty;
      let closingContentRevision = tabId === activeTabId
        ? fs.getContentRevision()
        : null;
      const tab = ft.getTabsSnapshot().find((candidate) => candidate.id === tabId);
      if (
        tab &&
        !options.skipDirtyPrompt &&
        tabIsLiveDirty(tab, activeTabId, activeBufferDirty)
      ) {
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
        if (
          !bufferLoadGuardRef.current.isCurrent(request) ||
          !fileTabsRef.current.getTabsSnapshot().some((candidate) => candidate.id === tabId) ||
          (closingContentRevision !== null &&
            (fileTabsRef.current.getActiveTabId() !== tabId ||
              fileStateRef.current.getContentRevision() !== closingContentRevision))
        ) {
          return;
        }
        if (choice === "save") {
          if (tabId === fileTabsRef.current.getActiveTabId()) {
            const saved = await saveActiveTab();
            if (!saved) return;
            // A successful save advances the hook's ownership token itself.
            // It proved no edit raced the write, so that new token is still
            // owned by this close continuation.
            closingContentRevision = fileStateRef.current.getContentRevision();
          } else {
            const revision = fileTabsRef.current.getTabRevision(tab.id);
            const result = await saveBackgroundTab(tab, { saveToFile, saveFileAs }, () => (
              bufferLoadGuardRef.current.isCurrent(request) &&
              fileTabsRef.current.getTabRevision(tab.id) === revision
            ));
            if (!result.saved) {
              // A real write failure here used to abort the close in silence.
              const failure = saveOutcomeMessage(result.outcome, tab.fileName);
              if (failure) await messageModal(failure, { title: "Save Failed", kind: "error" });
              return;
            }
            if (!fileTabsRef.current.markTabSaved(tab.id, { ...result.saved, expectedRevision: revision })) {
              return;
            }
          }
        } else if (choice !== "discard") {
          return; // Cancel or dismissed — abort the close.
        }
      }
      if (
        !bufferLoadGuardRef.current.isCurrent(request) ||
        !fileTabsRef.current.tabs.some((candidate) => candidate.id === tabId) ||
        (closingContentRevision !== null &&
          (fileTabsRef.current.getActiveTabId() !== tabId ||
            fileStateRef.current.getContentRevision() !== closingContentRevision))
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
            await messageModal(`"${planned.fileName}" could not be opened.`, {
              title: "File Open Failed",
              kind: "error",
            });
          }
          return;
        }
      }
      if (
        !bufferLoadGuardRef.current.isCurrent(request) ||
        (closingContentRevision !== null &&
          (fileTabsRef.current.getActiveTabId() !== tabId ||
            fileStateRef.current.getContentRevision() !== closingContentRevision))
      ) {
        return;
      }

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
    const activeTabId = ft.getActiveTabId();
    const activeTab = ft.getTabsSnapshot().find((tab) => tab.id === activeTabId);
    const activeBufferDirty = fileStateRef.current.getCurrentState().isDirty;
    // Save the active buffer before any awaited background write. handleSave is
    // revision-bound inside useFileState; a tab switch or edit during the write
    // returns false rather than accidentally saving whichever tab is current.
    if (activeTab && tabIsLiveDirty(activeTab, activeTabId, activeBufferDirty)) {
      if (!await saveActiveTab()) return false;
    }

    // From the LIVE snapshot, after that await. `ft.tabs` is the array from the
    // render this callback was created in; the active save has since mutated
    // tabsRef and queued a render it will never reflect. Worse, the tab OBJECTS
    // in it carry the content from that old render, and saveBackgroundTab writes
    // tab.content — so a buffer edited between the render and this point would
    // have had its older bytes written to disk. The revision guard cannot catch
    // that: `revision` is read live here, so it matches the live value and the
    // write proceeds with the stale object.
    const dirtyTabs = ft
      .getTabsSnapshot()
      .filter((tab) => tab.isDirty && tab.id !== activeTabId);
    for (const tab of dirtyTabs) {
      const revision = ft.getTabRevision(tab.id);
      const result = await saveBackgroundTab(tab, { saveToFile, saveFileAs }, () => (
        fileTabsRef.current.getTabRevision(tab.id) === revision
      ));
      if (!result.saved) {
        // Save All stopping dead with no explanation is why this outcome exists.
        const failure = saveOutcomeMessage(result.outcome, tab.fileName);
        if (failure) await messageModal(failure, { title: "Save Failed", kind: "error" });
        return false;
      }
      if (!ft.markTabSaved(tab.id, { ...result.saved, expectedRevision: revision })) return false;
    }
    // Read the synchronous snapshot: markTabSaved has already settled there,
    // while the rendered array still carries the pre-save dirty flags.
    return !fileTabsRef.current.getTabsSnapshot().some((tab) => tab.isDirty) &&
      !fileStateRef.current.getCurrentState().isDirty;
  }, [saveActiveTab]);

  const handleCloseAllTabs = useCallback(async () => {
    const request = bufferLoadGuardRef.current.begin();
    const ft = fileTabsRef.current;
    let closingContentRevision = fileStateRef.current.getContentRevision();
    const dirtyTabs = liveDirtyTabs(
      ft.getTabsSnapshot(),
      ft.getActiveTabId(),
      fileStateRef.current.getCurrentState().isDirty,
    );
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
      if (
        !bufferLoadGuardRef.current.isCurrent(request) ||
        fileStateRef.current.getContentRevision() !== closingContentRevision
      ) {
        return;
      }
      if (choice === "save") {
        if (!await saveAllDirtyTabs()) return;
        if (!bufferLoadGuardRef.current.isCurrent(request)) return;
        // The active save advances the content token itself. saveAllDirtyTabs
        // only succeeds when no newer edit remains, so this post-save token is
        // still owned by this close continuation.
        closingContentRevision = fileStateRef.current.getContentRevision();
      } else if (choice !== "discard") {
        return; // Cancel or dismissed — abort the close.
      }
    }
    if (
      !bufferLoadGuardRef.current.isCurrent(request) ||
      fileStateRef.current.getContentRevision() !== closingContentRevision
    ) {
      return;
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
        // A second OS close event can arrive while the first prompt/save is
        // pending. It belongs to the same quit attempt: keep the window held
        // and never enqueue another destructive choice behind the first.
        if (quitFlowInFlightRef.current) {
          event.preventDefault();
          return;
        }
        const ft = fileTabsRef.current;
        const dirty = liveDirtyTabs(
          ft.getTabsSnapshot(),
          ft.getActiveTabId(),
          fileStateRef.current.getCurrentState().isDirty,
        );
        if (dirty.length === 0) return;
        // Hold the window open while we ask; destroy() below bypasses this
        // handler so the second pass cannot re-prompt.
        event.preventDefault();
        quitFlowInFlightRef.current = true;
        const request = bufferLoadGuardRef.current.begin();
        let closingContentRevision = fileStateRef.current.getContentRevision();
        try {
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
          if (
            !bufferLoadGuardRef.current.isCurrent(request) ||
            fileStateRef.current.getContentRevision() !== closingContentRevision
          ) {
            return;
          }
          if (choice === "save") {
            // saveAllDirtyTabs reports false for a failed or cancelled write —
            // quitting then would discard exactly the work the user asked to keep.
            if (!(await saveAllDirtyTabs())) return;
            if (!bufferLoadGuardRef.current.isCurrent(request)) return;
            closingContentRevision = fileStateRef.current.getContentRevision();
          } else if (choice !== "discard") {
            return;
          }
          if (
            !bufferLoadGuardRef.current.isCurrent(request) ||
            fileStateRef.current.getContentRevision() !== closingContentRevision
          ) {
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
        } finally {
          quitFlowInFlightRef.current = false;
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
        await messageModal("The selected file could not be opened.", {
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
    const ownerDoc = editor.state.doc;
    const { from: ownerFrom, to: ownerTo } = editor.state.selection;
    const ownerSelection = { from: ownerFrom, to: ownerTo };
    const prev = editor.getAttributes("link").href as string | undefined;
    const input = await promptModal({
      title: prev ? "Edit Link" : "Add Link",
      label: "URL",
      defaultValue: prev ?? "",
      placeholder: "https://…  (leave empty to remove)",
      okLabel: prev ? "Update" : "Add",
      isCurrent: () => editor.state.doc === ownerDoc,
    });
    if (input === null) return; // cancelled
    if (editor.state.doc !== ownerDoc) return;
    const url = normalizeUrl(input);
    if (!url) {
      editor
        .chain()
        .focus()
        .setTextSelection(ownerSelection)
        .extendMarkRange("link")
        .unsetLink()
        .run();
      return;
    }
    if (ownerFrom !== ownerTo || prev) {
      // A selection, or the caret on an existing link → (re)link that range.
      editor
        .chain()
        .focus()
        .setTextSelection(ownerSelection)
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    } else {
      // No selection: link the word under the caret if there is one; otherwise
      // drop the URL in as its own linked text.
      const word = wordRangeAt(ownerDoc, ownerFrom);
      if (word) {
        editor.chain().focus().setTextSelection(word).setLink({ href: url }).run();
      } else {
        editor
          .chain()
          .focus()
          .setTextSelection(ownerSelection)
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
      if (isModalOpen()) return;
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
              // Ctrl+Shift+S: save the active document under a new path.
              void saveActiveTabAs();
            } else {
              void saveActiveTab();
            }
            break;
          case "r":
            e.preventDefault();
            if (e.shiftKey) {
              // Ctrl+Shift+R: reload all tabs from disk
              (async () => {
                if (!(await confirmDiscardForReload(fileTabsRef.current.getTabsSnapshot()))) return;
                const request = bufferLoadGuardRef.current.begin();
                const ft = fileTabsRef.current;
                const fs = fileStateRef.current;
                const activeTabId = ft.getActiveTabId();
                const activeContentRevision = fs.getContentRevision();
                const tabs = ft
                  .getTabsSnapshot()
                  .map((tab) => ({ tab, revision: ft.getTabRevision(tab.id) }));
                for (const { tab, revision } of tabs) {
                  if (!tab.filePath) continue;
                  try {
                    const content = await readFileByPath(tab.filePath);
                    if (!bufferLoadGuardRef.current.isCurrent(request)) return;
                    if (tab.id === activeTabId) {
                      if (
                        ft.getActiveTabId() !== activeTabId ||
                        fs.getContentRevision() !== activeContentRevision
                      ) {
                        return;
                      }
                      if (!ft.hydrateTab(tab.id, content, revision)) return;
                      await fs.handleOpenByPath(tab.filePath, content);
                    } else {
                      ft.hydrateTab(tab.id, content, revision);
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
                  const ft = fileTabsRef.current;
                  const fs = fileStateRef.current;
                  const revision = ft.getTabRevision(active.id);
                  const contentRevision = fs.getContentRevision();
                  try {
                    const content = await readFileByPath(active.filePath!);
                    if (
                      !bufferLoadGuardRef.current.isCurrent(request) ||
                      ft.getActiveTabId() !== active.id ||
                      fs.getContentRevision() !== contentRevision ||
                      !ft.hydrateTab(active.id, content, revision)
                    ) {
                      return;
                    }
                    await fs.handleOpenByPath(active.filePath!, content);
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
    saveActiveTab,
    saveActiveTabAs,
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
      if (isModalOpen()) return;
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
  useEffect(() => {
    const activeFilePath = fileState.filePath;
    if (!isTauri() || !activeFilePath) return;
    const filePath = activeFilePath;
    const watcherOwner = Symbol(filePath);
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;
    let autoSavePause: AutoSavePause | null = null;
    let readRetryTimer: number | null = null;
    let readRetryAttempt = 0;
    const pauseWatcherAutoSave = () => {
      if (
        autoSavePause ||
        !samePath(fileStateRef.current.getCurrentState().filePath, filePath)
      ) return;
      autoSavePause = fileStateRef.current.pauseAutoSave();
    };
    const resumeWatcherAutoSave = () => {
      if (!autoSavePause) return;
      const pause = autoSavePause;
      autoSavePause = null;
      fileStateRef.current.resumeAutoSave(pause);
    };
    const cancelWatcherAutoSavePause = () => {
      if (!autoSavePause) return;
      const pause = autoSavePause;
      autoSavePause = null;
      fileStateRef.current.cancelAutoSavePause(pause);
    };
    const clearReadRetry = () => {
      if (readRetryTimer === null) return;
      window.clearTimeout(readRetryTimer);
      readRetryTimer = null;
    };
    const scheduleReadRetry = () => {
      if (cancelled || readRetryTimer !== null) return;
      const delay = fileChangeReadRetryDelay(readRetryAttempt);
      readRetryAttempt += 1;
      readRetryTimer = window.setTimeout(() => {
        readRetryTimer = null;
        if (!cancelled) void check();
      }, delay);
    };
    const isPromptTargetCurrent = (promptTarget: FileChangeTarget) => {
      const ft = fileTabsRef.current;
      return (
        !cancelled &&
        fileChangeTargetIsCurrent(
          promptTarget,
          ft.getActiveTabId(),
          fileStateRef.current.getCurrentState().filePath,
          fileStateRef.current.getContentRevision(),
        )
      );
    };
    const promptTargetOwnsActivePath = (promptTarget: FileChangeTarget) => {
      const ft = fileTabsRef.current;
      return (
        !cancelled &&
        fileChangeTargetOwnsActivePath(
          promptTarget,
          ft.getActiveTabId(),
          fileStateRef.current.getCurrentState().filePath,
        )
      );
    };

    const retryCurrentCheck = () => {
      if (!cancelled) void check();
    };

    async function check() {
      if (cancelled) return;
      // Stop a due autosave before the asynchronous disk read. Otherwise local
      // dirty bytes can overwrite the external version while its prompt is
      // still being prepared.
      pauseWatcherAutoSave();
      if (fileChangePromptCoordinatorRef.current.isBusy()) {
        fileChangePromptCoordinatorRef.current.acquire(watcherOwner, retryCurrentCheck);
        return;
      }
      let onDisk: string | null = null;
      try {
        onDisk = await readFileByPath(filePath);
      } catch {
        onDisk = null; // read failed — could be a real deletion or a transient race
      }
      if (cancelled) return;
      if (onDisk !== null) {
        readRetryAttempt = 0;
        clearReadRetry();
      }

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
        const promptBusy = fileChangePromptCoordinatorRef.current.isBusy();
        if (!shouldPromptForDeletion(exists, promptBusy)) {
          if (promptBusy) {
            pauseWatcherAutoSave();
            fileChangePromptCoordinatorRef.current.acquire(watcherOwner, retryCurrentCheck);
          } else {
            // The path exists but its bytes are temporarily unreadable (most
            // often an atomic replace window). Keep autosave paused and retry;
            // resuming here could overwrite the external version unseen.
            scheduleReadRetry();
          }
          return;
        }
        const promptTabId = fileTabsRef.current.getActiveTabId();
        const promptTarget = {
          tabId: promptTabId,
          filePath,
          contentRevision: fileStateRef.current.getContentRevision(),
          tabRevision: fileTabsRef.current.getTabRevision(promptTabId),
          fileName: fileStateRef.current.getCurrentState().fileName,
        };
        // Bail if torn down meanwhile — e.g. the user trashed this file from the
        // sidebar, which detaches it (filePath→null) and re-runs this effect.
        if (!isPromptTargetCurrent(promptTarget)) return;
        pauseWatcherAutoSave();
        if (
          !fileChangePromptCoordinatorRef.current.acquire(watcherOwner, retryCurrentCheck)
        ) {
          return;
        }
        let shouldRecheckAfterDeletion = false;
        let shouldRetainAutoSavePause = false;
        try {
          const choice = await confirmModal({
            title: "File Deleted",
            message: `"${promptTarget.fileName}" no longer exists on disk — it may have been deleted or moved.\n\nKeep it open in the editor? It becomes an unsaved document you can re-save anywhere.`,
            tone: "warning",
            buttons: [
              { label: "Keep in Editor", value: "keep", variant: "primary" },
              { label: "Close Tab", value: "close", variant: "danger" },
            ],
            defaultValue: "keep",
            isCurrent: () => isPromptTargetCurrent(promptTarget),
          });
          if (!promptTargetOwnsActivePath(promptTarget)) return;
          let stillDeleted: boolean;
          try {
            stillDeleted = !(await pathExists(filePath));
          } catch {
            shouldRetainAutoSavePause = true;
            scheduleReadRetry();
            return;
          }
          if (!promptTargetOwnsActivePath(promptTarget)) return;
          if (!stillDeleted) {
            // The path reappeared while the modal was open (often an atomic
            // save gap). Reclassify it from fresh content; never detach/close.
            shouldRecheckAfterDeletion = true;
            return;
          }
          if (!isPromptTargetCurrent(promptTarget)) {
            // The user edited after the modal closed but before the path probe
            // settled. The old Close choice no longer owns that newer buffer;
            // detach it safely and keep every new byte in the editor.
            fileStateRef.current.detachActiveFile();
            return;
          }
          if (shouldKeepDeletedFileOpen(choice)) {
            // Detach from the now-missing path: the buffer becomes the only copy
            // — kept dirty + close-guarded, autosave timer cancelled, and the
            // watcher torn down (filePath→null re-runs this effect). Same
            // primitive the sidebar trash uses.
            fileStateRef.current.detachActiveFile();
          } else {
            // Break the path binding before the generic dirty-close guard runs.
            // If the buffer needs saving, its Save action must become Save As;
            // it must never recreate a deleted path or overwrite a file that
            // reappeared while the nested modal was open.
            const deletedBufferWasDirty = fileStateRef.current.getCurrentState().isDirty;
            fileStateRef.current.detachActiveFile();
            await handleCloseTabRef.current(promptTarget.tabId, {
              skipDirtyPrompt: !deletedBufferWasDirty,
            });
          }
        } finally {
          fileChangePromptCoordinatorRef.current.release(watcherOwner);
          if (shouldRecheckAfterDeletion && !cancelled) {
            void check();
          } else if (!shouldRetainAutoSavePause || cancelled) {
            cancelWatcherAutoSavePause();
          }
        }
        return;
      }

      const promptBusy = fileChangePromptCoordinatorRef.current.isBusy();
      const liveFileState = fileStateRef.current.getCurrentState();
      if (
        !shouldPromptForExternalChange(onDisk, liveFileState.savedContent, promptBusy)
      ) {
        if (promptBusy) {
          pauseWatcherAutoSave();
          fileChangePromptCoordinatorRef.current.acquire(watcherOwner, retryCurrentCheck);
        } else {
          resumeWatcherAutoSave();
        }
        return;
      }
      const promptTabId = fileTabsRef.current.getActiveTabId();
      const promptTarget = {
        tabId: promptTabId,
        filePath,
        contentRevision: fileStateRef.current.getContentRevision(),
        tabRevision: fileTabsRef.current.getTabRevision(promptTabId),
      };
      if (!isPromptTargetCurrent(promptTarget)) return;
      pauseWatcherAutoSave();
      if (!fileChangePromptCoordinatorRef.current.acquire(watcherOwner, retryCurrentCheck)) {
        return;
      }
      let shouldRecheckAfterReload = false;
      let shouldRecheckStaleTarget = false;
      let shouldValidateAfterKeep = false;
      try {
        const promptFileState = fileStateRef.current.getCurrentState();
        const hasUnsavedEdits = promptFileState.isDirty;
        const choice = await confirmModal({
          title: "File Changed on Disk",
          message: `"${promptFileState.fileName}" has been modified outside Markd.\n\nReload from disk?${
            hasUnsavedEdits ? " Any unsaved edits in Markd will be discarded." : ""
          }`,
          tone: "warning",
          buttons: [
            {
              label: "Reload from Disk",
              value: "reload",
              variant: hasUnsavedEdits ? "danger" : "primary",
            },
            { label: "Keep Current", value: "keep" },
          ],
          defaultValue: defaultExternalChangeChoice(hasUnsavedEdits),
          isCurrent: () => isPromptTargetCurrent(promptTarget),
        });
        const resolution = resolveExternalChangeChoice(
          choice,
          isPromptTargetCurrent(promptTarget),
          promptTargetOwnsActivePath(promptTarget),
        );
        if (resolution === "reload") {
          shouldRecheckAfterReload = true;
          const request = bufferLoadGuardRef.current.begin();
          let latestOnDisk: string;
          try {
            latestOnDisk = await readFileByPath(filePath);
          } catch {
            return;
          }
          if (!isPromptTargetCurrent(promptTarget)) return;
          const ft = fileTabsRef.current;
          if (
            cancelled ||
            !bufferLoadGuardRef.current.isCurrent(request) ||
            !ft.hydrateTab(promptTarget.tabId, latestOnDisk, promptTarget.tabRevision)
          ) {
            return;
          }
          await fileStateRef.current.handleOpenByPath(filePath, latestOnDisk);
        } else if (resolution === "keep") {
          shouldValidateAfterKeep = true;
        } else if (resolution === "recheck") {
          shouldRecheckStaleTarget = true;
        }
      } finally {
        // Reset in finally so a thrown dialog can't permanently wedge the watcher.
        fileChangePromptCoordinatorRef.current.release(watcherOwner);
        // Reload used the freshest completed read. One trailing check closes the
        // remaining race where another program writes between that read and the
        // editor apply. Keep Current intentionally does not re-prompt.
        if ((shouldRecheckAfterReload || shouldRecheckStaleTarget) && !cancelled) {
          void check();
        } else if (shouldValidateAfterKeep && !cancelled) {
          // Same-path watch events are intentionally coalesced while the modal
          // owns the coordinator. Before autosave resumes, prove the path was
          // not deleted during that interval. A missing path is reclassified
          // through the deletion flow; an indeterminate probe stays paused and
          // retries instead of risking recreation/overwrite.
          let pathStillExists: boolean | null = null;
          try {
            pathStillExists = await pathExists(filePath);
          } catch {
            pathStillExists = null;
          }
          if (!promptTargetOwnsActivePath(promptTarget)) {
            cancelWatcherAutoSavePause();
          } else if (pathStillExists === false) {
            void check();
          } else if (pathStillExists === null) {
            scheduleReadRetry();
          } else if (fileChangePromptCoordinatorRef.current.isBusy()) {
            fileChangePromptCoordinatorRef.current.acquire(watcherOwner, retryCurrentCheck);
          } else {
            resumeWatcherAutoSave();
          }
        } else {
          cancelWatcherAutoSavePause();
        }
      }
    }

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
      clearReadRetry();
      cancelWatcherAutoSavePause();
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
  const checkForUpdates = useCallback((manual: boolean): Promise<void> => {
    return updateCheckCoordinatorRef.current.run(manual, async (isManualRequested) => {
      if (!isTauri()) {
        if (isManualRequested()) {
          await messageModal("Updates are only available in the desktop app.", {
            title: "Check for Updates",
            kind: "info",
          });
        }
        return;
      }
      if (
        !isManualRequested() &&
        !shouldCheckForUpdate(
          localStorage.getItem("markd-update-check"),
          __APP_VERSION__,
          Date.now(),
        )
      ) {
        return;
      }

      let installWasChosen = false;
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        // Record only AFTER a successful check, so a thrown check() keeps
        // retrying rather than being debounced away with a stale marker.
        localStorage.setItem(
          "markd-update-check",
          makeUpdateCheckRecord(__APP_VERSION__, Date.now()),
        );
        if (!update) {
          if (isManualRequested()) {
            await messageModal(`You're on the latest version — Markd ${__APP_VERSION__}.`, {
              title: "No Updates Available",
              kind: "info",
            });
          }
          return;
        }

        // Honor "Skip This Version" on automatic checks only — a manual check is
        // an explicit ask, so a stored skip must never silently eat its result.
        if (
          !shouldOfferUpdate(
            update.version,
            localStorage.getItem(UPDATE_SKIP_KEY),
            isManualRequested(),
          )
        ) {
          return;
        }

        // In-app modal (not dialog.ask) so we get three buttons; immune to
        // WebView2 native-dialog gating like the rest of the modal system.
        const offerIsManual = isManualRequested();
        const choice = await confirmModal({
          title: "Update Available",
          message: `Markd ${update.version} is available.\nThe app will close to install and reopen automatically.`,
          buttons: [
            { label: "Install Now", value: "install", variant: "primary" },
            { label: "Remind Me Later", value: "later" },
            { label: "Skip This Version", value: "skip" },
          ],
          defaultValue: "later",
          policy: offerIsManual ? "normal" : "replaceable",
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
        installWasChosen = true;
        await update.downloadAndInstall();
      } catch (err) {
        console.error("Update check failed:", err);
        if (shouldShowUpdateError(isManualRequested(), installWasChosen)) {
          const action = installWasChosen ? "Update installation" : "Update check";
          await messageModal(`${action} failed:\n${err}`, {
            title: "Update Error",
            kind: "error",
          });
        }
      }
    });
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
          await messageModal(`"${entry.name}" could not be opened.`, {
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
        await messageModal(`"${file.name}" no longer exists — removed from Recent Files.`, {
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
      const root = fileStateRef.current.getCurrentState().dirRoot;
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
            await fileStateRef.current.refreshTree();
            await handleFileSelectWithTabs({ kind: "file", name: finalName, path: targetPath });
          } else {
            await createFolder(targetPath);
            await fileStateRef.current.refreshTree();
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
          const liveFileState = fileStateRef.current.getCurrentState();
          const ft = fileTabsRef.current;
          if (samePath(liveFileState.filePath, entry.path)) {
            fileStateRef.current.updateActiveFilePath(newPath, finalName);
            ft.updateTabPath(ft.getActiveTabId(), newPath, finalName);
          } else {
            const tab = ft.getTabsSnapshot().find((candidate) =>
              samePath(candidate.filePath, entry.path)
            );
            if (tab) ft.updateTabPath(tab.id, newPath, finalName);
          }
          await fileStateRef.current.refreshTree();
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
          const liveFileState = fileStateRef.current.getCurrentState();
          if (isPathInside(liveFileState.filePath, entry.path)) {
            fileStateRef.current.detachActiveFile();
          }
          for (const tab of fileTabsRef.current.getTabsSnapshot()) {
            if (isPathInside(tab.filePath, entry.path)) {
              fileTabsRef.current.updateTabPath(tab.id, null, tab.fileName);
            }
          }
          await fileStateRef.current.refreshTree();
        }
      } catch (e) {
        await showError(e instanceof Error ? e.message : String(e));
      }
    },
    [handleFileSelectWithTabs],
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
        onRecentFileSelect={handleRecentFileSelect}
        onRecentFileRemove={removeRecentFile}
        canEditTree={!!fileState.dirRoot}
        onFileAction={handleFileAction}
      />
      <div className="markd-editor-area">
        <div className="markd-tab-strip">
          <button
            className="markd-tab-sidebar-toggle"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            title={`${sidebarCollapsed ? "Show" : "Hide"} Sidebar (Ctrl+\\)`}
            aria-label="Sidebar"
            aria-controls="markd-sidebar"
            aria-expanded={!sidebarCollapsed}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="1" y="2" width="4" height="12" rx="1" opacity="0.45" />
              <rect x="6" y="2" width="9" height="12" rx="1" opacity="0.75" />
            </svg>
          </button>
          <TabBar
            tabs={fileTabs.tabs}
            activeTabId={fileTabs.activeTabId}
            onSwitchTab={handleSwitchTab}
            onCloseTab={handleCloseTab}
            onNewTab={handleNewTab}
            onTabAction={handleTabAction}
          />
        </div>
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
              zoom={zoom}
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
