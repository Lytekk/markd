import { describe, it, expect } from "vitest";
import { extractSourceHeadings } from "./source-outline";

// Source-mode outline: headings parsed from the RAW markdown buffer (the PM
// doc is stale in source mode). Offsets are line starts in the given body —
// the click-to-jump target for the textarea.

describe("extractSourceHeadings", () => {
  it("extracts ATX headings with level, text and line-start offsets", () => {
    const body = "# One\n\ntext\n\n## Two\n### Three\n";
    expect(extractSourceHeadings(body)).toEqual([
      { id: "src-0", level: 1, text: "One", pos: 0 },
      { id: "src-13", level: 2, text: "Two", pos: 13 },
      { id: "src-20", level: 3, text: "Three", pos: 20 },
    ]);
  });

  it("skips headings inside fenced code blocks, both ``` and ~~~", () => {
    const body = "```md\n# not a heading\n```\n# Real\n~~~\n## also not\n~~~\n";
    const got = extractSourceHeadings(body);
    expect(got.map((h) => h.text)).toEqual(["Real"]);
  });

  it("only a matching closing fence (same char, >= length) ends the block", () => {
    const body = "````\n```\n# still inside\n````\n# Out\n";
    expect(extractSourceHeadings(body).map((h) => h.text)).toEqual(["Out"]);
  });

  it("strips closing hash sequences and skips empty headings (PM parity)", () => {
    const body = "## Trimmed ##\n#\n#   \n";
    expect(extractSourceHeadings(body)).toEqual([
      { id: "src-0", level: 2, text: "Trimmed", pos: 0 },
    ]);
  });

  it("does not match 7+ hashes or 4-space-indented code", () => {
    const body = "####### seven\n    # indented code\n";
    expect(extractSourceHeadings(body)).toEqual([]);
  });

  it("allows up to 3 leading spaces (CommonMark)", () => {
    const body = "   ## Indented\n";
    expect(extractSourceHeadings(body)).toEqual([
      { id: "src-0", level: 2, text: "Indented", pos: 0 },
    ]);
  });
});

describe("setext headings (rendered-outline parity)", () => {
  it("recognizes = underlines as h1 and - underlines as h2, positioned at the text line", () => {
    const body = "Title\n=====\n\nSub\n---\n";
    expect(extractSourceHeadings(body)).toEqual([
      { id: "src-0", level: 1, text: "Title", pos: 0 },
      { id: "src-13", level: 2, text: "Sub", pos: 13 },
    ]);
  });

  it("an underline with no preceding paragraph line is NOT a heading (hr / stray)", () => {
    expect(extractSourceHeadings("---\n")).toEqual([]);
    expect(extractSourceHeadings("para\n\n---\n")).toEqual([]);
  });

  it("an ATX heading line does not become setext text for a following underline", () => {
    const got = extractSourceHeadings("# Real\n---\n");
    expect(got).toEqual([{ id: "src-0", level: 1, text: "Real", pos: 0 }]);
  });

  it("underlines inside fences stay code", () => {
    expect(extractSourceHeadings("```\nTitle\n===\n```\n")).toEqual([]);
  });
});
