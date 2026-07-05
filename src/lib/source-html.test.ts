// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/react";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { renderSourceHtml } from "./source-html";

// Source-mode HTML export: the textarea's markdown must render through the
// SAME PM schema/DOMSerializer pipeline as editor.getHTML() — never through
// markdown-it's raw HTML output, which would bypass the escaping layer the
// export-path guard in markdown-fidelity.test.ts pins.

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

describe("renderSourceHtml", () => {
  it("matches editor.getHTML() for the same markdown (sanitization parity)", () => {
    const md = "# Title\n\nSome **bold** and `code`.\n\n- a\n- b\n";
    const viaSource = renderSourceHtml(editor, md);
    editor.commands.setContent(md, false);
    expect(viaSource).toBe(editor.getHTML());
  });

  it("keeps hostile raw html inert (same guarantee as the getHTML export path)", () => {
    const html = renderSourceHtml(
      editor,
      "Hit <img src=x onerror=alert(1)> and\n\n<script>alert(2)</script>\n",
    );
    expect(html).not.toBeNull();
    const dom = new DOMParser().parseFromString(html!, "text/html");
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.querySelector("img")).toBeNull();
  });
});
