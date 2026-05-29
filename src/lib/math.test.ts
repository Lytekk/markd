import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { renderMathToHtml } from "./math";

describe("renderMathToHtml (KaTeX wrapper — synchronous, never throws)", () => {
  it("renders inline math to a KaTeX HTML string", () => {
    const html = renderMathToHtml("E = mc^2", false);
    expect(html).toContain("katex");
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders block/display math", () => {
    const html = renderMathToHtml("\\int_0^1 x\\,dx", true);
    expect(html).toContain("katex");
  });

  it("does not throw on invalid LaTeX (returns error markup instead)", () => {
    expect(() => renderMathToHtml("\\frac{", false)).not.toThrow();
    expect(renderMathToHtml("\\frac{", false).length).toBeGreaterThan(0);
  });
});

// The gating safety tests: LaTeX source must survive a full markdown round-trip
// untouched. The corruption modes the prior-art critique reproduced (HTML-escaped
// `<`, currency `$` mis-parsed, KaTeX HTML baked into the doc) are each asserted
// against here. The bridge: markdown-it render rules emit <span/div data-latex>
// (raw source in the attr), and parseHTML reads it back — KaTeX never touches the
// persisted document.
describe("math markdown round-trip (source survives load+save)", () => {
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

  const roundTrip = (md: string) => {
    editor.commands.setContent(md, false);
    return editor.storage.markdown.getMarkdown() as string;
  };

  it("parses inline $...$ into an inlineMath node holding the raw latex", () => {
    editor.commands.setContent("Euler: $e^{i\\pi} + 1 = 0$ done", false);
    let found: { latex: string } | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "inlineMath") found = node.attrs as { latex: string };
    });
    expect(found).not.toBeNull();
    expect(found!.latex).toBe("e^{i\\pi} + 1 = 0");
    expect(roundTrip("Euler: $e^{i\\pi} + 1 = 0$ done")).toContain("$e^{i\\pi} + 1 = 0$");
  });

  it("parses block $$...$$ into a blockMath node and serializes it back", () => {
    const out = roundTrip("$$\n\\int_0^1 x\\,dx\n$$");
    expect(editor.state.doc.firstChild!.type.name).toBe("blockMath");
    expect(editor.state.doc.firstChild!.attrs.latex).toBe("\\int_0^1 x\\,dx");
    expect(out).toContain("$$");
    expect(out).toContain("\\int_0^1 x\\,dx");
  });

  it("does NOT HTML-escape a raw < inside inline math", () => {
    const out = roundTrip("$a < b$");
    expect(out).toContain("$a < b$");
    expect(out).not.toContain("&lt;");
  });

  it("leaves currency ($5 and $6) as literal text, not math", () => {
    editor.commands.setContent("Costs $5 and $6 total", false);
    let hasMath = false;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "inlineMath" || n.type.name === "blockMath") hasMath = true;
    });
    expect(hasMath).toBe(false);
    expect(roundTrip("Costs $5 and $6 total")).toContain("$5 and $6");
  });

  it("is idempotent across a second load+save pass (no drift)", () => {
    const once = roundTrip("Mass-energy $E=mc^2$ and a block:\n\n$$\na^2 + b^2 = c^2\n$$");
    const twice = roundTrip(once);
    expect(twice).toBe(once);
  });
});
