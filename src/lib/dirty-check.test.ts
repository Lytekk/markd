import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { canRevertClean, docMatchesSaved, parseSavedDoc, sourceModeIsDirty } from "./dirty-check";

let editor: TiptapEditor;

// Mirror App.tsx's useEditor extension set — revert detection compares docs
// produced by tiptap-markdown's setContent override, so the test editor must
// parse markdown the same way the app does.
beforeEach(() => {
  editor = new TiptapEditor({
    extensions: [
      ...getExtensions({ getFileDir: () => "" }),
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-" }),
    ],
  });
});
afterEach(() => editor.destroy());

const MD = "# Title\n\nSome **bold** text.\n\n- one\n- two\n";

describe("docMatchesSaved", () => {
  it("matches right after load (same doc reference)", () => {
    editor.commands.setContent(MD, false);
    const saved = editor.state.doc;
    expect(docMatchesSaved(editor.state.doc, saved, "", "")).toBe(true);
  });

  it("detects an edit, then matches again after undo restores the doc", () => {
    // Constructor content, NOT setContent: a setContent step lands in the
    // same 500ms history group as the edit below, so undo would revert both
    // and travel past the "load". Real usage separates load and typing in
    // time; this mirrors that.
    const ed = new TiptapEditor({
      extensions: [
        ...getExtensions({ getFileDir: () => "" }),
        Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-" }),
      ],
      content: MD,
    });
    try {
      const saved = ed.state.doc;
      ed.commands.insertContent("more");
      expect(docMatchesSaved(ed.state.doc, saved, "", "")).toBe(false);
      ed.commands.undo();
      expect(docMatchesSaved(ed.state.doc, saved, "", "")).toBe(true);
    } finally {
      ed.destroy();
    }
  });

  it("stays unmatched when undo overshoots past a setContent load (the app's real load path)", () => {
    // App.tsx loads via setContent(body, false). A setContent step shares
    // ProseMirror's 500ms history group with an IMMEDIATE edit, so one undo
    // reverts both and travels past the load — the doc goes empty, NOT back
    // to the loaded state. The dirty flag therefore STAYS SET (safe
    // degradation: never falsely clean). This pins that known divergence
    // from the time-separated case above.
    editor.commands.setContent(MD, false);
    const saved = editor.state.doc;
    editor.commands.insertContent("more");
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("");
    expect(docMatchesSaved(editor.state.doc, saved, "", "")).toBe(false);
  });

  it("returns false when there is no saved baseline", () => {
    expect(docMatchesSaved(editor.state.doc, null, "", "")).toBe(false);
  });

  it("returns false when frontmatter differs even if the body matches", () => {
    editor.commands.setContent(MD, false);
    const saved = editor.state.doc;
    expect(docMatchesSaved(editor.state.doc, saved, "---\na: 1\n---", "")).toBe(false);
  });
});

describe("parseSavedDoc", () => {
  it("parses markdown into a doc structurally equal to one loaded via setContent", () => {
    editor.commands.setContent(MD, false);
    const parsed = parseSavedDoc(editor, MD);
    expect(parsed).not.toBeNull();
    expect(editor.state.doc.eq(parsed!)).toBe(true);
  });

  it("round-trips the editor's own serialization", () => {
    editor.commands.setContent(MD, false);
    const serialized = editor.storage.markdown.getMarkdown() as string;
    const parsed = parseSavedDoc(editor, serialized);
    expect(parsed).not.toBeNull();
    expect(editor.state.doc.eq(parsed!)).toBe(true);
  });

  it("produces a non-matching doc for different content", () => {
    editor.commands.setContent(MD, false);
    const parsed = parseSavedDoc(editor, "# Other\n");
    expect(parsed).not.toBeNull();
    expect(editor.state.doc.eq(parsed!)).toBe(false);
  });
});

describe("canRevertClean", () => {
  it("allows clearing dirty for a named file", () => {
    expect(canRevertClean("/p/a.md", "saved text")).toBe(true);
  });

  it("allows clearing dirty for a never-saved untitled buffer", () => {
    expect(canRevertClean(null, "")).toBe(true);
  });

  it("blocks clearing dirty for a detached buffer (trashed file keeps its savedContent)", () => {
    // detachActiveFile sets filePath null but keeps savedContent — there is
    // no on-disk saved state anymore, so 'matches saved' must never clear
    // the unsaved-changes close guard (the buffer may be the only copy).
    expect(canRevertClean(null, "old on-disk content")).toBe(false);
  });
});

describe("sourceModeIsDirty", () => {
  it("is clean when the buffer matches the saved file exactly", () => {
    expect(sourceModeIsDirty("abc", "abc", "entry", true)).toBe(false);
  });

  it("restores the entry dirty flag when the buffer returns to its entry state", () => {
    expect(sourceModeIsDirty("entry", "saved", "entry", false)).toBe(false);
    expect(sourceModeIsDirty("entry", "saved", "entry", true)).toBe(true);
  });

  it("is dirty when the buffer matches neither saved nor entry", () => {
    expect(sourceModeIsDirty("x", "saved", "entry", false)).toBe(true);
  });
});
