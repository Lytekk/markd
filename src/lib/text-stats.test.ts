import { describe, it, expect, vi } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "./editor-extensions";
import { createTestDoc } from "@/test/editor-helpers";
import {
  computeDocumentTextStats,
  computeMarkdownTextStats,
  computeTextStats,
} from "./text-stats";
import { computeStandaloneMarkdownTextStats } from "./markdown-stats-parser";

function makeMarkdownEditor() {
  return new TiptapEditor({
    extensions: [
      ...getExtensions({ getFileDir: () => "" }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
  });
}

describe("computeTextStats", () => {
  it("returns zeros for empty text", () => {
    expect(computeTextStats("")).toEqual({ words: 0, chars: 0 });
  });

  it("counts whitespace-separated words and raw characters", () => {
    expect(computeTextStats("hello world")).toEqual({ words: 2, chars: 11 });
  });

  it("collapses runs of whitespace (newlines, tabs) into single separators", () => {
    expect(computeTextStats("a\n\nb\tc  d").words).toBe(4);
  });

  it("does not count leading/trailing whitespace as words", () => {
    expect(computeTextStats("  word  ").words).toBe(1);
  });

  it("counts whitespace-only text as zero words but keeps the char length", () => {
    expect(computeTextStats("   ")).toEqual({ words: 0, chars: 3 });
  });
});

describe("canonical visible-text stats", () => {
  it("counts a newline between rendered blocks instead of joining their text", () => {
    const doc = createTestDoc([
      { type: "paragraph", text: "hello" },
      { type: "paragraph", text: "world" },
    ]);

    expect(computeDocumentTextStats(doc)).toEqual({ words: 2, chars: 11 });
  });

  it("uses the same visible-text basis for source markdown and the rendered document", () => {
    const editor = makeMarkdownEditor();
    const markdown = "# Heading\n\nA **bold** [link](https://example.com).\n\n- first\n- second\n";

    try {
      editor.commands.setContent(markdown, false);
      expect(computeMarkdownTextStats(editor, markdown)).toEqual(
        computeDocumentTextStats(editor.state.doc),
      );
    } finally {
      editor.destroy();
    }
  });

  it("derives saved baselines from markdown while excluding frontmatter metadata", () => {
    const editor = makeMarkdownEditor();

    try {
      expect(
        computeMarkdownTextStats(
          editor,
          "---\ntitle: Hidden metadata\n---\n# Visible heading\n\nBody text\n",
        ),
      ).toEqual({ words: 4, chars: 25 });
    } finally {
      editor.destroy();
    }
  });

  it("uses the configured token parser without building HTML or a ProseMirror document", () => {
    const renderHtml = vi.fn(() => {
      throw new Error("the HTML path must not run for live Source stats");
    });
    const parseTokens = vi.fn(() => [
      {
        type: "inline",
        content: "hello **world**",
        children: [
          { type: "text", content: "hello " },
          { type: "strong_open", content: "" },
          { type: "text", content: "world" },
          { type: "strong_close", content: "" },
        ],
      },
    ]);
    const editor = {
      storage: {
        markdown: {
          parser: { parse: renderHtml, md: { parse: parseTokens } },
        },
      },
    } as unknown as TiptapEditor;

    expect(computeMarkdownTextStats(editor, "hello **world**")).toEqual({
      words: 2,
      chars: 11,
    });
    expect(parseTokens).toHaveBeenCalledTimes(1);
    expect(renderHtml).not.toHaveBeenCalled();
  });

  it.each([
    ["soft and hard breaks", "soft\nbreak\n\nhard  \nbreak"],
    ["lists and task items", "- first\n- second\n- [ ] task"],
    ["empty bullet-list items", "-\n- b"],
    ["empty ordered-list items", "1.\n2. b"],
    ["tables", "| a | b |\n|---|---|\n| c | d |"],
    ["code blocks", "```js\na\nb\n```"],
    ["images and text", "before\n\n![alt](image.png)\n\nafter"],
    ["raw HTML and math atoms", "<x-tag>raw</x-tag> tail\n\n$$\nx+y\n$$"],
    ["softbreaks around an inline atom", "line\n<br>\nnext"],
    ["softbreaks after a rendered mark element", "**bold**\nnext"],
    ["collapsed whitespace", "a\t  b &amp; c"],
  ])("matches the rendered document for %s", (_label, markdown) => {
    const editor = makeMarkdownEditor();
    try {
      editor.commands.setContent(markdown, false);
      const rendered = computeDocumentTextStats(editor.state.doc);
      expect(computeMarkdownTextStats(editor, markdown)).toEqual(rendered);
      expect(computeStandaloneMarkdownTextStats(markdown)).toEqual(rendered);
    } finally {
      editor.destroy();
    }
  });
});
