import { describe, it, expect } from "vitest";
import { isBlockActive, buildFocusDecorations, nextScrollPos } from "./focus-mode";
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
  // Five single-char paragraphs: blocks [0,3) [3,6) [6,9) [9,12) [12,15).
  const doc = createTestDoc([
    { type: "paragraph", text: "a" },
    { type: "paragraph", text: "b" },
    { type: "paragraph", text: "c" },
    { type: "paragraph", text: "d" },
    { type: "paragraph", text: "e" },
  ]);

  const classOf = (d: unknown) =>
    (d as { type?: { attrs?: { class?: string } } }).type?.attrs?.class;
  const count = (set: ReturnType<typeof buildFocusDecorations>, cls: string) =>
    set.find().filter((d) => classOf(d) === cls).length;

  it("feathers the caret block: active, adjacent blocks 'near', rest dimmed", () => {
    const set = buildFocusDecorations(doc, 7, 7); // caret in the middle block (idx 2) [6,9)
    expect(set.find().length).toBe(5);
    expect(count(set, "focus-active")).toBe(1);
    expect(count(set, "focus-near")).toBe(2); // the blocks above and below
    expect(count(set, "focus-dimmed")).toBe(2);
    expect(set.find().find((d) => classOf(d) === "focus-active")!.from).toBe(6);
  });

  it("keeps every touched block active for a multi-block selection, feathering the edges", () => {
    const set = buildFocusDecorations(doc, 1, 7); // spans blocks 1-3 (idx 0,1,2)
    expect(count(set, "focus-active")).toBe(3);
    expect(count(set, "focus-near")).toBe(1); // block idx 3 (after the active run)
    expect(count(set, "focus-dimmed")).toBe(1); // block idx 4
  });
});

describe("nextScrollPos (scroll vs caret arbitration)", () => {
  it("adopts a scroll position when one is provided", () => {
    expect(nextScrollPos(null, { selectionSet: false, metaScrollPos: 42 })).toBe(42);
  });

  it("reverts to the caret (null) when the user moves the selection", () => {
    expect(nextScrollPos(42, { selectionSet: true, metaScrollPos: undefined })).toBeNull();
  });

  it("preserves the scroll position across non-selection transactions", () => {
    expect(nextScrollPos(42, { selectionSet: false, metaScrollPos: undefined })).toBe(42);
  });

  it("lets a scroll update win even in a transaction that also set the selection", () => {
    expect(nextScrollPos(10, { selectionSet: true, metaScrollPos: 99 })).toBe(99);
  });
});
