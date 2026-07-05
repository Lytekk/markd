import { describe, it, expect } from "vitest";
import {
  buildSearchRegex,
  findTextRanges,
  replaceAllRanges,
  wordAt,
} from "./text-search";

// Plain-string twin of search-and-replace.ts's findMatches — one regex builder
// shared by both backends so PM and textarea search can never drift on
// case/word/regex semantics.

describe("buildSearchRegex", () => {
  it("escapes literals (a $5 \\| price is a literal, not a regex)", () => {
    const { regex, error } = buildSearchRegex({ searchTerm: "a $5 |", caseSensitive: false, useRegex: false, wholeWord: false });
    expect(error).toBeNull();
    expect("costs a $5 | fee".match(regex!)![0]).toBe("a $5 |");
  });

  it("case flag and whole-word boundaries behave like the PM extension", () => {
    const ci = buildSearchRegex({ searchTerm: "cat", caseSensitive: false, useRegex: false, wholeWord: true }).regex!;
    expect("Cat scatter cat".match(ci)).not.toBeNull();
    expect("scatter".match(ci)).toBeNull();
    const cs = buildSearchRegex({ searchTerm: "cat", caseSensitive: true, useRegex: false, wholeWord: false }).regex!;
    expect("Cat".match(cs)).toBeNull();
  });

  it("reports invalid user regex as error, not a throw", () => {
    const { regex, error } = buildSearchRegex({ searchTerm: "(", caseSensitive: false, useRegex: true, wholeWord: false });
    expect(regex).toBeNull();
    expect(error).toBeTruthy();
  });
});

describe("findTextRanges", () => {
  const opts = { caseSensitive: false, useRegex: false, wholeWord: false };

  it("finds all ranges with correct offsets", () => {
    const { results, error } = findTextRanges("abc ABC abc", { ...opts, searchTerm: "abc" });
    expect(error).toBeNull();
    expect(results).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("returns empty for empty term and guards zero-length regex matches", () => {
    expect(findTextRanges("abc", { ...opts, searchTerm: "" }).results).toEqual([]);
    // a* matches zero-length everywhere — must terminate and only return real spans
    const { results } = findTextRanges("baaab", { ...opts, useRegex: true, searchTerm: "a*" });
    expect(results).toEqual([{ start: 1, end: 4 }]);
  });

  it("surfaces regex errors like the PM path", () => {
    const { results, error } = findTextRanges("x", { ...opts, useRegex: true, searchTerm: "[" });
    expect(results).toEqual([]);
    expect(error).toBeTruthy();
  });
});

describe("replaceAllRanges", () => {
  it("replaces every range in one pass without offset drift", () => {
    const text = "cat cathedral cat";
    const { results } = findTextRanges(text, { searchTerm: "cat", caseSensitive: false, useRegex: false, wholeWord: true });
    expect(replaceAllRanges(text, results, "dog")).toBe("dog cathedral dog");
  });

  it("handles replacement text longer and shorter than the match", () => {
    const text = "aa bb aa";
    const { results } = findTextRanges(text, { searchTerm: "aa", caseSensitive: false, useRegex: false, wholeWord: false });
    expect(replaceAllRanges(text, results, "cccc")).toBe("cccc bb cccc");
    expect(replaceAllRanges(text, results, "")).toBe(" bb ");
  });
});

describe("wordAt", () => {
  it("expands to the word under the caret (Ctrl+F3 seed)", () => {
    expect(wordAt("hello brave world", 8)).toBe("brave");
    expect(wordAt("hello brave world", 6)).toBe("brave"); // at word start
  });

  it("returns empty between words and at boundaries with no word", () => {
    expect(wordAt("a  b", 2)).toBe("");
    expect(wordAt("", 0)).toBe("");
  });
});
