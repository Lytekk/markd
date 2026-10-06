import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "./editor-extensions";
import { blockAnchor, anchorTop, sourceBlockOffsets } from "./mode-scroll";

describe("mode scroll anchors", () => {
  it("maps the same block and within-block fraction despite different rendered heights", () => {
    const anchor = blockAnchor([0, 100, 300, 400], 200);
    expect(anchor).toEqual({ index: 1, fraction: 0.5 });
    expect(anchorTop([0, 500, 600, 900], anchor)).toBe(550);
    expect(anchorTop([0, 100, 300, 400], blockAnchor([0, 500, 600, 900], 550))).toBe(200);
  });

  it("handles empty documents and clamps positions", () => {
    expect(anchorTop([], blockAnchor([], 100))).toBe(0);
    expect(anchorTop([0, 100], blockAnchor([0, 100], -20))).toBe(0);
    expect(anchorTop([0, 100], blockAnchor([0, 100], 200))).toBe(100);
  });

  it("pairs top-level blocks with source offsets including frontmatter, lists and fences", () => {
    const editor = new Editor({ extensions: [...getExtensions({ getFileDir: () => "" }), Markdown] });
    try {
      const md = "---\ntitle: test\n---\n# Heading\n\nparagraph\n\n- one\n- two\n\n```ts\ncode\n```\n\n## End";
      expect(sourceBlockOffsets(editor, md)).toEqual([
        md.indexOf("# Heading"), md.indexOf("paragraph"), md.indexOf("- one"), md.indexOf("```ts"), md.indexOf("## End"),
      ]);
    } finally { editor.destroy(); }
  });
});
