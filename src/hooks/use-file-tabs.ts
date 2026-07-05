import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { JSONContent } from "@tiptap/core";

export interface FileTab {
  id: string;
  fileName: string;
  filePath: string | null;
  content: string;
  isDirty: boolean;
  savedContent: string;
  scrollTop: number;
  /**
   * Session-only cache of `content`'s body as a ProseMirror JSON doc, captured
   * when the tab is left. Restoring via JSON skips the slow markdown re-parse on
   * switch-back. INVARIANT: present ⇒ it is getJSON() of the doc that `content`'s
   * body parses to. Set together with `content` (snapshot/switch) or cleared
   * (undefined) wherever content comes from disk (hydrate/open). NOT persisted.
   */
  docJSON?: JSONContent;
}

interface PersistedTab {
  id: string;
  fileName: string;
  filePath: string;
  scrollTop: number;
  isDirty: boolean;
}

interface PersistedState {
  tabs: PersistedTab[];
  activeTabId: string;
}

export interface ClosedTab {
  id: string;
  fileName: string;
  filePath: string | null;
  scrollTop: number;
  // content is non-null only for untitled tabs (no filePath to re-read from)
  content: string | null;
}

export const CLOSED_STACK_KEY = "markd-closed-tabs";
export const CLOSED_STACK_CAP = 10;

export function loadClosedStack(): ClosedTab[] {
  try {
    const raw = localStorage.getItem(CLOSED_STACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is ClosedTab =>
          t &&
          typeof t.id === "string" &&
          typeof t.fileName === "string" &&
          (typeof t.filePath === "string" || t.filePath === null) &&
          typeof t.scrollTop === "number" &&
          (typeof t.content === "string" || t.content === null),
      )
      .slice(-CLOSED_STACK_CAP);
  } catch {
    return [];
  }
}

export function persistClosedStack(stack: ClosedTab[]): void {
  const trimmed = stack.slice(-CLOSED_STACK_CAP);
  try {
    localStorage.setItem(CLOSED_STACK_KEY, JSON.stringify(trimmed));
  } catch {
    // QuotaExceededError — untitled tabs with large content could blow the budget
  }
}

const STORAGE_KEY = "markd-tabs";

const VALID_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt"];

function isValidPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return VALID_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function createTab(overrides?: Partial<FileTab>): FileTab {
  return {
    id: crypto.randomUUID(),
    fileName: "Untitled",
    filePath: null,
    content: "",
    isDirty: false,
    savedContent: "",
    scrollTop: 0,
    ...overrides,
  };
}

function loadPersistedTabs(): { tabs: FileTab[]; activeTabId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: PersistedState = JSON.parse(raw);
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    const validTabs = parsed.tabs.filter(
      (t) => t.filePath && isValidPath(t.filePath),
    );
    if (validTabs.length === 0) return null;
    const tabs: FileTab[] = validTabs.map((t) => createTab({
      id: t.id,
      fileName: t.fileName,
      filePath: t.filePath,
      scrollTop: t.scrollTop ?? 0,
      isDirty: false,
      savedContent: "",
    }));
    const activeTabId = tabs.some((t) => t.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0]!.id;
    return { tabs, activeTabId };
  } catch {
    return null;
  }
}

function persistTabs(tabs: FileTab[], activeTabId: string): void {
  const persistable = tabs.filter((t) => t.filePath && isValidPath(t.filePath));
  if (persistable.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const state: PersistedState = {
    tabs: persistable.map((t) => ({
      id: t.id,
      fileName: t.fileName,
      filePath: t.filePath!,
      scrollTop: t.scrollTop,
      isDirty: t.isDirty,
    })),
    activeTabId,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // QuotaExceededError — metadata-only payload should never hit this, but guard anyway
  }
}

export function useFileTabs() {
  const [tabs, setTabs] = useState<FileTab[]>(() => {
    const restored = loadPersistedTabs();
    return restored ? restored.tabs : [createTab()];
  });
  const [activeTabId, setActiveTabId] = useState(() => {
    const restored = loadPersistedTabs();
    return restored ? restored.activeTabId : tabs[0]!.id;
  });
  const getMarkdownRef = useRef<(() => string) | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Quick-switch MRU: tab ids most-recently-active first. Session-only (a ref,
  // not persisted — no value across reload, no write on every switch). Every tab
  // activation flows through activate() so the switcher's "toggle to previous"
  // order stays correct; the effect below prunes ids of tabs that were closed.
  const mruRef = useRef<string[]>([activeTabId]);
  const activate = useCallback((id: string) => {
    mruRef.current = [id, ...mruRef.current.filter((x) => x !== id)];
    setActiveTabId(id);
  }, []);
  const getMru = useCallback(() => mruRef.current.slice(), []);

  // Update a tab's path + name after its file was renamed/moved on disk (the
  // active file's path is owned by useFileState; this keeps the snapshot tabs
  // and the TabBar label in sync).
  const updateTabPath = useCallback((id: string, newPath: string, newName: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, filePath: newPath, fileName: newName } : t)));
  }, []);
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    mruRef.current = mruRef.current.filter((id) => ids.has(id));
  }, [tabs]);
  const [closedStack, setClosedStack] = useState<ClosedTab[]>(() => loadClosedStack());
  const closedStackRef = useRef(closedStack);
  closedStackRef.current = closedStack;

  const registerGetMarkdown = useCallback((fn: () => string) => {
    getMarkdownRef.current = fn;
  }, []);

  // Returns the editor's current doc as ProseMirror JSON — captured alongside the
  // markdown on every snapshot so a switch-back can restore via JSON (fast) instead
  // of re-parsing markdown (slow on large docs). May return undefined when no
  // valid cache exists (source mode — the editor doc is stale vs the textarea).
  const getDocJSONRef = useRef<(() => JSONContent | undefined) | null>(null);
  const registerGetJSON = useCallback((fn: () => JSONContent | undefined) => {
    getDocJSONRef.current = fn;
  }, []);

  // Authoritative "active buffer == its saved state" check (the editor's
  // doc.eq(savedDoc) — same predicate the revert-check uses, NOT a lagging dirty
  // flag). When true, the active tab's content is already savedContent, so leaving
  // it can SKIP the costly markdown serialize (~tens of ms on a large doc). Default
  // false (serialize) when unknown — never skip on uncertainty.
  const isCleanRef = useRef<(() => boolean) | null>(null);
  const registerIsClean = useCallback((fn: () => boolean) => {
    isCleanRef.current = fn;
  }, []);

  const activeTab: FileTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0]!,
    [tabs, activeTabId],
  );

  const snapshotActiveTab = useCallback(() => {
    const id = activeTabIdRef.current;
    const current = tabsRef.current.find((t) => t.id === id);
    // Skip the costly markdown serialize when the active buffer is unchanged
    // from its saved state. Clean ⇒ the buffer IS the saved state, whose byte
    // truth is savedContent — store THAT, not the tab's old content: after an
    // edit→save, content still holds the open-time text (markTabSaved only
    // advances savedContent), and snapshotting it would regress the tab.
    const clean = isCleanRef.current?.() ?? false;
    const md = clean
      ? current?.savedContent ?? current?.content ?? ""
      : getMarkdownRef.current?.() ?? current?.content ?? "";
    // Capture the doc as JSON regardless (cheap — ~0.2ms, even on large docs) so a
    // later switch-back restores via JSON instead of re-parsing the markdown.
    const docJSON = getDocJSONRef.current?.();
    // Update the REF synchronously, not just queued state: callers (newTab /
    // openInTab / reopenLastClosed) immediately read tabsRef.current and issue
    // a non-functional setTabs — under React batching that replace would
    // discard a merely-queued snapshot, losing the departing tab's unsaved
    // edits (user-hit data loss; switchTab was immune because it snapshots
    // inside its own single functional update).
    tabsRef.current = tabsRef.current.map((t) =>
      t.id === id ? { ...t, content: md, docJSON } : t,
    );
    setTabs(tabsRef.current);
    return md;
  }, []);

  const switchTab = useCallback(
    (tabId: string, departingScrollTop?: number) => {
      if (tabId === activeTabIdRef.current) return null;
      const prevId = activeTabIdRef.current;
      const prevTab = tabsRef.current.find((t) => t.id === prevId);
      // Skip the markdown serialize when the departing buffer is unchanged from
      // saved (see snapshotActiveTab — clean stores savedContent, the byte truth).
      // getJSON stays cheap and is always captured.
      const clean = isCleanRef.current?.() ?? false;
      const md = clean
        ? prevTab?.savedContent ?? prevTab?.content ?? ""
        : getMarkdownRef.current?.() ?? prevTab?.content ?? "";
      const docJSON = getDocJSONRef.current?.();
      setTabs((prev) => {
        const updated = prev.map((t) =>
          t.id === prevId
            ? { ...t, content: md, docJSON, scrollTop: departingScrollTop ?? t.scrollTop }
            : t,
        );
        // Persist after structural mutation (schedule via microtask to read final state)
        queueMicrotask(() => persistTabs(updated, tabId));
        return updated;
      });
      activate(tabId);
      const target = tabsRef.current.find((t) => t.id === tabId);
      return target ?? null;
    },
    [],
  );

  const openInTab = useCallback(
    (
      fileName: string,
      filePath: string | null,
      content: string,
    ): { tab: FileTab; isNew: boolean } => {
      snapshotActiveTab();
      const currentTabs = tabsRef.current;
      const currentId = activeTabIdRef.current;
      const existing = filePath
        ? currentTabs.find((t) => t.filePath === filePath)
        : null;
      if (existing) {
        activate(existing.id);
        queueMicrotask(() => persistTabs(currentTabs, existing.id));
        return { tab: existing, isNew: false };
      }
      const currentTab = currentTabs.find((t) => t.id === currentId);
      const isUntitledEmpty =
        currentTab &&
        currentTab.fileName === "Untitled" &&
        !currentTab.filePath &&
        !currentTab.isDirty &&
        currentTab.content === "";
      if (isUntitledEmpty) {
        const updated: FileTab = {
          ...currentTab,
          fileName,
          filePath,
          content,
          isDirty: false,
          savedContent: content,
          scrollTop: 0,
          docJSON: undefined, // content replaced from disk — no matching editor doc yet
        };
        const newTabs = currentTabs.map((t) =>
          t.id === currentTab.id ? updated : t,
        );
        setTabs(newTabs);
        queueMicrotask(() => persistTabs(newTabs, currentTab.id));
        return { tab: updated, isNew: false };
      }
      const tab = createTab({
        fileName,
        filePath,
        content,
        savedContent: content,
      });
      const newTabs = [...currentTabs, tab];
      setTabs(newTabs);
      activate(tab.id);
      queueMicrotask(() => persistTabs(newTabs, tab.id));
      return { tab, isNew: true };
    },
    [snapshotActiveTab],
  );

  const newTab = useCallback((): FileTab => {
    snapshotActiveTab();
    const tab = createTab();
    const currentTabs = tabsRef.current;
    const newTabs = [...currentTabs, tab];
    setTabs(newTabs);
    activate(tab.id);
    queueMicrotask(() => persistTabs(newTabs, tab.id));
    return tab;
  }, [snapshotActiveTab]);

  const pushClosedTab = useCallback((tab: FileTab) => {
    // Skip empty untitled scratch tabs — they aren't worth remembering
    if (!tab.filePath && tab.content === "" && tab.fileName === "Untitled" && !tab.isDirty) {
      return;
    }
    const entry: ClosedTab = {
      id: tab.id,
      fileName: tab.fileName,
      filePath: tab.filePath,
      scrollTop: tab.scrollTop,
      // For untitled (no filePath), remember content so we can restore it. For named files,
      // content is re-read from disk by the caller, so don't waste localStorage on it.
      content: tab.filePath ? null : tab.content,
    };
    setClosedStack((prev) => {
      const next = [...prev, entry].slice(-CLOSED_STACK_CAP);
      persistClosedStack(next);
      return next;
    });
  }, []);

  const closeTab = useCallback(
    (tabId: string): { switchTo: FileTab | null } => {
      const currentTabs = tabsRef.current;
      const closing = currentTabs.find((t) => t.id === tabId);
      if (closing && tabId === activeTabIdRef.current) {
        const clean = isCleanRef.current?.() ?? false;
        const md = clean ? closing.savedContent : getMarkdownRef.current?.() ?? closing.content;
        pushClosedTab({ ...closing, content: md });
      } else if (closing) {
        pushClosedTab(closing);
      }
      if (currentTabs.length <= 1) {
        const fresh = createTab();
        setTabs([fresh]);
        activate(fresh.id);
        queueMicrotask(() => persistTabs([fresh], fresh.id));
        return { switchTo: fresh };
      }
      const idx = currentTabs.findIndex((t) => t.id === tabId);
      const remaining = currentTabs.filter((t) => t.id !== tabId);
      if (tabId === activeTabIdRef.current) {
        const nextIdx = Math.min(idx, remaining.length - 1);
        const next = remaining[nextIdx]!;
        activate(next.id);
        setTabs(remaining);
        queueMicrotask(() => persistTabs(remaining, next.id));
        return { switchTo: next };
      }
      setTabs(remaining);
      queueMicrotask(() => persistTabs(remaining, activeTabIdRef.current));
      return { switchTo: null };
    },
    [pushClosedTab],
  );

  const closeAllTabs = useCallback((): { switchTo: FileTab } => {
    const fresh = createTab();
    setTabs([fresh]);
    activate(fresh.id);
    queueMicrotask(() => persistTabs([fresh], fresh.id));
    return { switchTo: fresh };
  }, []);

  // Pops the most-recent closed tab. For untitled tabs, restore inline with cached content.
  // For named files, return a sentinel populated with filePath — caller (App.tsx) is
  // responsible for reading from disk and calling openInTab. NOTE: This split avoids
  // bloating localStorage with file contents we can re-read from disk.
  const reopenLastClosed = useCallback((): { tab: FileTab | null } => {
    const stack = closedStackRef.current;
    if (stack.length === 0) return { tab: null };
    const entry = stack[stack.length - 1]!;
    const remaining = stack.slice(0, -1);
    setClosedStack(remaining);
    persistClosedStack(remaining);

    if (!entry.filePath) {
      snapshotActiveTab();
      const tab = createTab({
        fileName: entry.fileName,
        filePath: null,
        content: entry.content ?? "",
        savedContent: entry.content ?? "",
        scrollTop: entry.scrollTop,
        isDirty: (entry.content ?? "") !== "",
      });
      const newTabs = [...tabsRef.current, tab];
      setTabs(newTabs);
      activate(tab.id);
      queueMicrotask(() => persistTabs(newTabs, tab.id));
      return { tab };
    }

    // Named file — caller (App.tsx) is responsible for reading from disk and
    // calling openInTab. Return a sentinel with filePath populated.
    return {
      tab: {
        id: entry.id,
        fileName: entry.fileName,
        filePath: entry.filePath,
        content: "",
        isDirty: false,
        savedContent: "",
        scrollTop: entry.scrollTop,
      },
    };
  }, [snapshotActiveTab]);

  const markTabDirty = useCallback(
    (tabId?: string) => {
      const id = tabId ?? activeTabIdRef.current;
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, isDirty: true } : t)),
      );
    },
    [],
  );

  // Inverse of markTabDirty — clears the flag when the buffer returns to the
  // saved state (revert-by-undo). Deliberately does not persist, mirroring
  // markTabDirty: persistence happens on the next snapshot/save.
  const markTabClean = useCallback(
    (tabId?: string) => {
      const id = tabId ?? activeTabIdRef.current;
      setTabs((prev) =>
        prev.map((t) => (t.id === id && t.isDirty ? { ...t, isDirty: false } : t)),
      );
    },
    [],
  );

  const markTabSaved = useCallback(
    (
      tabId: string,
      updates: {
        filePath?: string | null;
        fileName?: string;
        savedContent: string;
      },
    ) => {
      setTabs((prev) => {
        const updated = prev.map((t) =>
          t.id === tabId
            ? {
                ...t,
                isDirty: false,
                savedContent: updates.savedContent,
                ...(updates.filePath !== undefined
                  ? { filePath: updates.filePath }
                  : {}),
                ...(updates.fileName !== undefined
                  ? { fileName: updates.fileName }
                  : {}),
              }
            : t,
        );
        // Persist after save — filePath may have changed (Save As)
        queueMicrotask(() => persistTabs(updated, activeTabIdRef.current));
        return updated;
      });
    },
    [],
  );

  // Update a tab's content without switching to it — used for background hydration
  const hydrateTab = useCallback(
    (tabId: string, content: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, content, savedContent: content, isDirty: false, docJSON: undefined }
            : t,
        ),
      );
    },
    [],
  );

  return {
    tabs,
    activeTab,
    activeTabId,
    getMru,
    updateTabPath,
    switchTab,
    openInTab,
    newTab,
    closeTab,
    closeAllTabs,
    markTabDirty,
    markTabClean,
    markTabSaved,
    hydrateTab,
    registerGetMarkdown,
    registerGetJSON,
    registerIsClean,
    closedStack,
    reopenLastClosed,
  };
}
