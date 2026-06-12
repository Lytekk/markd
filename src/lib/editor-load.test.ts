import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { loadEditorContent } from "./editor-load";
import { docMatchesSaved } from "./dirty-check";

let editor: TiptapEditor;

beforeEach(() => {
  editor = new TiptapEditor({
    extensions: [
      ...getExtensions({ getFileDir: () => "" }),
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-" }),
    ],
  });
});
afterEach(() => editor.destroy());

const DOC_A = "# Tab A\n\nalpha content\n";
const DOC_B = "# Tab B\n\nbeta content\n";

describe("loadEditorContent (history isolation across loads)", () => {
  it("undo after a load is a no-op — it can NEVER restore the previous tab's doc", () => {
    // The incident: one shared PM instance hosts every tab's doc; a plain
    // setContent records the swap as an undoable step, so Ctrl+Z after a
    // tab switch pulled the PREVIOUS tab's document into the current tab
    // (autosave would then write the wrong doc to the file).
    loadEditorContent(editor, DOC_A);
    loadEditorContent(editor, DOC_B);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toContain("beta content");
    expect(editor.state.doc.textContent).not.toContain("alpha content");
  });

  it("undo after typing stops AT the loaded doc (no overshoot past the load)", () => {
    loadEditorContent(editor, DOC_A);
    const saved = editor.state.doc;
    editor.commands.insertContent("typed");
    editor.commands.undo();
    expect(editor.state.doc.textContent).toContain("alpha content");
    expect(docMatchesSaved(editor.state.doc, saved, "", "")).toBe(true);
  });

  it("repeated undo across multiple sequential loads never resurrects an earlier doc", () => {
    loadEditorContent(editor, "# One\n");
    loadEditorContent(editor, "# Two\n");
    loadEditorContent(editor, DOC_B);
    for (let i = 0; i < 10; i++) editor.commands.undo();
    expect(editor.state.doc.textContent).toContain("Tab B");
  });

  it("redo cannot cross a load boundary either", () => {
    loadEditorContent(editor, DOC_A);
    editor.commands.insertContent("typed");
    editor.commands.undo();
    loadEditorContent(editor, DOC_B);
    editor.commands.redo();
    expect(editor.state.doc.textContent).toContain("beta content");
    expect(editor.state.doc.textContent).not.toContain("typed");
  });

  it("normal undo/redo still works within one loaded doc", () => {
    loadEditorContent(editor, DOC_A);
    editor.commands.insertContent("typed");
    editor.commands.undo();
    expect(editor.state.doc.textContent).not.toContain("typed");
    editor.commands.redo();
    expect(editor.state.doc.textContent).toContain("typed");
  });
});
