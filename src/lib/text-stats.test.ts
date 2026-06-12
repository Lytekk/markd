import { describe, it, expect } from "vitest";
import { computeTextStats } from "./text-stats";

describe("computeTextStats", () => {
  it("returns zeros for empty text", () => {
    expect(computeTextStats("")).toEqual({ words: 0, chars: 0 });
  });

  it("counts whitespace-separated words and raw characters", () => {
    expect(computeTextStats("hello world")).toEqual({ words: 2, chars: 11 });
  });

  it("collapses runs of whitespace (newlines, tabs) into single separators", () => {
    expect(computeTextStats("a\n\nb\tc  d").words).toBe(4);
  });

  it("does not count leading/trailing whitespace as words", () => {
    expect(computeTextStats("  word  ").words).toBe(1);
  });

  it("counts whitespace-only text as zero words but keeps the char length", () => {
    expect(computeTextStats("   ")).toEqual({ words: 0, chars: 3 });
  });
});
