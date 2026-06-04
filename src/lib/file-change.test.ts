import { describe, it, expect } from "vitest";
import { shouldPromptForExternalChange } from "./file-change";

// Content-based detection (replaces the old mtime predicate): compare the on-disk
// content to the version Markd last loaded/saved. Robust where mtime is not —
// cannot false-positive on Markd's own save, and re-prompting for an
// already-declined change is suppressed via lastPromptedContent.
describe("shouldPromptForExternalChange", () => {
  it("prompts when on-disk content differs from what Markd saved/loaded", () => {
    expect(shouldPromptForExternalChange("external edit", "original", null, false)).toBe(true);
  });

  it("does not prompt when disk matches saved content (Markd's own save / identical)", () => {
    expect(shouldPromptForExternalChange("same", "same", null, false)).toBe(false);
  });

  it("does not re-prompt for a change the user already declined (same disk content)", () => {
    expect(shouldPromptForExternalChange("external edit", "original", "external edit", false)).toBe(false);
  });

  it("prompts again for a NEW external change after a prior decline", () => {
    expect(shouldPromptForExternalChange("newer edit", "original", "external edit", false)).toBe(true);
  });

  it("does not prompt while a prompt is already open (no stacked dialogs)", () => {
    expect(shouldPromptForExternalChange("external edit", "original", null, true)).toBe(false);
  });
});
