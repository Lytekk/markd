import { useState, useCallback, useRef, useMemo } from "react";

export interface FileTab {
  id: string;
  fileName: string;
  filePath: string | null;
  content: string;
  isDirty: boolean;
  savedContent: string;
  scrollTop: number;
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

  const registerGetMarkdown = useCallback((fn: () => string) => {
    getMarkdownRef.current = fn;
  }, []);

  const activeTab: FileTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0]!,
    [tabs, activeTabId],
  );

  const snapshotActiveTab = useCallback(() => {
    const md = getMarkdownRef.current?.() ?? "";
    const id = activeTabIdRef.current;
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content: md } : t)),
    );
    return md;
  }, []);

  const switchTab = useCallback(
    (tabId: string, departingScrollTop?: number) => {
      if (tabId === activeTabIdRef.current) return null;
      const md = getMarkdownRef.current?.() ?? "";
      const prevId = activeTabIdRef.current;
      setTabs((prev) => {
        const updated = prev.map((t) =>
          t.id === prevId
            ? { ...t, content: md, scrollTop: departingScrollTop ?? t.scrollTop }
            : t,
        );
        // Persist after structural mutation (schedule via microtask to read final state)
        queueMicrotask(() => persistTabs(updated, tabId));
        return updated;
      });
      setActiveTabId(tabId);
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
        setActiveTabId(existing.id);
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
      setActiveTabId(tab.id);
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
    setActiveTabId(tab.id);
    queueMicrotask(() => persistTabs(newTabs, tab.id));
    return tab;
  }, [snapshotActiveTab]);

  const closeTab = useCallback(
    (tabId: string): { switchTo: FileTab | null } => {
      const currentTabs = tabsRef.current;
      if (currentTabs.length <= 1) {
        const fresh = createTab();
        setTabs([fresh]);
        setActiveTabId(fresh.id);
        queueMicrotask(() => persistTabs([fresh], fresh.id));
        return { switchTo: fresh };
      }
      const idx = currentTabs.findIndex((t) => t.id === tabId);
      const remaining = currentTabs.filter((t) => t.id !== tabId);
      if (tabId === activeTabIdRef.current) {
        const nextIdx = Math.min(idx, remaining.length - 1);
        const next = remaining[nextIdx]!;
        setActiveTabId(next.id);
        setTabs(remaining);
        queueMicrotask(() => persistTabs(remaining, next.id));
        return { switchTo: next };
      }
      setTabs(remaining);
      queueMicrotask(() => persistTabs(remaining, activeTabIdRef.current));
      return { switchTo: null };
    },
    [],
  );

  const closeAllTabs = useCallback((): { switchTo: FileTab } => {
    const fresh = createTab();
    setTabs([fresh]);
    setActiveTabId(fresh.id);
    queueMicrotask(() => persistTabs([fresh], fresh.id));
    return { switchTo: fresh };
  }, []);

  const markTabDirty = useCallback(
    (tabId?: string) => {
      const id = tabId ?? activeTabIdRef.current;
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, isDirty: true } : t)),
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
          t.id === tabId ? { ...t, content, savedContent: content, isDirty: false } : t,
        ),
      );
    },
    [],
  );

  return {
    tabs,
    activeTab,
    activeTabId,
    switchTab,
    openInTab,
    newTab,
    closeTab,
    closeAllTabs,
    markTabDirty,
    markTabSaved,
    hydrateTab,
    registerGetMarkdown,
  };
}
