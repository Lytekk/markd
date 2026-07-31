import { describe, expect, it } from "vitest";
import { reloadDiscardPrompt } from "./reload-guard";

describe("reloadDiscardPrompt", () => {
  it("does not prompt when nothing is dirty", () => {
    expect(reloadDiscardPrompt([])).toBeNull();
  });

  it("names the single dirty document", () => {
    // Ctrl+R is a browser reflex. Reloading from disk used to overwrite unsaved
    // edits with no prompt and no undo — loadEditorContent resets PM history.
    const prompt = reloadDiscardPrompt(["notes.md"]);
    expect(prompt!.message).toContain("notes.md");
    expect(prompt!.message).toContain("unsaved");
  });

  it("counts multiple dirty documents", () => {
    const prompt = reloadDiscardPrompt(["a.md", "b.md", "c.md"]);
    expect(prompt!.message).toContain("3 open files");
  });

  it("says the edits are discarded, not saved", () => {
    for (const names of [["a.md"], ["a.md", "b.md"]]) {
      expect(reloadDiscardPrompt(names)!.message).toContain("discarded");
    }
  });
});
