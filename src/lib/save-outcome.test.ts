import { describe, expect, it } from "vitest";
import { isSaveFailure, saveOutcomeMessage, type SaveOutcome } from "./save-outcome";

describe("isSaveFailure", () => {
  it("treats only a real write failure as a failure", () => {
    expect(isSaveFailure("failed")).toBe(true);
  });

  it("does not treat a user cancel as a failure", () => {
    expect(isSaveFailure("cancelled")).toBe(false);
  });

  it("does not treat a superseded write as a failure", () => {
    // Typing during a slow network write advances the content revision. The
    // bytes still landed; this call simply no longer owns the state. Reporting
    // it as a failure popped a "could not be saved" modal over a save that
    // actually succeeded.
    expect(isSaveFailure("superseded")).toBe(false);
  });

  it("does not treat a completed write as a failure", () => {
    expect(isSaveFailure("written")).toBe(false);
  });
});

describe("saveOutcomeMessage", () => {
  it("produces a message only for a real failure", () => {
    expect(saveOutcomeMessage("failed", "notes.md")).toContain("notes.md");
    expect(saveOutcomeMessage("failed", "notes.md")).toContain("remain unsaved");
  });

  it("stays silent for outcomes the user caused or that already succeeded", () => {
    for (const outcome of ["written", "cancelled", "superseded"] as SaveOutcome[]) {
      expect(saveOutcomeMessage(outcome, "notes.md"), outcome).toBeNull();
    }
  });

  it("reports a failed save of an untitled document too", () => {
    // Previously the error dialog was gated on the document already having a
    // path, so a failed Save As of an untitled buffer was completely silent.
    expect(saveOutcomeMessage("failed", "Untitled")).toContain("Untitled");
  });
});
