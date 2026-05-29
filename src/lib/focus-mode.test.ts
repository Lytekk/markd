import { describe, it, expect } from "vitest";
import { isBlockActive, buildFocusDecorations } from "./focus-mode";
import { createTestDoc } from "@/test/editor-helpers";

// Top-level block layout for "first"/"second"/"third" paragraphs:
//   block 1 [0,7)  block 2 [7,15)  block 3 [15,22)
describe("isBlockActive", () => {
  it("is active when the caret is inside the block", () => {
    expect(isBlockActive(0, 7, 3, 3)).toBe(true);
  });

  it("uses a half-open [from,to) with start-wins at a block boundary", () => {
    // caret at pos 7 belongs to the block that STARTS there, not the one ending there
    expect(isBlockActive(7, 15, 7, 7)).toBe(true);
    expect(isBlockActive(0, 7, 7, 7)).toBe(false);
  });

  it("is inactive when the caret is in a different block", () => {
    expect(isBlockActive(7, 15, 3, 3)).toBe(false);
  });

  it("is active when a selection overlaps the block", () => {
    expect(isBlockActive(0, 7, 3, 10)).toBe(true);
    expect(isBlockActive(7, 15, 3, 10)).toBe(true);
    expect(isBlockActive(15, 22, 3, 10)).toBe(false); // block past the selection end
  });
});

describe("buildFocusDecorations", () => {
  const doc = createTestDoc([
    { type: "paragraph", text: "first" },
    { type: "paragraph", text: "second" },
    { type: "paragraph", text: "third" },
  ]);

  const classOf = (d: unknown) =>
    (d as { type?: { attrs?: { class?: string } } }).type?.attrs?.class;

  it("decorates every top-level block, exactly one active for a caret", () => {
    const set = buildFocusDecorations(doc, 10, 10); // caret inside the 2nd paragraph [7,15)
    const all = set.find();
    expect(all.length).toBe(3);
    const active = all.filter((d) => classOf(d) === "focus-active");
    expect(active.length).toBe(1);
    expect(active[0]!.from).toBe(7); // the 2nd block
    expect(all.filter((d) => classOf(d) === "focus-dimmed").length).toBe(2);
  });

  it("keeps every touched block active for a multi-block selection", () => {
    const set = buildFocusDecorations(doc, 3, 18); // spans blocks 1, 2, 3
    const active = set.find().filter((d) => classOf(d) === "focus-active");
    expect(active.length).toBe(3);
  });
});
