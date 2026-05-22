# Reopen Closed Tab + Collapsible Outline Sections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Ctrl+Shift+T` to reopen recently closed tabs (capped at 10, persisted across sessions), and add collapsible sections to the outline sidebar panel.

**Architecture:**
- **Closed-tab stack** lives inside `useFileTabs`. On `closeTab`, push a snapshot to an in-memory `closedStackRef` and persist a sanitized version to `localStorage["markd-closed-tabs"]` (cap 10). `reopenLastClosed()` pops the stack and re-inserts via `openInTab` (named files; content is re-read from disk by the caller) or via a direct insert path that restores content (untitled).
- **Collapsible outline** stores a `Set<string>` of collapsed heading IDs in `useState` inside `OutlinePanel`, persisted to `localStorage["markd-outline-collapsed"]`. A pure helper `computeHiddenSet(headings, collapsed)` returns the indices to hide (children of any collapsed ancestor based on heading-level nesting). Each visible item with children renders a caret button that toggles its ID in the set. Drag, click-to-jump, and Alt+Up/Down behavior is preserved.

**Tech Stack:** React 19, TypeScript, TipTap v2, Vitest + jsdom, localStorage, Tauri v2.

---

## File Structure

**Project A — Reopen Closed Tab**
- Modify: `src/hooks/use-file-tabs.ts` — add `ClosedTab` interface, `closedStackRef`, `pushClosedTab()` (called inside `closeTab`), `reopenLastClosed()`, and localStorage helpers `loadClosedStack()` / `persistClosedStack()`.
- Modify: `src/App.tsx` — add `case "t"` with `e.shiftKey` branch in the existing Ctrl block (line ~528) to call `reopenLastClosed()`; the existing `case "t"` without shift continues to call `handleNewTab()`.
- Test: `src/hooks/use-file-tabs.test.ts` (new file) — unit tests for the closed-tab stack behavior.

**Project B — Collapsible Outline Sections**
- Create: `src/lib/outline-tree.ts` — pure helper `computeHiddenSet(headings, collapsed): Set<number>` and `hasChildren(headings, index): boolean`. Pure functions, no React, fully unit-testable.
- Test: `src/lib/outline-tree.test.ts` — unit tests for tree-computation helpers.
- Modify: `src/components/OutlinePanel.tsx` — wire `collapsedIds` state with localStorage persistence, render caret on parents, hide items where `hiddenSet.has(index)`, route caret clicks through `stopPropagation` so they don't trigger `handleClick`.
- Modify: `src/styles/base.css` — caret button styles (`.markd-outline-caret`) and a hidden state for collapsed-out items.

---

## Conventions for this plan

- All file paths are relative to repo root.
- Test runner: `pnpm exec vitest run <path>`.
- Type-check: `pnpm exec tsc --noEmit`.
- Commits use Conventional Commits (`feat:` / `fix:` / `test:` / `refactor:`). One concern per commit.
- Do not push. Do not bump version. Do not run `pnpm tauri:build`.
- localStorage keys must be additive — never delete or modify existing keys.

---

# Project A — Reopen Closed Tab (Ctrl+Shift+T)

## Task A1: Define `ClosedTab` shape and localStorage helpers

**Files:**
- Modify: `src/hooks/use-file-tabs.ts` (top of file, near `PersistedTab`)

- [ ] **Step 1: Write the failing test**

Create `src/hooks/use-file-tabs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadClosedStack, persistClosedStack, CLOSED_STACK_KEY, CLOSED_STACK_CAP } from "./use-file-tabs";

describe("closed-tab stack persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns [] when nothing is persisted", () => {
    expect(loadClosedStack()).toEqual([]);
  });

  it("round-trips a single closed tab", () => {
    const stack = [
      { id: "a", fileName: "a.md", filePath: "/tmp/a.md", scrollTop: 0, content: null },
    ];
    persistClosedStack(stack);
    expect(loadClosedStack()).toEqual(stack);
  });

  it("caps persistence at CLOSED_STACK_CAP entries (most recent kept)", () => {
    const oversized = Array.from({ length: CLOSED_STACK_CAP + 3 }, (_, i) => ({
      id: `id-${i}`,
      fileName: `f-${i}.md`,
      filePath: `/tmp/f-${i}.md`,
      scrollTop: 0,
      content: null,
    }));
    persistClosedStack(oversized);
    const loaded = loadClosedStack();
    expect(loaded.length).toBe(CLOSED_STACK_CAP);
    // Most recent (last pushed) is at the END of the stack
    expect(loaded[loaded.length - 1]!.id).toBe(`id-${CLOSED_STACK_CAP + 2}`);
  });

  it("returns [] when JSON is malformed", () => {
    localStorage.setItem(CLOSED_STACK_KEY, "{not json");
    expect(loadClosedStack()).toEqual([]);
  });

  it("uses storage key 'markd-closed-tabs'", () => {
    expect(CLOSED_STACK_KEY).toBe("markd-closed-tabs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/hooks/use-file-tabs.test.ts`
Expected: FAIL — `loadClosedStack`, `persistClosedStack`, `CLOSED_STACK_KEY`, `CLOSED_STACK_CAP` are not exported.

- [ ] **Step 3: Add interface, constants, and helpers**

Edit `src/hooks/use-file-tabs.ts`. After the existing `PersistedState` interface (line 24), add:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/hooks/use-file-tabs.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-file-tabs.ts src/hooks/use-file-tabs.test.ts
git commit -m "feat(tabs): add closed-tab stack persistence helpers"
```

---

## Task A2: Wire the closed-tab stack into `useFileTabs`

**Files:**
- Modify: `src/hooks/use-file-tabs.ts` (inside `useFileTabs`, near `closeTab`)
- Test: `src/hooks/use-file-tabs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/hooks/use-file-tabs.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react";
import { useFileTabs } from "./use-file-tabs";

describe("useFileTabs — reopen closed tab", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exposes reopenLastClosed and closedStack", () => {
    const { result } = renderHook(() => useFileTabs());
    expect(typeof result.current.reopenLastClosed).toBe("function");
    expect(Array.isArray(result.current.closedStack)).toBe(true);
  });

  it("pushes a closed named tab onto the stack", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => {
      result.current.openInTab("doc.md", "/tmp/doc.md", "hello");
    });
    const docId = result.current.tabs.find((t) => t.filePath === "/tmp/doc.md")!.id;
    act(() => {
      result.current.closeTab(docId);
    });
    expect(result.current.closedStack.length).toBe(1);
    expect(result.current.closedStack[0]!.filePath).toBe("/tmp/doc.md");
  });

  it("does not push the synthetic 'last tab closed' fresh untitled", () => {
    // Closing the only tab replaces it with a fresh untitled (closeTab early-exit).
    // The replaced tab was an empty untitled — do not pollute the stack with it.
    const { result } = renderHook(() => useFileTabs());
    const onlyId = result.current.tabs[0]!.id;
    act(() => {
      result.current.closeTab(onlyId);
    });
    expect(result.current.closedStack.length).toBe(0);
  });

  it("reopenLastClosed restores a named tab from the stack and pops it", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => {
      result.current.openInTab("doc.md", "/tmp/doc.md", "hello");
    });
    const docId = result.current.tabs.find((t) => t.filePath === "/tmp/doc.md")!.id;
    act(() => {
      result.current.closeTab(docId);
    });
    expect(result.current.tabs.some((t) => t.filePath === "/tmp/doc.md")).toBe(false);
    let reopened: { tab: { filePath: string | null } | null } = { tab: null };
    act(() => {
      reopened = result.current.reopenLastClosed();
    });
    expect(reopened.tab?.filePath).toBe("/tmp/doc.md");
    expect(result.current.closedStack.length).toBe(0);
  });

  it("reopenLastClosed returns { tab: null } when stack is empty", () => {
    const { result } = renderHook(() => useFileTabs());
    let reopened: { tab: { filePath: string | null } | null } = { tab: { filePath: "x" } };
    act(() => {
      reopened = result.current.reopenLastClosed();
    });
    expect(reopened.tab).toBeNull();
  });

  it("caps the in-memory closed stack at CLOSED_STACK_CAP", () => {
    const { result } = renderHook(() => useFileTabs());
    // Open + close more than the cap
    for (let i = 0; i < 12; i++) {
      const path = `/tmp/f-${i}.md`;
      act(() => {
        result.current.openInTab(`f-${i}.md`, path, `content-${i}`);
      });
      const id = result.current.tabs.find((t) => t.filePath === path)!.id;
      act(() => {
        result.current.closeTab(id);
      });
    }
    expect(result.current.closedStack.length).toBe(10);
    // Oldest (f-0, f-1) dropped; newest (f-11) at the end
    expect(result.current.closedStack[result.current.closedStack.length - 1]!.filePath).toBe("/tmp/f-11.md");
    expect(result.current.closedStack.some((t) => t.filePath === "/tmp/f-0.md")).toBe(false);
  });
});
```

Also install `@testing-library/react` if not already present. Check first:

```bash
grep -E '@testing-library/react' package.json
```

If missing, add as dev dependency:

```bash
pnpm add -D @testing-library/react
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/hooks/use-file-tabs.test.ts`
Expected: FAIL — `reopenLastClosed`, `closedStack` not exposed.

- [ ] **Step 3: Add stack state, push-on-close, reopen, and persistence**

Edit `src/hooks/use-file-tabs.ts` inside `useFileTabs`. Right after the `activeTabIdRef` setup, add:

```ts
const [closedStack, setClosedStack] = useState<ClosedTab[]>(() => loadClosedStack());
const closedStackRef = useRef(closedStack);
closedStackRef.current = closedStack;
```

Then define `pushClosedTab`:

```ts
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
```

Modify `closeTab` to push before mutating. Locate the existing `closeTab` callback (around line 220) and replace its body with:

```ts
const closeTab = useCallback(
  (tabId: string): { switchTo: FileTab | null } => {
    const currentTabs = tabsRef.current;
    const closing = currentTabs.find((t) => t.id === tabId);
    // Snapshot current editor content into the closing tab before recording it
    if (closing && tabId === activeTabIdRef.current) {
      const md = getMarkdownRef.current?.() ?? closing.content;
      pushClosedTab({ ...closing, content: md });
    } else if (closing) {
      pushClosedTab(closing);
    }
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
  [pushClosedTab],
);
```

Add `reopenLastClosed`:

```ts
const reopenLastClosed = useCallback((): { tab: FileTab | null } => {
  const stack = closedStackRef.current;
  if (stack.length === 0) return { tab: null };
  const entry = stack[stack.length - 1]!;
  const remaining = stack.slice(0, -1);
  setClosedStack(remaining);
  persistClosedStack(remaining);

  // Untitled tab — restore content directly
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
    setActiveTabId(tab.id);
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
```

Expose both in the return object:

```ts
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
  closedStack,
  reopenLastClosed,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/hooks/use-file-tabs.test.ts`
Expected: PASS (all tests from A1 + A2).

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. If `closeAllTabs` should also push closed tabs, leave that for follow-up — it's out of scope here.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-file-tabs.ts src/hooks/use-file-tabs.test.ts package.json pnpm-lock.yaml
git commit -m "feat(tabs): track closed-tab stack with reopenLastClosed"
```

---

## Task A3: Bind `Ctrl+Shift+T` in `App.tsx` to reopen the last closed tab

**Files:**
- Modify: `src/App.tsx` — extend `case "t"` and add file-read path.

- [ ] **Step 1: Locate the existing `case "t"` in the Ctrl keydown switch**

Use Serena to find the keydown handler:
```
mcp__serena__find_symbol(name_path_pattern="App", relative_path="src/App.tsx", include_body=False)
```

The Ctrl block has a switch with `case "t"` at approximately line 528. The current branch is:

```ts
case "t":
  if (e.shiftKey) break;
  e.preventDefault();
  handleNewTab();
  break;
```

- [ ] **Step 2: Replace it with a shift-aware branch**

Edit `case "t"` in `src/App.tsx` (in the keyboard-shortcuts `useEffect`):

```ts
case "t":
  e.preventDefault();
  if (e.shiftKey) {
    void handleReopenClosedTab();
  } else {
    handleNewTab();
  }
  break;
```

- [ ] **Step 3: Add the `handleReopenClosedTab` callback above the `useEffect`**

Locate `handleNewTab` (around line 380). Add after it:

```ts
const handleReopenClosedTab = useCallback(async () => {
  const { tab } = fileTabs.reopenLastClosed();
  if (!tab) return;
  // Untitled tabs are inserted directly by reopenLastClosed
  if (!tab.filePath) {
    // Hydrate the editor with the restored content
    fileState.restoreState(tab);
    return;
  }
  // Named file — read from disk and route through openInTab
  try {
    const content = await readFileByPath(tab.filePath);
    const { tab: inserted } = fileTabs.openInTab(tab.fileName, tab.filePath, content);
    fileState.restoreState(inserted);
    // Restore scroll position after the tab is active
    requestAnimationFrame(() => {
      const el = document.querySelector(".markd-editor-scroll") as HTMLElement | null;
      if (el) el.scrollTop = tab.scrollTop;
    });
  } catch {
    // File is gone — silently drop. The stack entry is already popped.
  }
}, [fileTabs.reopenLastClosed, fileTabs.openInTab, fileState.restoreState]);
```

Verify `readFileByPath` is already imported from `@/lib/file-system`. If not, add to the imports.

Add `handleReopenClosedTab` to the dependency array of the keyboard-shortcuts `useEffect` (locate the existing dep array at the bottom of the effect and append it).

- [ ] **Step 4: Manual verification**

Run: `pnpm dev` (browser-only sanity — Tauri APIs unavailable, but the key handler should at least not throw).

Then, for end-to-end verification, run: `pnpm tauri:dev`.
- Open two markdown files. Close one with Ctrl+W. Press Ctrl+Shift+T. The closed file should reappear in a tab.
- Close the new (untitled) tab after typing some text. Press Ctrl+Shift+T. The untitled tab should reappear with its content.

Report verification outcome in the task notes. If Tauri build is unavailable in this environment, state that explicitly — do not claim verified.

- [ ] **Step 5: Type-check and full test run**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(tabs): Ctrl+Shift+T reopens last closed tab"
```

---

# Project B — Collapsible Outline Sections

## Task B1: Pure tree-computation helpers

**Files:**
- Create: `src/lib/outline-tree.ts`
- Test: `src/lib/outline-tree.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/outline-tree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeHiddenSet, hasChildren, type OutlineHeading } from "./outline-tree";

const h = (level: number, id: string): OutlineHeading => ({ id, level });

describe("hasChildren", () => {
  it("returns true when the next heading is a deeper level", () => {
    const headings = [h(1, "a"), h(2, "b"), h(1, "c")];
    expect(hasChildren(headings, 0)).toBe(true);
  });

  it("returns false when the next heading is same level", () => {
    const headings = [h(1, "a"), h(1, "b")];
    expect(hasChildren(headings, 0)).toBe(false);
  });

  it("returns false when the next heading is a shallower level", () => {
    const headings = [h(2, "a"), h(1, "b")];
    expect(hasChildren(headings, 0)).toBe(false);
  });

  it("returns false for the last item", () => {
    const headings = [h(1, "a"), h(2, "b")];
    expect(hasChildren(headings, 1)).toBe(false);
  });
});

describe("computeHiddenSet", () => {
  it("returns empty set when nothing is collapsed", () => {
    const headings = [h(1, "a"), h(2, "b"), h(3, "c")];
    expect(computeHiddenSet(headings, new Set())).toEqual(new Set());
  });

  it("hides direct children when an H1 is collapsed", () => {
    const headings = [h(1, "a"), h(2, "b"), h(2, "c"), h(1, "d")];
    const hidden = computeHiddenSet(headings, new Set(["a"]));
    expect(hidden).toEqual(new Set([1, 2]));
  });

  it("hides nested grandchildren when an H1 is collapsed", () => {
    const headings = [h(1, "a"), h(2, "b"), h(3, "c"), h(1, "d")];
    const hidden = computeHiddenSet(headings, new Set(["a"]));
    expect(hidden).toEqual(new Set([1, 2]));
  });

  it("stops hiding at a same-or-shallower sibling", () => {
    const headings = [h(2, "a"), h(3, "b"), h(2, "c")];
    const hidden = computeHiddenSet(headings, new Set(["a"]));
    expect(hidden).toEqual(new Set([1]));
  });

  it("ignores collapsed IDs that are not in the headings list", () => {
    const headings = [h(1, "a"), h(2, "b")];
    const hidden = computeHiddenSet(headings, new Set(["ghost"]));
    expect(hidden).toEqual(new Set());
  });

  it("handles multiple collapsed parents at different levels", () => {
    const headings = [
      h(1, "a"), h(2, "b"), h(3, "c"),
      h(1, "d"), h(2, "e"), h(3, "f"),
    ];
    const hidden = computeHiddenSet(headings, new Set(["a", "e"]));
    expect(hidden).toEqual(new Set([1, 2, 5]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/lib/outline-tree.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/outline-tree.ts`:

```ts
export interface OutlineHeading {
  id: string;
  level: number;
}

export function hasChildren(headings: OutlineHeading[], index: number): boolean {
  const current = headings[index];
  const next = headings[index + 1];
  if (!current || !next) return false;
  return next.level > current.level;
}

export function computeHiddenSet(
  headings: OutlineHeading[],
  collapsedIds: Set<string>,
): Set<number> {
  const hidden = new Set<number>();
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    if (!collapsedIds.has(heading.id)) continue;
    // Hide every following heading until we reach one at heading.level or shallower
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level <= heading.level) break;
      hidden.add(j);
    }
  }
  return hidden;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/lib/outline-tree.test.ts`
Expected: PASS (10/10).

- [ ] **Step 5: Commit**

```bash
git add src/lib/outline-tree.ts src/lib/outline-tree.test.ts
git commit -m "feat(outline): pure helpers for collapsible-section computation"
```

---

## Task B2: Add localStorage-backed collapse state to `OutlinePanel`

**Files:**
- Modify: `src/components/OutlinePanel.tsx`

- [ ] **Step 1: Add a test for the new behavior**

Outline panel tests don't exist yet. Don't create one for this task — the component is React-dependent and the behavior we care about (hidden items) is already tested in `outline-tree.test.ts`. Instead, this task is a wiring change. **Skip the test-first ritual ONLY for this rendering change; the underlying logic is fully tested in B1.** If a follow-up requires component-level tests, set up `@testing-library/react` + jsdom rendering separately.

(This task is exempt from TDD because no logic is added — it's wiring + render-time filtering.)

- [ ] **Step 2: Use Serena to read the current `OutlinePanel` body**

```
mcp__serena__find_symbol(name_path_pattern="OutlinePanel", relative_path="src/components/OutlinePanel.tsx", include_body=True)
```

- [ ] **Step 3: Modify `OutlinePanel.tsx` — add state, helpers, and render**

At the top of the file, add imports (after existing imports):

```ts
import { computeHiddenSet, hasChildren } from "@/lib/outline-tree";
```

Inside `OutlinePanel`, after the existing state declarations (`headings`, `activeHeadingIndex`, `dragOverIndex`, `draggingIndex`), add:

```ts
const COLLAPSED_KEY = "markd-outline-collapsed";
const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
});

const toggleCollapsed = useCallback((id: string) => {
  setCollapsedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // Quota exceeded — collapse state is non-critical, drop silently
    }
    return next;
  });
}, []);

const hiddenSet = useMemo(
  () => computeHiddenSet(headings, collapsedIds),
  [headings, collapsedIds],
);
```

Add `useMemo` to the imports from `react`.

Move `COLLAPSED_KEY` to module scope (above the `OutlinePanel` function) so it's not re-allocated per render.

Modify the render loop. Replace the existing `{headings.map((heading, index) => ( ... ))}` block with a version that hides items in `hiddenSet` and renders a caret for parents:

```tsx
{headings.map((heading, index) => {
  if (hiddenSet.has(index)) return null;
  const isParent = hasChildren(headings, index);
  const isCollapsed = collapsedIds.has(heading.id);
  return (
    <div
      key={heading.id}
      className={`markd-outline-item ${index === activeHeadingIndex ? "active" : ""} ${index === draggingIndex ? "dragging" : ""} ${index === dragOverIndex ? "drag-over" : ""}`}
      style={{ paddingLeft: 16 + (heading.level - minLevel) * 16 }}
      onClick={() => handleClick(heading.pos)}
      aria-current={index === activeHeadingIndex ? "true" : undefined}
      ref={index === activeHeadingIndex ? activeItemRef : undefined}
      draggable
      onDragStart={(e) => handleDragStart(e, index)}
      onDragEnd={handleDragEnd}
      onDragEnter={(e) => handleDragEnter(e, index)}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOverIndex(null)}
      onDrop={(e) => handleDrop(e, index)}
      tabIndex={0}
      onKeyDown={(e) => handleKeyDown(e, index)}
    >
      {isParent ? (
        <button
          type="button"
          className="markd-outline-caret"
          aria-label={isCollapsed ? "Expand section" : "Collapse section"}
          aria-expanded={!isCollapsed}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapsed(heading.id);
          }}
        >
          {isCollapsed ? "▸" : "▾"}
        </button>
      ) : (
        <span className="markd-outline-caret markd-outline-caret-empty" aria-hidden="true" />
      )}
      <span className="markd-outline-level">H{heading.level}</span>
      <span className="markd-outline-text">{heading.text}</span>
    </div>
  );
})}
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Full test run**

Run: `pnpm exec vitest run`
Expected: all tests pass, including outline-tree tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/OutlinePanel.tsx
git commit -m "feat(outline): collapsible sections with persistence"
```

---

## Task B3: Style the caret and ensure layout integrity

**Files:**
- Modify: `src/styles/base.css`
- Test: `src/styles/base.test.ts` (existing CSS-invariant tests — verify no regressions)

- [ ] **Step 1: Use Serena/Read to locate the existing outline styles**

```bash
grep -n "markd-outline" src/styles/base.css | head -20
```

Identify the block defining `.markd-outline-item` to place the caret styles next to it.

- [ ] **Step 2: Add caret styles**

Append to the outline section of `src/styles/base.css`:

```css
.markd-outline-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-right: 4px;
  padding: 0;
  background: transparent;
  border: none;
  color: inherit;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.6;
  flex-shrink: 0;
}

.markd-outline-caret:hover {
  opacity: 1;
}

.markd-outline-caret-empty {
  cursor: default;
  pointer-events: none;
}
```

If the existing `.markd-outline-item` rule uses `display: block` or similar, ensure it allows the caret + level + text to lay out horizontally (likely already `display: flex` — confirm; if not, leave a brief note in the commit).

- [ ] **Step 3: Run CSS invariant tests**

Run: `pnpm exec vitest run src/styles/base.test.ts`
Expected: all pass — the regex-based invariants should be untouched by the additive caret styles.

- [ ] **Step 4: Manual verification**

Run: `pnpm dev`. Open a document with nested headings. Verify:
- Parent items show a `▾` caret; click flips to `▸` and hides children.
- Hidden state survives reload.
- Drag-and-drop reorder still works (the caret click stops propagation; the row click does not).
- Alt+Up/Down on a visible item still moves it.
- Clicking a heading row (not the caret) still scrolls the editor to that heading.

Record verification outcome. If a UI test environment is unavailable, state that explicitly.

- [ ] **Step 5: Commit**

```bash
git add src/styles/base.css
git commit -m "feat(outline): caret styles for collapsible sections"
```

---

## Final integration check

- [ ] **Step 1: Full type-check + test run**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: 0 errors, all tests pass.

- [ ] **Step 2: Update `CLAUDE.md`**

Add `Ctrl+Shift+T` to the keyboard-shortcuts list near line ~141 of `CLAUDE.md` (the `**Keyboard shortcuts**` paragraph). Add a brief note about `markd-closed-tabs` and `markd-outline-collapsed` localStorage keys.

- [ ] **Step 3: Update `README.md`**

If `README.md` documents keyboard shortcuts and/or outline features, add the new shortcut and the collapsible-outline behavior.

- [ ] **Step 4: Commit doc updates**

```bash
git add CLAUDE.md README.md
git commit -m "docs: note Ctrl+Shift+T and collapsible outline sections"
```

---

## Self-Review Notes

- **Spec coverage:** Closed tabs (cap 10, persist, named-vs-untitled handling) ✓. Reopen via Ctrl+Shift+T ✓. Collapsible outline with persistence ✓. Drag/reorder preserved ✓.
- **Type consistency:** `ClosedTab` shape used identically in helpers, hook, and `reopenLastClosed` return. `OutlineHeading` matches the subset of `HeadingEntry` consumed by tree helpers.
- **Out of scope (intentionally deferred):**
  - `closeAllTabs` does not currently push to the closed stack. Document this as a known limitation in the commit body of A2 if you want; users can still reopen the last-closed tab from before the bulk close.
  - No keyboard shortcut for "expand all" / "collapse all" — caret-only for v1.
  - No drag-reorder cascade for collapsed sections (already handled by `moveSection` since it moves a heading + body as a unit).
