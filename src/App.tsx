import { useState, useEffect, useCallback, useRef } from "react";
import { useEditor } from "@tiptap/react";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { useFileState } from "@/hooks/use-file-state";
import { useTheme } from "@/hooks/use-theme";
import { Editor } from "@/components/Editor";
import { Toolbar } from "@/components/Toolbar";
import { Menubar } from "@/components/Menubar";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { FindReplace } from "@/components/FindReplace";
import { SourceEditor } from "@/components/SourceEditor";
import { ContextMenu } from "@/components/ContextMenu";
import { ModalHost } from "@/components/ModalHost";
import { CommandPalette } from "@/components/CommandPalette";
import { TabSwitcher } from "@/components/TabSwitcher";
import { SnippetPicker } from "@/components/SnippetPicker";
import { SnippetManager } from "@/components/SnippetManager";
import { resolveTokens } from "@/lib/snippets";
import { insertSnippetIntoEditor } from "@/lib/snippet-insert";
import { useSnippets } from "@/hooks/use-snippets";
import { useRecentFiles } from "@/hooks/use-recent-files";
import { useFullWidth } from "@/hooks/use-full-width";
import { useLineNumbers } from "@/hooks/use-line-numbers";
import { useFileTabs } from "@/hooks/use-file-tabs";
import { useZoom } from "@/hooks/use-zoom";
import { TabBar } from "@/components/TabBar";
import { exportAsHtml, exportAsPdf, readFileByPath, saveToFile } from "@/lib/file-system";
import { shouldCheckForUpdate, makeUpdateCheckRecord } from "@/lib/updater";
import { askDialog } from "@/lib/dialogs";
import { confirmModal, promptModal } from "@/lib/modal";
import { normalizeUrl, wordRangeAt } from "@/lib/links";
import { splitFrontmatter, joinFrontmatter } from "@/lib/frontmatter";

function isTauri(): boolean {
  // Tauri v2 exposes the IPC bridge as __TAURI_INTERNALS__ by default;
  // __TAURI__ only exists when withGlobalTauri is enabled in tauri.conf.json.
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
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
  const { recentFiles, addRecentFile } = useRecentFiles();
  const fileTabs = useFileTabs();

  // Directory of the currently-open file. Read by ResolvedImage at renderHTML
  // time, so it must be updated BEFORE setContent runs — do it synchronously
  // inside the registerSetContent callback.
  const fileDirRef = useRef<string>("");
  // Leading YAML frontmatter, kept out of the editor (tiptap-markdown would
  // corrupt it) and re-prepended verbatim on serialize. Tracks the active file.
  const frontmatterRef = useRef<string>("");

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
    onUpdate: () => {
      fileState.markDirty();
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
      editor.commands.setContent(body, false);
    });
    fileTabs.registerGetMarkdown(() =>
      joinFrontmatter(frontmatterRef.current, editor.storage.markdown.getMarkdown()),
    );
  }, [editor, fileState.registerGetMarkdown, fileState.registerSetContent, fileTabs.registerGetMarkdown]);

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

    if (!sourceMode) {
      // Switching TO source: serialize current editor content
      const md = joinFrontmatter(
        frontmatterRef.current,
        editor.storage.markdown.getMarkdown() as string,
      );
      setSourceMarkdown(md);
      sourceEntryMdRef.current = md;
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

  // Handle source markdown changes — mark dirty
  const handleSourceMarkdownChange = useCallback(
    (md: string) => {
      setSourceMarkdown(md);
      fileState.markDirty();
    },
    [fileState.markDirty],
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
        const resolved = resolveTokens(body);
        const caretIdx = resolved.indexOf("$1");
        const text = caretIdx >= 0 ? resolved.slice(0, caretIdx) + resolved.slice(caretIdx + 2) : resolved;
        const next = sourceMarkdown.slice(0, sel.start) + text + sourceMarkdown.slice(sel.end);
        const caretPos = sel.start + (caretIdx >= 0 ? caretIdx : text.length);
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
    if (fileState.isDirty) fileTabsRef.current.markTabDirty();
  }, [fileState.isDirty]);

  const handleSwitchTab = useCallback(
    async (tabId: string) => {
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
          const saved = await fileState.handleSave();
          if (!saved) return;
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
  );;

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
            await saveToFile(tab.filePath, tab.content);
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
                    const ok = await saveToFile(tab.filePath, tab.content);
                    if (ok) fileTabsRef.current.markTabSaved(tab.id, { savedContent: tab.content });
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

  // Detect external file modifications on the active tab (poll mtime every 2s)
  const lastMtimeRef = useRef<number | null>(null);
  const fileChangePromptOpen = useRef(false);
  useEffect(() => {
    const filePath = fileState.filePath;
    if (!isTauri() || !filePath) {
      lastMtimeRef.current = null;
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;

    (async () => {
      try {
        const { stat } = await import("@tauri-apps/plugin-fs");
        const info = await stat(filePath);
        if (cancelled) return;
        lastMtimeRef.current = info.mtime?.getTime() ?? null;

        timer = setInterval(async () => {
          if (cancelled || fileChangePromptOpen.current) return;
          try {
            const current = await stat(filePath);
            const currentMtime = current.mtime?.getTime() ?? null;
            if (lastMtimeRef.current && currentMtime && currentMtime > lastMtimeRef.current) {
              lastMtimeRef.current = currentMtime;
              fileChangePromptOpen.current = true;
              try {
                const reload = await askDialog(
                  `"${fileState.fileName}" has been modified outside Markd.\n\nReload from disk?`,
                  { title: "File Changed on Disk", kind: "warning" },
                );
                if (reload) {
                  const content = await readFileByPath(filePath);
                  fileTabsRef.current.hydrateTab(fileTabsRef.current.activeTabId, content);
                  fileStateRef.current.handleOpenByPath(filePath, content);
                }
              } finally {
                // Reset in finally so a thrown dialog can't permanently wedge
                // the watcher (it would otherwise never prompt again).
                fileChangePromptOpen.current = false;
              }
            }
          } catch { /* file may have been deleted */ }
        }, 2000);
      } catch { /* stat not available */ }
    })();

    return () => {
      cancelled = true;
      if (timer!) clearInterval(timer);
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
      const { ask, message } = await import("@tauri-apps/plugin-dialog");
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

      const shouldUpdate = await ask(
        `Markd ${update.version} is available.\nThe app will close to install and reopen automatically.`,
        { title: "Update Available", kind: "info" },
      );
      if (!shouldUpdate) return;
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
      try {
        const existing = fileTabs.tabs.find((t) => t.filePath === file.path);
        if (existing) {
          handleSwitchTab(existing.id);
          return;
        }
        fileTabs.openInTab(file.name, file.path, "");
        await fileState.handleOpenByPath(file.path);
      } catch (err) {
        console.error("Failed to open recent file:", err);
      }
    },
    [fileState.handleOpenByPath, fileTabs.tabs, fileTabs.openInTab, handleSwitchTab],
  );

  const handleCloseFindReplace = useCallback(() => {
    setFindReplaceOpen(false);
    editor?.commands.clearDecorations();
  }, [editor]);

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
              editor={editor}
              showReplace={findReplaceShowReplace}
              onClose={handleCloseFindReplace}
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
              onUpdate={fileState.markDirty}
              focusMode={focusMode}
            />
          )}
        </div>
        <StatusBar
          fileName={fileState.fileName}
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
          setSnippetManagerOpen(true);
        }}
        onClose={() => setSnippetPickerOpen(false)}
      />
      <SnippetManager
        open={snippetManagerOpen}
        snippets={snippets}
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
          { id: "manage-snippets", label: "Manage Snippets…", keywords: "customize edit add delete snippet template shortcut", run: () => setSnippetManagerOpen(true) },
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
