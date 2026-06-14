import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { loadEditorContent, isHistoryPlugin } from "./editor-load";
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
  // Perf guard: loadEditorContent clears undo by resetting ONLY the history
  // plugin (cheap) rather than recreating the whole EditorState (re-inits all
  // plugins → a full second re-render). That hinges on locating exactly one
  // history plugin; if a TipTap upgrade ever changes its state shape, detection
  // would silently fall back to the slow recreate. Catch that here.
  it("locates exactly one prosemirror-history plugin (the fast reset path)", () => {
    const matches = editor.state.plugins.filter((p) => isHistoryPlugin(p, editor.state));
    expect(matches).toHaveLength(1);
  });

  // Tab switches restore via cached ProseMirror JSON (skips the slow markdown
  // re-parse). loadEditorContent must accept JSON and still clear history.
  it("loads a document from ProseMirror JSON and still clears undo history", () => {
    loadEditorContent(editor, DOC_A); // markdown
    const json = editor.getJSON(); // the per-tab cache captured on leave
    loadEditorContent(editor, DOC_B); // switch away
    loadEditorContent(editor, json); // switch back via JSON (fast path)
    expect(editor.state.doc.textContent).toContain("alpha content");
    editor.commands.undo();
    expect(editor.state.doc.textContent).toContain("alpha content"); // history cleared
    expect(editor.state.doc.textContent).not.toContain("beta content");
  });

  it("JSON restore yields a doc EQUAL to the markdown parse (lossless fast path)", () => {
    loadEditorContent(editor, DOC_A);
    const fromMarkdown = editor.state.doc;
    const json = editor.getJSON();
    loadEditorContent(editor, DOC_B);
    loadEditorContent(editor, json);
    expect(editor.state.doc.eq(fromMarkdown)).toBe(true);
  });

  // The data-loss TRAP behind the docJSON cache (adversarial-review catch): an
  // empty / whitespace-only doc serializes to EMPTY markdown but a TRUTHY JSON
  // doc. A tab so cached has content:"" + docJSON:<empty-paragraph>; the empty
  // content trips the "re-read from disk" branch, and if docJSON isn't cleared
  // there, `docJSON ?? body` picks the stale empty doc and the editor loads BLANK
  // over the real content. Hence: disk re-reads MUST clear docJSON (App.tsx).
  it("an empty-serializing doc keeps a truthy JSON cache — disk re-reads must drop it", () => {
    loadEditorContent(editor, "   \n");
    expect(editor.storage.markdown.getMarkdown()).toBe(""); // falsy → trips the re-hydrate branch
    const staleJSON = editor.getJSON();
    expect(staleJSON).toBeTruthy();
    expect(staleJSON.type).toBe("doc"); // truthy → would win `docJSON ?? body`

    // The fix's effect: a disk re-read clears docJSON (→ undefined), so the real
    // body is parsed and shown — NOT the stale blank.
    loadEditorContent(editor, "# Real Disk Content\n\nthe real body");
    expect(editor.state.doc.textContent).toContain("Real Disk Content");
    // Proof the stale cache WOULD have blanked it:
    loadEditorContent(editor, staleJSON);
    expect(editor.state.doc.textContent.trim()).toBe("");
  });

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
