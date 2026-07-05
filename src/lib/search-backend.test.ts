import { describe, it, expect, vi } from "vitest";
import { textareaSearchBackend } from "./search-backend";
import type { TextRange } from "./text-search";

// The textarea backend must mirror the PM extension's semantics exactly
// (search-and-replace.ts): apply resets to the first match; next/prev wrap;
// replace clamps the index; replaceAll empties; clear keeps the term so F3
// can resume; findNext re-runs a dry search then ADVANCES (PM parity).

const OPTS = { caseSensitive: false, useRegex: false, wholeWord: false };

function makeBackend(initialText: string) {
  let text = initialText;
  const setText = vi.fn((t: string) => { text = t; });
  const reveal = vi.fn();
  const onResults = vi.fn();
  const ta = document.createElement("textarea");
  ta.value = text;
  const backend = textareaSearchBackend({
    getText: () => text,
    setText,
    getTextarea: () => ta,
    onResults,
    reveal,
  });
  return { backend, setText, reveal, onResults, ta, text: () => text };
}

describe("textareaSearchBackend", () => {
  it("apply finds ranges, selects the first, reports results", () => {
    const { backend, onResults, reveal } = makeBackend("cat dog cat");
    backend.apply({ ...OPTS, searchTerm: "cat" });
    expect(backend.getState()).toEqual({ count: 2, currentIndex: 0, error: null });
    expect(onResults).toHaveBeenLastCalledWith(
      [{ start: 0, end: 3 }, { start: 8, end: 11 }] as TextRange[],
      0,
    );
    expect(reveal).toHaveBeenCalled();
  });

  it("next and prev wrap around like nextMatch/previousMatch", () => {
    const { backend } = makeBackend("a b a b a");
    backend.apply({ ...OPTS, searchTerm: "a" });
    backend.next();
    expect(backend.getState().currentIndex).toBe(1);
    backend.next();
    backend.next();
    expect(backend.getState().currentIndex).toBe(0); // wrapped
    backend.prev();
    expect(backend.getState().currentIndex).toBe(2); // wrapped back
  });

  it("replace splices the current match and clamps the index (PM parity)", () => {
    const { backend, setText, text } = makeBackend("cat dog cat");
    backend.apply({ ...OPTS, searchTerm: "cat" });
    backend.next(); // current = last match
    backend.replace("bird");
    expect(setText).toHaveBeenCalledWith("cat dog bird");
    expect(text()).toBe("cat dog bird");
    // one match left; index clamped from 1 to 0
    expect(backend.getState()).toEqual({ count: 1, currentIndex: 0, error: null });
  });

  it("replaceAll rewrites every match in one setText and empties results", () => {
    const { backend, setText } = makeBackend("cat dog cat");
    backend.apply({ ...OPTS, searchTerm: "cat" });
    backend.replaceAll("bird");
    expect(setText).toHaveBeenCalledTimes(1);
    expect(setText).toHaveBeenCalledWith("bird dog bird");
    expect(backend.getState()).toEqual({ count: 0, currentIndex: -1, error: null });
  });

  it("clear drops results but keeps the term; findNext resumes with it (F3)", () => {
    const { backend } = makeBackend("x y x");
    backend.apply({ ...OPTS, searchTerm: "x" });
    backend.clear();
    expect(backend.getState().count).toBe(0);
    backend.findNext();
    // PM findNext: dry runSearch (index 0) then advance → index 1 of 2
    expect(backend.getState()).toEqual({ count: 2, currentIndex: 1, error: null });
  });

  it("findNext seeds the fallback term when none is retained", () => {
    const { backend } = makeBackend("q w q");
    backend.findNext("q");
    expect(backend.getState().count).toBe(2);
  });

  it("recomputes on textarea input, preserving the index when still valid", () => {
    const { backend, ta } = makeBackend("m m m");
    backend.apply({ ...OPTS, searchTerm: "m" });
    const onChange = vi.fn();
    backend.subscribe(onChange);
    backend.next();
    ta.value = "m m m m";
    ta.dispatchEvent(new Event("input"));
    expect(onChange).toHaveBeenCalled();
    expect(backend.getState()).toEqual({ count: 4, currentIndex: 1, error: null });
  });

  it("surfaces regex errors through getState", () => {
    const { backend } = makeBackend("abc");
    backend.apply({ ...OPTS, useRegex: true, searchTerm: "(" });
    expect(backend.getState().count).toBe(0);
    expect(backend.getState().error).toBeTruthy();
  });
});

describe("input rebinding (highlights stay live with the panel closed)", () => {
  it("recomputes on textarea input even with NO subscriber (F3-with-panel-closed parity)", () => {
    const { backend, ta } = makeBackend("z z");
    backend.findNext("z"); // panel closed: results exist, nobody subscribed
    expect(backend.getState().count).toBe(2);
    ta.value = "z z z";
    ta.dispatchEvent(new Event("input"));
    expect(backend.getState().count).toBe(3);
  });

  it("drops the input binding once results are cleared (no idle listener)", () => {
    const { backend, ta } = makeBackend("z z");
    backend.apply({ ...OPTS, searchTerm: "z" });
    backend.clear();
    ta.value = "z z z";
    ta.dispatchEvent(new Event("input"));
    expect(backend.getState().count).toBe(0); // cleared stays cleared
  });
});

describe("refresh", () => {
  it("recomputes from the live buffer and renotifies (mount-window self-heal)", () => {
    const { backend, onResults, ta } = makeBackend("k k");
    backend.apply({ ...OPTS, searchTerm: "k" });
    // Buffer changed behind the backend's back (no input event delivered).
    ta.value = "k k k";
    onResults.mockClear();
    backend.refresh();
    expect(backend.getState().count).toBe(2); // getText still returns old text
    expect(onResults).toHaveBeenCalled();
  });
});
