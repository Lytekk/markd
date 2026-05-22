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
