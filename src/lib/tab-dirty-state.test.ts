import { describe, expect, it } from "vitest";
import { liveDirtyTabs, tabIsLiveDirty } from "./tab-dirty-state";

const tabs = [
  { id: "active", fileName: "active.md", isDirty: false },
  { id: "background", fileName: "background.md", isDirty: true },
  { id: "clean", fileName: "clean.md", isDirty: false },
];

describe("live tab dirty state", () => {
  it("treats the synchronous active buffer state as authoritative", () => {
    expect(tabIsLiveDirty(tabs[0]!, "active", true)).toBe(true);
    expect(tabIsLiveDirty(tabs[0]!, "active", false)).toBe(false);
  });

  it("preserves dirty background tabs while adding a not-yet-mirrored active edit", () => {
    expect(liveDirtyTabs(tabs, "active", true).map((tab) => tab.id)).toEqual([
      "active",
      "background",
    ]);
  });

  it("does not apply the active buffer flag to a different tab", () => {
    expect(tabIsLiveDirty(tabs[2]!, "active", true)).toBe(false);
  });
});
