import { describe, expect, it, vi } from "vitest";
import { currentMarkdown, currentDocJSON, editorBufferIsClean } from "./source-truth";

// These accessors are the single seam through which every consumer asks "what
// is the buffer's current content?" — tab snapshots (newTab / openInTab /
// switchTab / reopenLastClosed), the closed-tab stack, Ctrl+S, Save As, and
// the 30s autosave. The regression they pin: in source mode those consumers
// serialized the STALE ProseMirror editor (which holds the doc from source-mode
// entry), silently dropping every textarea edit since entry.

describe("currentMarkdown", () => {
  it("returns the textarea verbatim in source mode without consulting the editor", () => {
    const editorMarkdown = vi.fn(() => "# STALE entry-time doc");
    // Byte-hostile content: CRLF, currency $, escaped pipe, trailing space + newline.
    const raw = "---\ntitle: x\n---\r\n# h\r\n\r\nprice $5 a\\|b  \n";
    expect(currentMarkdown(true, raw, editorMarkdown)).toBe(raw);
    expect(editorMarkdown).not.toHaveBeenCalled();
  });

  it("delegates to the editor serializer in rendered mode", () => {
    const editorMarkdown = vi.fn(() => "# live doc");
    expect(currentMarkdown(false, "ignored leftover textarea text", editorMarkdown)).toBe("# live doc");
    expect(editorMarkdown).toHaveBeenCalledTimes(1);
  });
});

describe("currentDocJSON", () => {
  it("returns undefined in source mode — the stale editor JSON must never become a restore cache", () => {
    const editorJSON = vi.fn(() => ({ type: "doc", content: [] }));
    expect(currentDocJSON(true, editorJSON)).toBeUndefined();
    expect(editorJSON).not.toHaveBeenCalled();
  });

  it("delegates in rendered mode", () => {
    const json = { type: "doc", content: [{ type: "paragraph" }] };
    expect(currentDocJSON(false, () => json)).toBe(json);
  });
});

describe("editorBufferIsClean", () => {
  it("is never clean in source mode, even when the editor doc matches saved", () => {
    // The data-loss case: doc.eq(saved) is TRUE (the editor never saw the
    // textarea edits) while the textarea diverges — a clean-skip here would
    // snapshot stale tab content.
    const editorMatchesSaved = vi.fn(() => true);
    expect(editorBufferIsClean(true, editorMatchesSaved)).toBe(false);
    expect(editorMatchesSaved).not.toHaveBeenCalled();
  });

  it("delegates to the doc.eq predicate in rendered mode", () => {
    expect(editorBufferIsClean(false, () => true)).toBe(true);
    expect(editorBufferIsClean(false, () => false)).toBe(false);
  });
});
