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
    expect(result.current.closedStack[result.current.closedStack.length - 1]!.filePath).toBe("/tmp/f-11.md");
    expect(result.current.closedStack.some((t) => t.filePath === "/tmp/f-0.md")).toBe(false);
  });
});

describe("useFileTabs — MRU / quick-switch ordering", () => {
  beforeEach(() => localStorage.clear());

  it("exposes getMru with the active tab most-recent first", () => {
    const { result } = renderHook(() => useFileTabs());
    const first = result.current.tabs[0]!.id;
    expect(result.current.getMru()[0]).toBe(first);
  });

  it("moves a switched-to tab to the front of the MRU", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "A"); });
    act(() => { result.current.openInTab("b.md", "/tmp/b.md", "B"); });
    const aId = result.current.tabs.find((t) => t.filePath === "/tmp/a.md")!.id;
    act(() => { result.current.switchTab(aId); });
    expect(result.current.getMru()[0]).toBe(aId);
  });

  it("prunes a closed (non-active) tab from the MRU list", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "A"); });
    const aId = result.current.tabs.find((t) => t.filePath === "/tmp/a.md")!.id;
    act(() => { result.current.openInTab("b.md", "/tmp/b.md", "B"); });
    act(() => { result.current.closeTab(aId); });
    expect(result.current.getMru()).not.toContain(aId);
  });
});

describe("useFileTabs — updateTabPath (file renamed/moved on disk)", () => {
  beforeEach(() => localStorage.clear());

  it("updates the target tab's path and name in place", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "A"); });
    const id = result.current.tabs.find((t) => t.filePath === "/tmp/a.md")!.id;
    act(() => { result.current.updateTabPath(id, "/tmp/renamed.md", "renamed.md"); });
    const tab = result.current.tabs.find((t) => t.id === id)!;
    expect(tab.filePath).toBe("/tmp/renamed.md");
    expect(tab.fileName).toBe("renamed.md");
  });

  it("leaves other tabs untouched", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "A"); });
    act(() => { result.current.openInTab("b.md", "/tmp/b.md", "B"); });
    const aId = result.current.tabs.find((t) => t.filePath === "/tmp/a.md")!.id;
    act(() => { result.current.updateTabPath(aId, "/tmp/a2.md", "a2.md"); });
    const b = result.current.tabs.find((t) => t.filePath === "/tmp/b.md");
    expect(b!.fileName).toBe("b.md");
  });
});

describe("useFileTabs — markTabClean (revert-to-saved clears the indicator)", () => {
  beforeEach(() => localStorage.clear());

  it("clears the active tab's dirty flag", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.markTabDirty(); });
    const activeId = result.current.activeTabId;
    expect(result.current.tabs.find((t) => t.id === activeId)!.isDirty).toBe(true);
    act(() => { result.current.markTabClean(); });
    expect(result.current.tabs.find((t) => t.id === activeId)!.isDirty).toBe(false);
  });

  it("leaves other tabs' dirty flags untouched", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "A"); });
    const aId = result.current.tabs.find((t) => t.filePath === "/tmp/a.md")!.id;
    act(() => { result.current.markTabDirty(aId); });
    act(() => { result.current.openInTab("b.md", "/tmp/b.md", "B"); });
    act(() => { result.current.markTabDirty(); });
    act(() => { result.current.markTabClean(); });
    expect(result.current.tabs.find((t) => t.id === aId)!.isDirty).toBe(true);
    const activeId = result.current.activeTabId;
    expect(result.current.tabs.find((t) => t.id === activeId)!.isDirty).toBe(false);
  });
});

describe("useFileTabs — unsaved-edit snapshots survive tab creation (batching clobber)", () => {
  beforeEach(() => localStorage.clear());

  it("newTab preserves the departing tab's unsaved content", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.registerGetMarkdown(() => "EDITED CONTENT"); });
    const firstId = result.current.activeTabId;
    // snapshot + create are batched into one React flush — the snapshot's
    // functional update must not be clobbered by the create's setTabs.
    act(() => { result.current.newTab(); });
    expect(result.current.tabs.find((t) => t.id === firstId)!.content).toBe("EDITED CONTENT");
  });

  it("openInTab (new file) preserves the departing tab's unsaved content", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.registerGetMarkdown(() => "EDITED"); });
    // dirty first tab → openInTab's untitled-reuse branch is skipped (mirrors
    // the real app, where typing marks the tab dirty)
    act(() => { result.current.markTabDirty(); });
    const firstId = result.current.activeTabId;
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "A"); });
    expect(result.current.tabs.find((t) => t.id === firstId)!.content).toBe("EDITED");
  });

  it("reopenLastClosed (untitled) preserves the departing tab's unsaved content", () => {
    localStorage.setItem(
      CLOSED_STACK_KEY,
      JSON.stringify([{ id: "z", fileName: "Untitled", filePath: null, scrollTop: 0, content: "old" }]),
    );
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.registerGetMarkdown(() => "KEEP ME"); });
    act(() => { result.current.markTabDirty(); });
    const firstId = result.current.activeTabId;
    act(() => { result.current.reopenLastClosed(); });
    expect(result.current.tabs.find((t) => t.id === firstId)!.content).toBe("KEEP ME");
  });
});

describe("useFileTabs — skip markdown serialize when the buffer is clean", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the departing tab's existing content (skips getMarkdown) when clean, and still caches docJSON", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "AAA"); });
    act(() => { result.current.openInTab("b.md", "/tmp/b.md", "BBB"); });
    let getMarkdownCalls = 0;
    act(() => {
      result.current.registerGetMarkdown(() => { getMarkdownCalls++; return "SERIALIZED"; });
      result.current.registerGetJSON(() => ({ type: "doc", content: [{ type: "paragraph" }] }));
      result.current.registerIsClean(() => true);
    });
    const aId = result.current.tabs.find((t) => t.filePath === "/tmp/a.md")!.id;
    const bId = result.current.tabs.find((t) => t.filePath === "/tmp/b.md")!.id;
    act(() => { result.current.switchTab(aId); }); // leaving b (active + clean)
    const b = result.current.tabs.find((t) => t.id === bId)!;
    expect(b.content).toBe("BBB"); // existing content kept, NOT the serialize
    expect(getMarkdownCalls).toBe(0); // serialize skipped
    expect(b.docJSON).toEqual({ type: "doc", content: [{ type: "paragraph" }] }); // JSON still cached
  });

  it("serializes via getMarkdown when the buffer is NOT clean", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "AAA"); });
    act(() => { result.current.openInTab("b.md", "/tmp/b.md", "BBB"); });
    act(() => {
      result.current.registerGetMarkdown(() => "SERIALIZED");
      result.current.registerIsClean(() => false);
    });
    const aId = result.current.tabs.find((t) => t.filePath === "/tmp/a.md")!.id;
    const bId = result.current.tabs.find((t) => t.filePath === "/tmp/b.md")!.id;
    act(() => { result.current.switchTab(aId); });
    expect(result.current.tabs.find((t) => t.id === bId)!.content).toBe("SERIALIZED");
  });

  it("defaults to serialize (getMarkdown) when no isClean is registered — the safe default", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "AAA"); });
    act(() => { result.current.openInTab("b.md", "/tmp/b.md", "BBB"); });
    act(() => { result.current.registerGetMarkdown(() => "SERIALIZED"); }); // no registerIsClean
    const aId = result.current.tabs.find((t) => t.filePath === "/tmp/a.md")!.id;
    const bId = result.current.tabs.find((t) => t.filePath === "/tmp/b.md")!.id;
    act(() => { result.current.switchTab(aId); });
    expect(result.current.tabs.find((t) => t.id === bId)!.content).toBe("SERIALIZED");
  });
});

describe("useFileTabs — source-mode snapshots (content-truth accessors)", () => {
  beforeEach(() => localStorage.clear());

  it("a getJSON returning undefined (source mode) overwrites a prior docJSON cache", () => {
    const { result } = renderHook(() => useFileTabs());
    act(() => { result.current.openInTab("a.md", "/tmp/a.md", "AAA"); });
    act(() => { result.current.openInTab("b.md", "/tmp/b.md", "BBB"); });
    // Rendered mode first: leaving b caches its PM JSON.
    act(() => {
      result.current.registerGetMarkdown(() => "RENDERED");
      result.current.registerGetJSON(() => ({ type: "doc", content: [] }));
      result.current.registerIsClean(() => false);
    });
    const aId = result.current.tabs.find((t) => t.filePath === "/tmp/a.md")!.id;
    const bId = result.current.tabs.find((t) => t.filePath === "/tmp/b.md")!.id;
    act(() => { result.current.switchTab(aId); }); // leaving b caches its JSON
    expect(result.current.tabs.find((t) => t.id === bId)!.docJSON).toEqual({ type: "doc", content: [] });
    // Source mode: App registers accessors that answer from the textarea and
    // report NO cache (source-truth.ts). Leaving b again must DROP the stale
    // cache — otherwise switch-back would restore the stale JSON over the
    // verbatim textarea content (data loss via the fast path).
    act(() => {
      result.current.registerGetMarkdown(() => "TEXTAREA VERBATIM");
      result.current.registerGetJSON(() => undefined);
      result.current.registerIsClean(() => false);
    });
    act(() => { result.current.switchTab(bId); });
    act(() => { result.current.switchTab(aId); }); // leave b in "source mode"
    const b = result.current.tabs.find((t) => t.id === bId)!;
    expect(b.content).toBe("TEXTAREA VERBATIM");
    expect(b.docJSON).toBeUndefined();
  });
});
