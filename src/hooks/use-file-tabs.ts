import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { JSONContent } from "@tiptap/core";
import { samePath } from "@/lib/path-identity";

export interface FileTab {
  id: string;
  fileName: string;
  filePath: string | null;
  content: string;
  isDirty: boolean;
  savedContent: string;
  scrollTop: number;
  /**
   * False while this tab names a file whose bytes have never been read.
   *
   * `content === ""` cannot express this: a document the user emptied on
   * purpose looks identical to one that was never loaded. Treating the two the
   * same bound the live editor buffer — the blank startup document, or another
   * tab's text — to a real file path, and the next save wrote it out. Anything
   * that reads a tab as authoritative (snapshot, restore into the editor, save,
   * autosave) must check this first.
   */
  isHydrated: boolean;
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
    // A brand-new buffer is its own truth; only a path-bearing tab awaiting a
    // disk read is unhydrated, and those opt in explicitly below.
    isHydrated: true,
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
      // Persistence stores metadata only — the bytes come from disk at startup.
      isHydrated: false,
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
  // One read, one parse. Two useState initializers each calling
  // loadPersistedTabs() meant the session payload was read from localStorage and
  // JSON.parsed twice on every boot, on the critical path.
  const [initialState] = useState(() => {
    const restored = loadPersistedTabs();
    const tabs = restored ? restored.tabs : [createTab()];
    return { tabs, activeTabId: restored ? restored.activeTabId : tabs[0]!.id };
  });
  const [tabs, setTabs] = useState<FileTab[]>(initialState.tabs);
  const [activeTabId, setActiveTabId] = useState(initialState.activeTabId);
  const getMarkdownRef = useRef<(() => string) | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // Content ownership is independent of render state: advancing this revision
  // on every mutation lets an async background write prove it still owns the
  // snapshot it captured without forcing the whole editor to re-render per key.
  const tabRevisionRef = useRef(new Map(tabs.map((tab) => [tab.id, 0])));
  const getTabRevision = useCallback((id: string) => tabRevisionRef.current.get(id) ?? 0, []);
  /**
   * The tab array as of right now, not as of the last render.
   *
   * Mutations update `tabsRef` synchronously and queue a render, so a caller
   * that awaits its own save and then reads the rendered `tabs` still sees the
   * pre-save flags. Verifying "is anything still dirty?" against that stale copy
   * reported failure for a Save All that had in fact saved everything.
   */
  const getTabsSnapshot = useCallback(() => tabsRef.current, []);
  /**
   * The active tab id as of right now.
   *
   * Same hazard as {@link getTabsSnapshot}: this hook returns a plain object
   * literal, so `activeTabId` on it is a useState VALUE frozen into the render
   * that produced it. Anything that captures the hook object and then awaits —
   * the startup effect does exactly that — must ask through here, or it reads
   * the state from before its own mutations.
   */
  const getActiveTabId = useCallback(() => activeTabIdRef.current, []);
  const advanceTabRevision = useCallback((id: string) => {
    const next = (tabRevisionRef.current.get(id) ?? 0) + 1;
    tabRevisionRef.current.set(id, next);
    return next;
  }, []);

  // Quick-switch MRU: tab ids most-recently-active first. Session-only (a ref,
  // not persisted — no value across reload, no write on every switch). Every tab
  // activation flows through activate() so the switcher's "toggle to previous"
  // order stays correct; the effect below prunes ids of tabs that were closed.
  const mruRef = useRef<string[]>([activeTabId]);
  const activate = useCallback((id: string) => {
    mruRef.current = [id, ...mruRef.current.filter((x) => x !== id)];
    activeTabIdRef.current = id;
    setActiveTabId(id);
  }, []);
  const getMru = useCallback(() => mruRef.current.slice(), []);

  // Update a tab's path + name after its file was renamed/moved on disk (the
  // active file's path is owned by useFileState; this keeps the snapshot tabs
  // and the TabBar label in sync).
  // Change a tab's identity WITHOUT touching its buffer or its dirty flag.
  // `newPath` is nullable because a file can be deleted out from under an open
  // tab: the user keeps the buffer, which then has no path and is the only copy
  // of that content.
  const updateTabPath = useCallback((id: string, newPath: string | null, newName: string) => {
    advanceTabRevision(id);
    const updated = tabsRef.current.map((t) => (
      t.id === id ? { ...t, filePath: newPath, fileName: newName } : t
    ));
    tabsRef.current = updated;
    setTabs(updated);
    queueMicrotask(() => persistTabs(updated, activeTabIdRef.current));
  }, [advanceTabRevision]);
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    mruRef.current = mruRef.current.filter((id) => ids.has(id));
    for (const id of ids) {
      if (!tabRevisionRef.current.has(id)) tabRevisionRef.current.set(id, 0);
    }
    for (const id of tabRevisionRef.current.keys()) {
      if (!ids.has(id)) tabRevisionRef.current.delete(id);
    }
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
    // An unhydrated tab's file has never been read, so the editor is showing
    // something else entirely. Snapshotting that over the tab would bind foreign
    // text to a real path; leave the tab untouched until it loads.
    if (current && !current.isHydrated) return current.content;
    const clean = isCleanRef.current?.() ?? false;
    const md = clean
      ? current?.savedContent ?? current?.content ?? ""
      : getMarkdownRef.current?.() ?? current?.content ?? "";
    // Capture the doc as JSON regardless (cheap — ~0.2ms, even on large docs) so a
    // later switch-back restores via JSON instead of re-parsing the markdown.
    const docJSON = getDocJSONRef.current?.();
    if (current?.content !== md) advanceTabRevision(id);
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
  }, [advanceTabRevision]);

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
      if (prevTab?.content !== md) advanceTabRevision(prevId);
      const updated = tabsRef.current.map((t) =>
        t.id === prevId
          ? { ...t, content: md, docJSON, scrollTop: departingScrollTop ?? t.scrollTop }
          : t,
      );
      tabsRef.current = updated;
      setTabs(updated);
      // Persist after structural mutation (schedule via microtask to read final state)
      queueMicrotask(() => persistTabs(updated, tabId));
      activate(tabId);
      const target = updated.find((t) => t.id === tabId);
      return target ?? null;
    },
    [advanceTabRevision],
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
        ? currentTabs.find((t) => samePath(t.filePath, filePath))
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
        advanceTabRevision(currentTab.id);
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
        tabsRef.current = newTabs;
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
      tabsRef.current = newTabs;
      setTabs(newTabs);
      activate(tab.id);
      queueMicrotask(() => persistTabs(newTabs, tab.id));
      return { tab, isNew: true };
    },
    [advanceTabRevision, snapshotActiveTab],
  );

  const newTab = useCallback((): FileTab => {
    snapshotActiveTab();
    const tab = createTab();
    const currentTabs = tabsRef.current;
    const newTabs = [...currentTabs, tab];
    tabsRef.current = newTabs;
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
        tabsRef.current = [fresh];
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
        tabsRef.current = remaining;
        setTabs(remaining);
        queueMicrotask(() => persistTabs(remaining, next.id));
        return { switchTo: next };
      }
      tabsRef.current = remaining;
      setTabs(remaining);
      queueMicrotask(() => persistTabs(remaining, activeTabIdRef.current));
      return { switchTo: null };
    },
    [pushClosedTab],
  );

  const closeAllTabs = useCallback((): { switchTo: FileTab } => {
    // Remember every tab first. Closing one at a time pushes each onto the
    // closed stack; Close All used to skip that entirely and also clear the
    // persisted session — so one misclick (with no prompt at all when every tab
    // was clean) left nothing for Ctrl+Shift+T and nothing on disk to restore.
    // Oldest first, so repeated reopen walks the session backwards.
    const closing = tabsRef.current;
    const activeId = activeTabIdRef.current;
    const clean = isCleanRef.current?.() ?? false;
    for (const tab of closing) {
      if (tab.id === activeId) {
        // Only the active tab's text lives in the editor rather than the tab.
        const md = clean ? tab.savedContent : getMarkdownRef.current?.() ?? tab.content;
        pushClosedTab({ ...tab, content: md });
      } else {
        pushClosedTab(tab);
      }
    }

    const fresh = createTab();
    tabsRef.current = [fresh];
    setTabs([fresh]);
    activate(fresh.id);
    queueMicrotask(() => persistTabs([fresh], fresh.id));
    return { switchTo: fresh };
  }, [pushClosedTab]);

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
      tabsRef.current = newTabs;
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
        isHydrated: false,
      },
    };
  }, [snapshotActiveTab]);

  // Named reopen reads can be superseded by a newer buffer intent. Requeue the
  // popped entry in that case so Ctrl+Shift+T never silently loses recovery
  // history merely because its asynchronous read was correctly discarded.
  const restoreClosedTab = useCallback((tab: FileTab) => {
    const entry: ClosedTab = {
      id: tab.id,
      fileName: tab.fileName,
      filePath: tab.filePath,
      scrollTop: tab.scrollTop,
      content: tab.filePath ? null : tab.content,
    };
    setClosedStack((prev) => {
      if (prev.some((candidate) => candidate.id === entry.id)) return prev;
      const next = [...prev, entry].slice(-CLOSED_STACK_CAP);
      persistClosedStack(next);
      return next;
    });
  }, []);

  const markTabDirty = useCallback(
    (tabId?: string) => {
      const id = tabId ?? activeTabIdRef.current;
      advanceTabRevision(id);
      const current = tabsRef.current.find((tab) => tab.id === id);
      if (current?.isDirty) return;
      const updated = tabsRef.current.map((t) => (t.id === id ? { ...t, isDirty: true } : t));
      tabsRef.current = updated;
      setTabs(updated);
    },
    [advanceTabRevision],
  );

  // Inverse of markTabDirty — clears the flag when the buffer returns to the
  // saved state (revert-by-undo). Deliberately does not persist, mirroring
  // markTabDirty: persistence happens on the next snapshot/save.
  const markTabClean = useCallback(
    (tabId?: string) => {
      const id = tabId ?? activeTabIdRef.current;
      const updated = tabsRef.current.map((t) => (
        t.id === id && t.isDirty ? { ...t, isDirty: false } : t
      ));
      tabsRef.current = updated;
      setTabs(updated);
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
        expectedRevision?: number;
      },
    ) => {
      const current = tabsRef.current.find((tab) => tab.id === tabId);
      if (!current) return false;
      if (
        updates.expectedRevision !== undefined &&
        getTabRevision(tabId) !== updates.expectedRevision
      ) {
        return false;
      }
      const nextFilePath = updates.filePath !== undefined ? updates.filePath : current.filePath;
      const nextFileName = updates.fileName !== undefined ? updates.fileName : current.fileName;
      // Effects can mirror a save that an owning call already settled. That is
      // an observation, not a content transition, so it must not invalidate a
      // pending owner by advancing the revision again.
      if (
        !current.isDirty &&
        current.savedContent === updates.savedContent &&
        current.filePath === nextFilePath &&
        current.fileName === nextFileName
      ) {
        return true;
      }
      advanceTabRevision(tabId);
      const updated = tabsRef.current.map((t) =>
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
      tabsRef.current = updated;
      setTabs(updated);
      // Persist after save — filePath may have changed (Save As)
      queueMicrotask(() => persistTabs(updated, activeTabIdRef.current));
      return true;
    },
    [advanceTabRevision, getTabRevision],
  );

  // Update a tab's content without switching to it — used for background hydration
  const hydrateTab = useCallback(
    (tabId: string, content: string, expectedRevision?: number) => {
      if (!tabsRef.current.some((tab) => tab.id === tabId)) return false;
      if (
        expectedRevision !== undefined &&
        getTabRevision(tabId) !== expectedRevision
      ) {
        return false;
      }
      advanceTabRevision(tabId);
      const updated = tabsRef.current.map((t) =>
          t.id === tabId
            ? { ...t, content, savedContent: content, isDirty: false, isHydrated: true, docJSON: undefined }
            : t,
      );
      tabsRef.current = updated;
      setTabs(updated);
      return true;
    },
    [advanceTabRevision, getTabRevision],
  );

  return {
    tabs,
    activeTab,
    activeTabId,
    getMru,
    getTabRevision,
    getTabsSnapshot,
    getActiveTabId,
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
    restoreClosedTab,
  };
}
