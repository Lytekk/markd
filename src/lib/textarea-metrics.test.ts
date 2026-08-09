import { describe, it, expect } from "vitest";
import { lineHeightsFromBoundaries, lineStartOffsets } from "./textarea-metrics";

// Pure companion to the layout-dependent mirror measurement (which is
// live-verified — jsdom has no layout): the gutter's logical-line starts.

describe("lineStartOffsets", () => {
  it("returns the start offset of every logical line, including a trailing empty one", () => {
    expect(lineStartOffsets("a\nbb\n")).toEqual([0, 2, 5]);
  });

  it("single line and empty text", () => {
    expect(lineStartOffsets("abc")).toEqual([0]);
    expect(lineStartOffsets("")).toEqual([0]);
  });

  it("consecutive newlines produce empty-line rows (textarea parity)", () => {
    expect(lineStartOffsets("a\n\nb")).toEqual([0, 2, 3]);
  });
});

describe("lineHeightsFromBoundaries", () => {
  it("includes the full height of a wrapped final logical line", () => {
    expect(lineHeightsFromBoundaries([30, 57, 84, 300])).toEqual([27, 27, 216]);
  });

  it("preserves one row for consecutive blanks and a trailing empty line", () => {
    expect(lineHeightsFromBoundaries([30, 57, 84, 111, 138])).toEqual([27, 27, 27, 27]);
  });
});
