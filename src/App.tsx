import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEditor } from "@tiptap/react";
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
import { useFileTabs } from "@/hooks/use-file-tabs";
import { useZoom } from "@/hooks/use-zoom";
import { TabBar } from "@/components/TabBar";
import { createFile, createFolder, exportAsHtml, exportAsPdf, pathExists, readFileByPath, renamePath, saveToFile, trashPath } from "@/lib/file-system";
import { ensureMdExtension, joinPath, parentPath, targetDirForEntry, validateName } from "@/lib/file-tree-ops";
import {
  shouldCheckForUpdate,
  makeUpdateCheckRecord,
  shouldOfferUpdate,
  UPDATE_SKIP_KEY,
} from "@/lib/updater";
import { shouldPromptForExternalChange, shouldPromptForDeletion } from "@/lib/file-change";
import { askDialog, messageDialog } from "@/lib/dialogs";
import { confirmModal, promptModal } from "@/lib/modal";
import { normalizeUrl, wordRangeAt } from "@/lib/links";
import { splitFrontmatter, joinFrontmatter } from "@/lib/frontmatter";
import { computeTextStats, type TextStats } from "@/lib/text-stats";
import { canRevertClean, docMatchesSaved, parseSavedDoc, sourceModeIsDirty } from "@/lib/dirty-check";
import { resolveSaveContent } from "@/lib/markdown-fidelity";
import { loadEditorContent } from "@/lib/editor-load";
import { tabDisplayInfo } from "@/lib/tab-display";

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
      },
    },
  });

  // Register editor methods with file state
  useEffect(() => {
    if (!editor) return;
    fileState.registerGetMarkdown(() =>
      joinFrontmatter(frontmatterRef.current, editor.storage.markdown.getMarkdown()),
    );
    fileState.registerSetContent((md: string, fileDir: string) => {
      fileDirRef.current = fileDir;
      const { frontmatter, body } = splitFrontmatter(md);
      frontmatterRef.current = frontmatter;
      // loadEditorContent (NOT bare setContent): resets PM history so Ctrl+Z
      // can never pull the previous tab's doc into this one (see editor-load.ts).
      loadEditorContent(editor, body);
    });
    fileTabs.registerGetMarkdown(() =>
      joinFrontmatter(frontmatterRef.current, editor.storage.markdown.getMarkdown()),
    );
  }, [editor, fileState.registerGetMarkdown, fileState.registerSetContent, fileTabs.registerGetMarkdown]);

  // Capture the saved-state doc whenever savedContent changes (open / save /
  // tab switch). When the editor currently HOLDS the saved state, share its
  // doc — reference lineage keeps doc.eq cheap on every revert check. When a
  // dirty tab arrives, the saved state is not in the editor, so reconstruct
  // it with a standalone parse (null on failure → revert check stays dirty).
  useEffect(() => {
    if (!editor) return;
    const { frontmatter, body } = splitFrontmatter(fileState.savedContent);
    savedFrontmatterRef.current = frontmatter;
    const currentMd = joinFrontmatter(
      frontmatterRef.current,
      editor.storage.markdown.getMarkdown() as string,
    );
    savedDocRef.current =
      currentMd === fileState.savedContent
        ? editor.state.doc
        : parseSavedDoc(editor, body);
  }, [editor, fileState.savedContent]);

  // Track recent files when files are opened/saved
  useEffect(() => {
    if (fileState.filePath && fileState.fileName !== "Untitled") {
      addRecentFile(fileState.fileName, fileState.filePath);
    }
  }, [fileState.filePath, fileState.fileName, addRecentFile]);

  // Stable refs — used by event listeners and one-shot effects to avoid
  // stale closures and dependency-driven re-registration loops.
  const fileTabsRef = useRef(fileTabs);
  fileTabsRef.current = fileTabs;
  const fileStateRef = useRef(fileState);
  fileStateRef.current = fileState;
  // Latest handleCloseTab, callable from the [filePath]-keyed watcher effect
  // (which must not list it as a dep). Assigned just after its definition below.
  const handleCloseTabRef = useRef<(tabId: string) => Promise<void> | void>(() => {});

  // Load file passed as CLI arg / OS file association (Tauri only).
  // Skipped when tabs were restored from persistence (refresh case).
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!isTauri() || !editor || initialLoadDone.current) return;
    initialLoadDone.current = true;

    // If tabs were restored from localStorage, hydration handles content loading
    const hasPersistedTabs = fileTabsRef.current.tabs.some((t) => t.filePath);
    if (hasPersistedTabs) return;

    interface OpenedFile {
      path: string;
      name: string;
      content: string;
    }

    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const file = await invoke<OpenedFile | null>("get_opened_file");
        if (!file) return;
        fileTabsRef.current.openInTab(file.name, file.path, file.content);
        fileStateRef.current.handleOpenByPath(file.path, file.content);
      } catch {
        // Not in Tauri or no file argument
      }
    })();
  }, [editor]);

  // Hydrate persisted tabs from disk — runs once after editor mounts.
  // Tabs restored from localStorage have filePath but empty content.
  const hydrationDone = useRef(false);
  useEffect(() => {
    if (!isTauri() || !editor || hydrationDone.current) return;
    hydrationDone.current = true;

    (async () => {
      const ft = fileTabsRef.current;
      const fs = fileStateRef.current;
      const tabs = ft.tabs;
      const activeId = ft.activeTabId;

      const needsHydration = tabs.filter((t) => t.filePath && t.content === "");
      if (needsHydration.length === 0) return;

      // Hydrate active tab first — sets editor content directly
      const activeTab = needsHydration.find((t) => t.id === activeId);
      if (activeTab && activeTab.filePath) {
        try {
          const content = await readFileByPath(activeTab.filePath);
          ft.hydrateTab(activeTab.id, content);
          fs.handleOpenByPath(activeTab.filePath, content);
          requestAnimationFrame(() => {
            const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
            if (el) el.scrollTop = activeTab.scrollTop;
          });
        } catch {
          ft.closeTab(activeTab.id);
        }
      }

      // Hydrate background tabs — update content in state without switching
      for (const tab of needsHydration) {
        if (tab.id === activeId) continue;
        if (!tab.filePath) continue;
        try {
          const content = await readFileByPath(tab.filePath);
          ft.hydrateTab(tab.id, content);
        } catch {
          ft.closeTab(tab.id);
        }
      }

      // Open file passed via CLI arg / OS file association (if any).
      // Must run after hydration so openInTab can match existing tabs
      // and snapshotActiveTab captures hydrated (not empty) content.
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const file = await invoke<{ path: string; name: string; content: string } | null>("get_opened_file");
        if (file) {
          fileTabsRef.current.openInTab(file.name, file.path, file.content);
          fileStateRef.current.handleOpenByPath(file.path, file.content);
        }
      } catch {
        // No file argument
      }
    })();
  }, [editor]);

  // Single-instance listener — registers once, uses refs for current state.
  useEffect(() => {
    if (!isTauri() || !editor) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      unlisten = await listen<string>("open-file-in-tab", async (event) => {
        const ft = fileTabsRef.current;
        const fs = fileStateRef.current;
        const filePath = event.payload;
        const existing = ft.tabs.find((t) => t.filePath === filePath);
        if (existing) {
          const target = ft.switchTab(existing.id);
          if (target) fs.restoreState(target);
          return;
        }
        ft.openInTab(
          filePath.split(/[/\\]/).pop() ?? "untitled.md",
          filePath,
          "",
        );
        await fs.handleOpenByPath(filePath);
      });
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
      const md = joinFrontmatter(
        frontmatterRef.current,
        editor.storage.markdown.getMarkdown() as string,
      );
      setSourceMarkdown(md);
      sourceEntryMdRef.current = md;
      sourceEntryDirtyRef.current = fileStateRef.current.isDirty;
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
  }, [editor, sourceMode, sourceMarkdown]);

  // Handle source markdown changes — track dirty (string compares only: the
  // buffer is raw text, so revert-to-saved/entry detection is plain equality)
  // and keep the footer counts live while the PM editor is unmounted.
  const handleSourceMarkdownChange = useCallback(
    (md: string) => {
      setSourceMarkdown(md);
      const fs = fileStateRef.current;
      if (
        sourceModeIsDirty(
          md,
          fs.savedContent,
          sourceEntryMdRef.current,
          sourceEntryDirtyRef.current,
        ) ||
        !canRevertClean(fs.filePath, fs.savedContent)
      ) {
        fileState.markDirty();
      } else {
        fileState.markClean();
      }
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

  // Window title
  useEffect(() => {
    document.title = `${fileState.fileName}${fileState.isDirty ? " \u2022" : ""} \u2014 Markd`;
  }, [fileState.fileName, fileState.isDirty]);

  // Browser beforeunload (no-op in Tauri windows). Tauri's onCloseRequested
  // was removed: window.confirm can be suppressed inside a close-requested
  // handler on WebView2, returning falsy and blocking the close. Auto-save
  // (30s) covers named files; untitled docs rely on the user saving manually.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (fileState.isDirty) e.preventDefault();
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
    await exportAsHtml(editor.getHTML(), fileState.fileName);
  }, [editor, fileState.fileName]);

  // Sync tab state when fileState changes (after open/save/new operations).
  // Uses refs so the effect always reads the current activeTabId.
  useEffect(() => {
    const ft = fileTabsRef.current;
    ft.markTabSaved(ft.activeTabId, {
      filePath: fileState.filePath,
      fileName: fileState.fileName,
      savedContent: fileState.savedContent,
    });
  }, [fileState.filePath, fileState.fileName, fileState.savedContent]);

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
      // Defensive: don't let the departing tab's pending revert check fire
      // against the arriving tab's state (it would be a no-op today, but
      // only incidentally — see dirty-check.ts).
      if (revertCheckTimerRef.current) clearTimeout(revertCheckTimerRef.current);
      // In source mode the live edits live in the SourceEditor textarea
      // (`sourceMarkdown`), not the ProseMirror editor — commit them back first so
      // switchTab's getMarkdown snapshot captures them instead of stale editor
      // content (otherwise the departing tab silently loses the textarea edits).
      if (sourceMode && editor) {
        const { frontmatter, body } = splitFrontmatter(sourceMarkdown);
        frontmatterRef.current = frontmatter;
        editor.commands.setContent(body, false);
      }
      const scrollEl = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
      const departingScroll = scrollEl?.scrollTop ?? 0;
      const target = fileTabs.switchTab(tabId, departingScroll);
      if (target) {
        // Re-read from disk if tab content is empty (not yet hydrated)
        if (!target.content && target.filePath) {
          try {
            const content = await readFileByPath(target.filePath);
            fileTabs.hydrateTab(target.id, content);
            target.content = content;
            target.savedContent = content;
          } catch { /* file gone */ }
        }
        fileState.restoreState(target);
        // restoreState synchronously repopulates the editor + frontmatterRef with
        // the arriving tab; in source mode, re-derive the textarea from it so the
        // SourceEditor shows the NEW tab's source, not the departing tab's.
        if (sourceMode && editor) {
          const md = joinFrontmatter(
            frontmatterRef.current,
            editor.storage.markdown.getMarkdown() as string,
          );
          setSourceMarkdown(md);
          sourceEntryMdRef.current = md;
        }
        requestAnimationFrame(() => {
          const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
          if (el) el.scrollTop = target.scrollTop;
        });
      }
    },
    [sourceMode, sourceMarkdown, editor, fileTabs.switchTab, fileTabs.hydrateTab, fileState.restoreState],
  );

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = fileTabs.tabs.find((t) => t.id === tabId);
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
          if (tabId === fileTabs.activeTabId) {
            const saved = await fileState.handleSave();
            if (!saved) return;
          } else if (tab.filePath) {
            // Background tab (closed via its × / middle-click without being
            // active): handleSave() operates on the ACTIVE file — it would
            // save the wrong buffer and discard this one. Write the closing
            // tab's own content directly.
            const ok = await saveToFile(
              tab.filePath,
              resolveSaveContent(true, tab.savedContent, () => tab.content),
            );
            if (!ok) return;
          } else {
            // Untitled background tab: no path to write without focusing it —
            // abort the close rather than lose the buffer.
            return;
          }
        } else if (choice !== "discard") {
          return; // Cancel or dismissed — abort the close.
        }
      }
      const { switchTo } = fileTabs.closeTab(tabId);
      if (switchTo) {
        // Re-read from disk if tab content is empty (not yet hydrated from localStorage restore)
        if (!switchTo.content && switchTo.filePath) {
          try {
            const content = await readFileByPath(switchTo.filePath);
            fileTabs.hydrateTab(switchTo.id, content);
            switchTo.content = content;
            switchTo.savedContent = content;
          } catch { /* file gone */ }
        }
        fileState.restoreState(switchTo);
        requestAnimationFrame(() => {
          const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
          if (el) el.scrollTop = switchTo.scrollTop;
        });
      }
    },
    [fileTabs.tabs, fileTabs.closeTab, fileTabs.hydrateTab, fileState.handleSave, fileState.restoreState],
  );
  handleCloseTabRef.current = handleCloseTab;;

  const handleCloseAllTabs = useCallback(async () => {
    const dirtyTabs = fileTabs.tabs.filter((t) => t.isDirty);
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
        for (const tab of dirtyTabs) {
          if (!tab.filePath) continue;
          if (tab.id === fileTabs.activeTabId) {
            const saved = await fileState.handleSave();
            if (!saved) return;
          } else {
            await saveToFile(tab.filePath, resolveSaveContent(true, tab.savedContent, () => tab.content));
          }
        }
      } else if (choice !== "discard") {
        return; // Cancel or dismissed — abort the close.
      }
    }
    const { switchTo } = fileTabs.closeAllTabs();
    fileState.restoreState(switchTo);
  }, [fileTabs.tabs, fileTabs.activeTabId, fileTabs.closeAllTabs, fileState.handleSave, fileState.restoreState]);

  const handleNewTab = useCallback(() => {
    fileTabs.newTab();
    fileState.handleNew();
    requestAnimationFrame(() => {
      const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
      if (el) el.scrollTop = 0;
    });
  }, [fileTabs.newTab, fileState.handleNew]);

  const handleReopenClosedTab = useCallback(async () => {
    const { tab } = fileTabs.reopenLastClosed();
    if (!tab) return;
    // Untitled tabs are inserted directly by reopenLastClosed; hydrate the editor.
    if (!tab.filePath) {
      fileState.restoreState(tab);
      return;
    }
    // Named file — read from disk and route through openInTab.
    try {
      const content = await readFileByPath(tab.filePath);
      const { tab: inserted } = fileTabs.openInTab(tab.fileName, tab.filePath, content);
      fileState.restoreState(inserted);
      requestAnimationFrame(() => {
        const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
        if (el) el.scrollTop = tab.scrollTop;
      });
    } catch {
      // File is gone — silently drop. The stack entry is already popped.
    }
  }, [fileTabs.reopenLastClosed, fileTabs.openInTab, fileState.restoreState]);

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
        if (e.key === "F3" && editor) {
          e.preventDefault();
          const { from, to } = editor.state.selection;
          let term = "";
          if (from !== to) {
            term = editor.state.doc.textBetween(from, to);
          } else {
            const $pos = editor.state.doc.resolve(from);
            const text = $pos.parent.textContent;
            const offset = $pos.parentOffset;
            let start = offset;
            let end = offset;
            while (start > 0 && /\w/.test(text[start - 1]!)) start--;
            while (end < text.length && /\w/.test(text[end]!)) end++;
            if (start !== end) {
              term = text.slice(start, end);
            }
          }
          if (term) {
            // Seed the per-tab find state so the panel mounts prefilled with
            // this term; the direct command covers the already-open case.
            const prev = findStateMapRef.current.get(fileTabs.activeTabId);
            findStateMapRef.current.set(fileTabs.activeTabId, {
              searchTerm: term,
              replaceTerm: prev?.replaceTerm ?? "",
              caseSensitive: prev?.caseSensitive ?? false,
              useRegex: prev?.useRegex ?? false,
              wholeWord: prev?.wholeWord ?? false,
            });
            editor.commands.setSearchTerm(term);
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
              const allTabs = fileTabsRef.current.tabs;
              const active = fileTabsRef.current.activeTabId;
              (async () => {
                for (const tab of allTabs) {
                  if (!tab.isDirty || !tab.filePath) continue;
                  if (tab.id === active) {
                    await fileState.handleSave();
                  } else {
                    // Background-tab content is a serialized snapshot —
                    // conform it to the file's newline/line-ending convention.
                    const md = resolveSaveContent(true, tab.savedContent, () => tab.content);
                    const ok = await saveToFile(tab.filePath, md);
                    if (ok) fileTabsRef.current.markTabSaved(tab.id, { savedContent: md });
                  }
                }
              })();
            } else {
              fileState.handleSave();
            }
            break;
          case "r":
            e.preventDefault();
            if (e.shiftKey) {
              // Ctrl+Shift+R: reload all tabs from disk
              (async () => {
                const ft = fileTabsRef.current;
                const fs = fileStateRef.current;
                for (const tab of ft.tabs) {
                  if (!tab.filePath) continue;
                  try {
                    const content = await readFileByPath(tab.filePath);
                    ft.hydrateTab(tab.id, content);
                    if (tab.id === ft.activeTabId) {
                      fs.handleOpenByPath(tab.filePath, content);
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
                  try {
                    const content = await readFileByPath(active.filePath!);
                    fileTabsRef.current.hydrateTab(active.id, content);
                    fileStateRef.current.handleOpenByPath(active.filePath!, content);
                  } catch { /* file gone */ }
                })();
              }
            }
            break;
          case "o":
            e.preventDefault();
            fileState.handleOpen();
            break;
          case "n":
            e.preventDefault();
            fileState.handleNew();
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
        if (!editor) return;
        const storage = editor.storage.searchAndReplace;
        if (!storage.searchTerm && lastSearchTermRef.current) {
          editor.commands.setSearchTerm(lastSearchTermRef.current);
        }
        if (e.shiftKey) {
          editor.commands.findPrevious();
        } else {
          editor.commands.findNext();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    fileState.handleSave,
    fileState.handleSaveAs,
    fileState.handleOpen,
    fileState.handleNew,
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
          fileTabsRef.current.hydrateTab(fileTabsRef.current.activeTabId, onDisk);
          fileStateRef.current.handleOpenByPath(filePath, onDisk);
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
      const existing = fileTabs.tabs.find((t) => t.filePath === entry.path);
      if (existing) {
        handleSwitchTab(existing.id);
        return;
      }
      const { tab, isNew } = fileTabs.openInTab(entry.name, entry.path, "");
      try {
        await fileState.handleOpenByPath(entry.path);
      } catch {
        if (isNew) fileTabs.closeTab(tab.id);
      }
    },
    [fileTabs.tabs, fileTabs.openInTab, handleSwitchTab, fileState.handleOpenByPath],
  );

  const handleRecentFileSelect = useCallback(
    async (file: { name: string; path: string }) => {
      const existing = fileTabs.tabs.find((t) => t.filePath === file.path);
      if (existing) {
        handleSwitchTab(existing.id);
        return;
      }
      // The file may have been deleted/moved since it was added to Recent Files.
      // Verify before opening a (would-be-empty) tab; if gone, drop it and say so.
      if (!(await pathExists(file.path))) {
        removeRecentFile(file.path);
        await messageDialog(`"${file.name}" no longer exists — removed from Recent Files.`, {
          title: "File Not Found",
          kind: "warning",
        });
        return;
      }
      try {
        fileTabs.openInTab(file.name, file.path, "");
        await fileState.handleOpenByPath(file.path);
      } catch (err) {
        console.error("Failed to open recent file:", err);
        removeRecentFile(file.path);
      }
    },
    [fileState.handleOpenByPath, fileTabs.tabs, fileTabs.openInTab, handleSwitchTab, removeRecentFile],
  );

  // File-tree CRUD from the sidebar context menu. The data-safety rule: when the
  // ACTIVE file is renamed/trashed, update useFileState's path (or detach it) so
  // the 30s autosave can't write to / resurrect the old path, and keep the open
  // tab's label in sync. All four ops go through Rust (file-system.ts).
  const handleFileAction = useCallback(
    async (action: FileTreeAction, entry: { kind: string; name: string; path: string } | null) => {
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
          if (fileState.filePath === entry.path) {
            fileState.updateActiveFilePath(newPath, finalName);
            fileTabs.updateTabPath(fileTabs.activeTabId, newPath, finalName);
          } else {
            const t = fileTabs.tabs.find((tab) => tab.filePath === entry.path);
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
          const fp = fileState.filePath;
          const insideTrashed =
            !!fp && (fp === entry.path || fp.startsWith(entry.path + "/") || fp.startsWith(entry.path + "\\"));
          if (insideTrashed) fileState.detachActiveFile();
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
        />
        <Menubar
          editor={editor}
          sidebarCollapsed={sidebarCollapsed}
          sourceMode={sourceMode}
          focusMode={focusMode}
          fullWidth={fullWidth}
          activeTheme={activeTheme}
          themes={themes}
          onNew={fileState.handleNew}
          onOpen={fileState.handleOpen}
          onOpenFolder={fileState.handleOpenFolder}
          onSave={fileState.handleSave}
          onSaveAs={fileState.handleSaveAs}
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
          <Toolbar editor={editor} heldModifier={heldModifier} />
        </div>
        <div className="markd-editor-content">
          {findReplaceOpen && (
            <FindReplace
              key={fileTabs.activeTabId}
              editor={editor}
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
          { id: "new", label: "New File", hint: "Ctrl+N", keywords: "create blank", run: fileState.handleNew },
          { id: "new-tab", label: "New Tab", hint: "Ctrl+T", run: handleNewTab },
          { id: "switch-tab", label: "Switch Tab…", hint: "Ctrl+Shift+E", keywords: "go to file quick open buffer change", run: () => setTabSwitcherOpen(true) },
          { id: "insert-snippet", label: "Insert Snippet…", hint: "Ctrl+Space", keywords: "template shortcut macro abbreviation typed", run: () => setSnippetPickerOpen(true) },
          { id: "manage-snippets", label: "Manage Snippets…", keywords: "customize edit add delete snippet template shortcut", run: () => { setSnippetManagerAdd(false); setSnippetManagerOpen(true); } },
          { id: "open", label: "Open File…", hint: "Ctrl+O", keywords: "load", run: fileState.handleOpen },
          { id: "open-folder", label: "Open Folder…", keywords: "directory workspace", run: fileState.handleOpenFolder },
          { id: "save", label: "Save", hint: "Ctrl+S", run: fileState.handleSave },
          { id: "save-as", label: "Save As…", hint: "Ctrl+Shift+S", run: fileState.handleSaveAs },
          { id: "reopen-tab", label: "Reopen Closed Tab", hint: "Ctrl+Shift+T", keywords: "restore", run: handleReopenClosedTab },
          { id: "close-tab", label: "Close Tab", hint: "Ctrl+W", run: () => handleCloseTab(fileTabs.activeTabId) },
          { id: "close-all", label: "Close All Tabs", hint: "Ctrl+Shift+W", run: handleCloseAllTabs },
          { id: "find", label: "Find", hint: "Ctrl+F", keywords: "search", run: () => { setFindReplaceShowReplace(false); setFindReplaceOpen(true); window.dispatchEvent(new Event("markd:find-focus")); } },
          { id: "replace", label: "Find and Replace", hint: "Ctrl+H", keywords: "search substitute", run: () => { setFindReplaceShowReplace(true); setFindReplaceOpen(true); } },
          { id: "link", label: "Add / Edit Link", hint: "Ctrl+K", keywords: "url href hyperlink anchor", run: handleEditLink },
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
