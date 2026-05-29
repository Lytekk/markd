import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import { createTestDoc } from "@/test/editor-helpers";
import {
  findMermaidBlocks,
  createMermaidPreview,
  buildMermaidDecorations,
  renderMermaid,
  rememberRender,
  type MermaidRender,
} from "./mermaid-preview";

describe("findMermaidBlocks", () => {
  it("returns each mermaid code block with its source text and position", () => {
    const doc = createTestDoc([
      { type: "paragraph", text: "intro" },
      { type: "code", text: "graph TD\n  A-->B", language: "mermaid" },
      { type: "code", text: "const x = 1", language: "ts" },
    ]);
    const blocks = findMermaidBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.source).toBe("graph TD\n  A-->B");
    // position must point at the mermaid node so a widget can attach after it
    expect(doc.nodeAt(blocks[0]!.pos)!.type.name).toBe("codeBlock");
    expect(blocks[0]!.nodeSize).toBe(doc.nodeAt(blocks[0]!.pos)!.nodeSize);
  });

  it("matches the language case-insensitively and ignores plain code blocks", () => {
    const doc = createTestDoc([
      { type: "code", text: "a-->b", language: "Mermaid" },
      { type: "code", text: "plain", language: null as unknown as string },
    ]);
    const blocks = findMermaidBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.source).toBe("a-->b");
  });

  it("returns nothing for a doc without mermaid blocks", () => {
    const doc = createTestDoc([{ type: "paragraph", text: "hi" }]);
    expect(findMermaidBlocks(doc)).toEqual([]);
  });
});

describe("createMermaidPreview (DOM builder — pure, renders from cache)", () => {
  it("injects the rendered SVG when the render is cached", () => {
    const cached: MermaidRender = { status: "done", svg: "<svg id='m'><g></g></svg>" };
    const el = createMermaidPreview(cached);
    expect(el.classList.contains("markd-mermaid-preview")).toBe(true);
    expect(el.getAttribute("contenteditable")).toBe("false");
    expect(el.querySelector("svg")).toBeTruthy();
  });

  it("shows the error message as text (never as HTML) on a failed render", () => {
    const cached: MermaidRender = { status: "error", message: "<b>Syntax error</b> on line 2" };
    const el = createMermaidPreview(cached);
    expect(el.querySelector("svg")).toBeNull();
    expect(el.querySelector("b")).toBeNull(); // message is NOT parsed as HTML
    expect(el.textContent).toContain("Syntax error");
  });

  it("renders a loading placeholder when uncached", () => {
    const el = createMermaidPreview(undefined);
    expect(el.querySelector("svg")).toBeNull();
    expect(el.textContent?.toLowerCase()).toContain("render");
  });
});

describe("buildMermaidDecorations (widget key encodes cache status)", () => {
  // Regression: a stable widget key makes ProseMirror reuse the placeholder DOM
  // and skip the builder once the async SVG lands (prosemirror-view dist
  // index.js:3888 compares spec.key). The key MUST change when the cache
  // transitions pending -> done, or the diagram stays stuck on "Rendering…".
  const widgetKey = (set: ReturnType<typeof buildMermaidDecorations>): string => {
    const decos = set.find();
    const d = decos[0] as unknown as { spec?: { key?: string }; type?: { spec?: { key?: string } } };
    return (d.spec?.key ?? d.type?.spec?.key ?? "") as string;
  };

  it("changes the widget key when a diagram goes from pending to done", () => {
    const doc = createTestDoc([{ type: "code", text: "graph TD\n A-->B", language: "mermaid" }]);
    const c = new Map<string, MermaidRender>();
    const pendingKey = widgetKey(buildMermaidDecorations(doc, "day", c));
    c.set("day::graph TD\n A-->B", { status: "done", svg: "<svg/>" }); // theme-prefixed key
    const doneKey = widgetKey(buildMermaidDecorations(doc, "day", c));
    expect(pendingKey).not.toBe(doneKey);
    expect(doneKey).toContain("done");
    expect(pendingKey).toContain("pending");
  });

  it("caches per theme — a different theme id is a cache miss (pending)", () => {
    const doc = createTestDoc([{ type: "code", text: "graph TD\n A-->B", language: "mermaid" }]);
    const c = new Map<string, MermaidRender>();
    c.set("day::graph TD\n A-->B", { status: "done", svg: "<svg/>" });
    expect(widgetKey(buildMermaidDecorations(doc, "day", c))).toContain("done");
    // night hasn't been rendered → its key is still pending (so a theme flip
    // re-renders in the new palette rather than reusing day's colors)
    expect(widgetKey(buildMermaidDecorations(doc, "night", c))).toContain("pending");
  });
});

describe("renderMermaid (lazy import, never throws)", () => {
  function fakeMermaid(overrides: Record<string, unknown> = {}) {
    return {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: "<svg/>" }),
      ...overrides,
    };
  }

  it("initializes mermaid (startOnLoad:false, securityLevel:strict) and returns the svg", async () => {
    const m = fakeMermaid();
    const res = await renderMermaid("graph TD;A-->B;", "mmd-1", { load: () => Promise.resolve(m) });
    expect(res).toEqual({ status: "done", svg: "<svg/>" });
    expect(m.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict" }),
    );
    expect(m.render).toHaveBeenCalledWith("mmd-1", "graph TD;A-->B;");
  });

  it("unwraps an ESM default export from the dynamic import", async () => {
    const m = fakeMermaid();
    const res = await renderMermaid("x", "id", { load: () => Promise.resolve({ default: m }) });
    expect(res.status).toBe("done");
    expect(m.render).toHaveBeenCalled();
  });

  it("returns an error result (never throws) when the dynamic import fails", async () => {
    const res = await renderMermaid("x", "id", {
      load: () => Promise.reject(new Error("Failed to fetch dynamically imported module")),
    });
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.message).toBeTruthy();
  });

  it("returns an error result (never throws) when mermaid.render rejects on bad syntax", async () => {
    const m = fakeMermaid({ render: vi.fn().mockRejectedValue(new Error("Parse error")) });
    const res = await renderMermaid("not a diagram", "id", { load: () => Promise.resolve(m) });
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.message).toContain("Parse error");
  });
});

describe("rememberRender (bounded cache — no unbounded growth while editing)", () => {
  it("evicts the oldest entry once the cap is exceeded", () => {
    const m = new Map<string, MermaidRender>();
    rememberRender(m, "a", { status: "done", svg: "A" }, 2);
    rememberRender(m, "b", { status: "done", svg: "B" }, 2);
    rememberRender(m, "c", { status: "done", svg: "C" }, 2); // pushes out "a"
    expect(m.has("a")).toBe(false);
    expect([...m.keys()]).toEqual(["b", "c"]);
    expect(m.size).toBe(2);
  });

  it("re-writing an existing key updates in place without growing the map", () => {
    const m = new Map<string, MermaidRender>();
    rememberRender(m, "a", { status: "done", svg: "A" }, 2);
    rememberRender(m, "a", { status: "done", svg: "A2" }, 2);
    expect(m.size).toBe(1);
    expect(m.get("a")).toEqual({ status: "done", svg: "A2" });
  });
});

// Safety guard for approach B: a ```mermaid fence MUST stay a plain codeBlock so
// the markdown round-trip is byte-stable (no custom node, no custom serialize).
// This is the entire data-safety argument for the decoration approach — locked
// here so a future refactor to a custom node can't silently regress it.
describe("mermaid round-trip safety (approach B)", () => {
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

  it("keeps a mermaid fence as a codeBlock(language=mermaid) and serializes it back unchanged", () => {
    const md = "```mermaid\ngraph TD\n  A-->B\n```";
    editor.commands.setContent(md, false);
    const top = editor.state.doc.firstChild!;
    expect(top.type.name).toBe("codeBlock");
    expect(top.attrs.language).toBe("mermaid");
    const out = editor.storage.markdown.getMarkdown() as string;
    expect(out).toContain("```mermaid");
    expect(out).toContain("A-->B");
  });
});
