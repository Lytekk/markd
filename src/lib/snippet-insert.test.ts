import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { insertSnippetIntoEditor } from "./snippet-insert";
import { DEFAULT_SNIPPETS } from "./snippets";

let editor: TiptapEditor;

// Mirror App.tsx's useEditor extension set — Markdown (tiptap-markdown) is
// configured there, not in getExtensions, and snippet insertion depends on
// editor.storage.markdown.parser + the html:true pass-through.
beforeEach(() => {
  editor = new TiptapEditor({
    extensions: [
      ...getExtensions({ getFileDir: () => "" }),
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-" }),
    ],
  });
});
afterEach(() => editor.destroy());

/** Place the caret just inside the first text node containing `needle`. */
function caretAtText(needle: string) {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos >= 0) return false;
    if (node.isText && node.text?.includes(needle)) {
      pos = p + node.text.indexOf(needle) + 1;
      return false;
    }
    return true;
  });
  editor.commands.setTextSelection(pos);
}

const tableBody = DEFAULT_SNIPPETS.find((s) => s.id === "table")!.body;

describe("insertSnippetIntoEditor", () => {
  it("inserts a block table snippet WITHOUT mangling it into a paragraph of pipes", () => {
    editor.commands.setContent("");
    insertSnippetIntoEditor(editor, tableBody);
    expect(editor.getHTML()).toContain("<table");
    // the inline-forcing insertContent patch would have produced literal pipes
    expect(editor.getHTML()).not.toContain("| Column |");
    expect(editor.state.doc.textContent).not.toContain("");
  });

  it("places the caret at $1 in a text block (sentinel consumed, block created)", () => {
    editor.commands.setContent("");
    insertSnippetIntoEditor(editor, "## $1");
    expect(editor.getHTML()).toContain("<h2"); // a real heading, not split markdown
    expect(editor.state.doc.textContent).not.toContain(""); // sentinel gone
    expect(editor.state.doc.textContent).not.toContain("$1");
    expect(editor.state.selection.empty).toBe(true); // caret, not a range
  });

  it("inserts the link default as a real link node (not split at the brackets)", () => {
    editor.commands.setContent("");
    const linkBody = DEFAULT_SNIPPETS.find((s) => s.id === "link")!.body;
    insertSnippetIntoEditor(editor, linkBody);
    expect(editor.getHTML()).toContain('href="https://"');
    expect(editor.state.doc.textContent).toContain("text"); // visible placeholder
    expect(editor.state.doc.textContent).not.toContain("$1");
  });

  it("resolves dynamic tokens at insert time", () => {
    editor.commands.setContent("");
    insertSnippetIntoEditor(editor, "{{date}}", new Date(2026, 4, 29, 9, 0));
    expect(editor.state.doc.textContent).toContain("2026-05-29");
    expect(editor.state.doc.textContent).not.toContain("{{date}}");
  });

  it("leaves the caret at the end when there is no $1", () => {
    editor.commands.setContent("<p>start </p>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    insertSnippetIntoEditor(editor, "appended");
    expect(editor.state.doc.textContent).toContain("appended");
    expect(editor.state.doc.textContent).not.toContain("");
  });

  it("inserts as LITERAL text inside a code block (no markdown parse)", () => {
    editor.commands.setContent("```\ncode\n```");
    caretAtText("code");
    expect(editor.isActive("codeBlock")).toBe(true);
    insertSnippetIntoEditor(editor, "[x](y)");
    expect(editor.state.doc.textContent).toContain("[x](y)");
    expect(editor.getHTML()).not.toContain("<a "); // no link element created
    expect(editor.state.doc.textContent).not.toContain("");
  });

  it("degrades to inline inside a table cell (no nested block, table intact)", () => {
    editor.commands.setContent("| a | b |\n| --- | --- |\n| c | d |");
    expect(editor.getHTML()).toContain("<table");
    caretAtText("a");
    insertSnippetIntoEditor(editor, "**bold**");
    expect(editor.getHTML()).toContain("<strong>bold</strong>");
    expect(editor.getHTML()).toContain("<table"); // structure preserved
    expect(editor.state.doc.textContent).not.toContain("");
  });

  it("does not produce executable content from a raw-HTML body", () => {
    editor.commands.setContent("");
    insertSnippetIntoEditor(editor, "<script>alert(1)</script>");
    // Raw HTML is now PRESERVED as inert data (raw-html.ts) instead of being
    // dropped: the script source may appear in a quoted attribute value and
    // as an entity-escaped text node — neither parses to a script ELEMENT.
    // The security property is "no executable node", not "no such substring".
    const dom = new DOMParser().parseFromString(editor.getHTML(), "text/html");
    expect(dom.querySelector("script")).toBeNull();
    // The source must survive as data for round-trip fidelity.
    expect(editor.storage.markdown.getMarkdown()).toContain("<script>alert(1)</script>");
  });
});
