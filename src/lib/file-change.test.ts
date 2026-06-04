import { describe, it, expect } from "vitest";
import { shouldPromptForExternalChange } from "./file-change";

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
