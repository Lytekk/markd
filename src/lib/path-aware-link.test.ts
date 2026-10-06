import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "./editor-extensions";

let editor: Editor;
beforeEach(() => {
  editor = new Editor({
    extensions: [
      ...getExtensions({ getFileDir: () => "" }),
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
    ],
  });
});
afterEach(() => editor.destroy());

function paste(text: string) {
  // Supply clipboard data on a DOM event because jsdom has no ClipboardEvent.
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: {
    getData: (type: string) => type === "text/plain" ? text : "",
    items: [],
    files: [],
  } });
  editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true }));
  editor.view.dom.dispatchEvent(event);
}

function links() {
  const found: string[] = [];
  editor.state.doc.descendants(node => {
    node.marks.forEach(mark => {
      if (mark.type.name === "link") found.push(mark.attrs.href);
    });
  });
  return found;
}

describe("path-aware link pasting", () => {
  it.each([
    "docs/reference/task-status-and-retrieval.md",
    "./docs/reference/task-status-and-retrieval.md",
    "/docs/reference/task-status-and-retrieval.md",
    "../reference/task-status-and-retrieval.md",
    String.raw`C:\docs\reference\task-status-and-retrieval.md`,
    "See docs/reference/task-status-and-retrieval.md for details.",
  ])("keeps file paths as text: %s", text => {
    paste(text);
    expect(editor.getText()).toBe(text);
    expect(links()).toEqual([]);
    expect(editor.storage.markdown.getMarkdown()).not.toContain("http://task-status");
  });

  it("does not link a pasted filename onto an existing path prefix", () => {
    editor.commands.insertContent("docs/reference/");
    paste("task-status-and-retrieval.md");
    expect(editor.getText()).toBe("docs/reference/task-status-and-retrieval.md");
    expect(links()).toEqual([]);
  });

  it("keeps real domains, email and explicit URLs linked next to paths", () => {
    paste("docs/reference/guide.md https://example.com/guide.md example.com user@example.com https://example.md");
    expect(links()).toEqual([
      "https://example.com/guide.md", "http://example.com", "mailto:user@example.com", "https://example.md",
    ]);
  });

  it("preserves explicit markdown links", () => {
    paste("[guide](https://example.com/guide.md)");
    expect(links()).toEqual(["https://example.com/guide.md"]);
  });

  it("does not link paths when typing or adding a space after paste", () => {
    paste("docs/reference/task-status-and-retrieval.md");
    editor.view.dispatch(editor.state.tr.insertText(" "));
    expect(links()).toEqual([]);
  });
});
