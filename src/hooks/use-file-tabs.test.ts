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
