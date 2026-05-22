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
