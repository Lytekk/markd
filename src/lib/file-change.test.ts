import { describe, it, expect } from "vitest";
import { shouldPromptReload } from "./file-change";

// The watcher invariant, shared by the 2s mtime poll AND the window-refocus
// check in App.tsx: prompt only when the file's mtime advanced past the baseline
// and no prompt is already open. Null mtimes (startup race) never prompt.
describe("shouldPromptReload", () => {
  it("prompts when the current mtime is strictly greater than the baseline", () => {
    expect(shouldPromptReload(1000, 2000, false)).toBe(true);
  });

  it("does not prompt when the mtimes are equal (no change)", () => {
    expect(shouldPromptReload(2000, 2000, false)).toBe(false);
  });

  it("does not prompt when the current mtime is older than the baseline", () => {
    expect(shouldPromptReload(2000, 1000, false)).toBe(false);
  });

  it("does not prompt when a prompt is already open (no stacked dialogs)", () => {
    expect(shouldPromptReload(1000, 2000, true)).toBe(false);
  });

  it("does not prompt when the baseline is null (before the first stat seeds it)", () => {
    expect(shouldPromptReload(null, 2000, false)).toBe(false);
  });

  it("does not prompt when the current mtime is null (stat returned no mtime)", () => {
    expect(shouldPromptReload(1000, null, false)).toBe(false);
  });
});
