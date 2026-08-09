import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { createMathNodeView, InlineMath, BlockMath, renderMathToHtml } from "./math";
import { promptModal } from "./modal";

vi.mock("./modal", () => ({ promptModal: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

describe("deferred math node editing", () => {
  let editor: TiptapEditor;

  beforeEach(() => {
    vi.mocked(promptModal).mockReset();
    editor = new TiptapEditor({
      extensions: [StarterKit, InlineMath, BlockMath],
      content: '<p>before <span data-latex="x"></span> after</p>',
    });
  });

  afterEach(() => {
    if (!editor.isDestroyed) editor.destroy();
  });

  function inlineMathNode() {
    const found: Array<{
      node: Parameters<ReturnType<typeof createMathNodeView>>[0]["node"];
      pos: number;
    }> = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "inlineMath") found.push({ node, pos });
    });
    const first = found[0];
    if (!first) throw new Error("inline math fixture missing");
    return first;
  }

  function openDeferredEdit(getPos?: () => number) {
    const pending = deferred<string | null>();
    vi.mocked(promptModal).mockReturnValueOnce(pending.promise);
    const original = inlineMathNode();
    const view = createMathNodeView(false)({
      node: original.node,
      editor,
      getPos: getPos ?? (() => original.pos),
    } as Parameters<ReturnType<typeof createMathNodeView>>[0]);
    view.dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    return { pending, view };
  }

  it("does not edit a same-type node loaded in a replacement document", async () => {
    const pending = deferred<string | null>();
    vi.mocked(promptModal).mockReturnValueOnce(pending.promise);
    const dom = editor.view.dom.querySelector<HTMLElement>(".markd-math-inline");
    if (!dom) throw new Error("rendered inline math fixture missing");
    dom.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const request = vi.mocked(promptModal).mock.calls[0]![0];
    expect(request.isCurrent?.()).toBe(true);
    editor.commands.setContent(
      '<p>replacement <span data-latex="replacement"></span> document</p>',
      false,
    );
    expect(request.isCurrent?.()).toBe(false);

    pending.resolve("stale edit");
    await pending.promise;
    await Promise.resolve();

    const replacement = inlineMathNode().node;
    expect(replacement.attrs.latex).toBe("replacement");
  });

  it("rejects a distinct same-shaped document even if NodeView destroy is missed", async () => {
    const originalDoc = editor.state.doc;
    const { pending } = openDeferredEdit();
    editor.commands.setContent(
      '<p>before <span data-latex="x"></span> after</p>',
      false,
    );
    expect(editor.state.doc).not.toBe(originalDoc);

    pending.resolve("stale edit");
    await pending.promise;
    await Promise.resolve();

    expect(inlineMathNode().node.attrs.latex).toBe("x");
  });

  it("does not mutate a different node type now occupying the old position", async () => {
    const { pending } = openDeferredEdit();
    editor.commands.setContent("<p>new buffer</p>", false);

    pending.resolve("y");
    await pending.promise;
    await Promise.resolve();

    expect(editor.state.doc.textContent).toBe("new buffer");
    const mathNodes: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "inlineMath" || node.type.name === "blockMath") {
        mathNodes.push(node.type.name);
      }
    });
    expect(mathNodes).toEqual([]);
  });

  it("does not consult a stale getPos after the node view is destroyed", async () => {
    const getPos = vi.fn(() => {
      throw new Error("stale node view position");
    });
    const { pending, view } = openDeferredEdit(getPos);
    view.destroy?.();

    pending.resolve("y");
    await pending.promise;
    await Promise.resolve();

    expect(getPos).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).toBe("before  after");
  });

  it("does not consult a stale getPos after the editor is destroyed", async () => {
    const getPos = vi.fn(() => {
      throw new Error("destroyed editor position");
    });
    const { pending } = openDeferredEdit(getPos);
    editor.destroy();

    pending.resolve("y");
    await pending.promise;
    await Promise.resolve();

    expect(getPos).not.toHaveBeenCalled();
  });

  it("absorbs a getPos failure without mutating the document", async () => {
    const before = editor.state.doc.toJSON();
    const { pending } = openDeferredEdit(() => {
      throw new Error("position no longer exists");
    });

    pending.resolve("y");
    await pending.promise;
    await Promise.resolve();

    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});
