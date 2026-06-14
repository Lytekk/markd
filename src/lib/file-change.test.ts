import { describe, it, expect } from "vitest";
import { shouldPromptForExternalChange, shouldPromptForDeletion } from "./file-change";

// Content-based detection: compare on-disk content to what Markd last
// loaded/saved. Prompt EVERY time the disk differs (so re-editing + switching
// back always re-prompts); duplicate OS events for one save are absorbed by the
// caller's promptOpen guard.
describe("shouldPromptForExternalChange", () => {
  it("prompts when on-disk content differs from what Markd saved/loaded", () => {
    expect(shouldPromptForExternalChange("external edit", "original", false)).toBe(true);
  });

  it("prompts again for a second, different external change", () => {
    expect(shouldPromptForExternalChange("edit two", "original", false)).toBe(true);
  });

  it("does not prompt when disk matches saved content (Markd's own save / identical)", () => {
    expect(shouldPromptForExternalChange("same", "same", false)).toBe(false);
  });

  it("does not prompt while a prompt is already open (absorbs duplicate save events)", () => {
    expect(shouldPromptForExternalChange("external edit", "original", true)).toBe(false);
  });
});

// A file the active tab points at can be deleted/moved out from under us. The
// watcher's read then fails; a definitive existence check (path_exists) tells a
// true deletion apart from a transient mid-atomic-save read failure. We prompt
// once (Keep in editor / Close tab) — never while a prompt is already open.
describe("shouldPromptForDeletion", () => {
  it("prompts when the file no longer exists on disk", () => {
    expect(shouldPromptForDeletion(false, false)).toBe(true);
  });

  it("does not prompt when the file still exists (read failure was transient)", () => {
    expect(shouldPromptForDeletion(true, false)).toBe(false);
  });

  it("does not prompt while a prompt is already open (no stacked dialogs)", () => {
    expect(shouldPromptForDeletion(false, true)).toBe(false);
  });
});
