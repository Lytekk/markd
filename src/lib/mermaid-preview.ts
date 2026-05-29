// Mermaid live preview (approach B): a ```mermaid fence stays a PLAIN codeBlock
// — no custom node, no custom serialize — so the markdown round-trip is exactly
// a normal fenced code block (zero corruption risk; locked by a round-trip test
// in mermaid-preview.test.ts). The rendered diagram is shown as a view-only
// Decoration.widget placed AFTER the code block, mirroring code-block-enhance's
// widget pattern. Because mermaid.render is async, the widget reads a
// module-level render cache keyed by source; a cache miss kicks off a render and,
// when it resolves, an empty transaction is dispatched to force props.decorations
// to recompute (the same redraw idiom focus-mode uses). Decorations are computed
// fresh each update — like focus-mode — so a resolved render is picked up without
// any plugin state to keep in sync. mermaid itself is loaded lazily (await
// import) and the whole flow is wrapped in try/catch: a failed dynamic import in
// a production build degrades to an inline error, never an uncaught throw.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Node as PmNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export type MermaidRender =
  | { status: "done"; svg: string }
  | { status: "error"; message: string };

export interface MermaidBlock {
  /** Document position immediately before the code block node. */
  pos: number;
  nodeSize: number;
  source: string;
}

interface MermaidLike {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
}

interface RenderOpts {
  /** Injectable loader (defaults to the lazy dynamic import). Tests stub this. */
  load?: () => Promise<MermaidLike | { default: MermaidLike }>;
  theme?: string;
}

/** All `\`\`\`mermaid` code blocks in the document, with source + position. */
export function findMermaidBlocks(doc: PmNode): MermaidBlock[] {
  const out: MermaidBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return undefined;
    const lang = (node.attrs.language ?? "").toString().trim().toLowerCase();
    if (lang === "mermaid") out.push({ pos, nodeSize: node.nodeSize, source: node.textContent });
    return false; // code blocks contain only text — nothing to descend into
  });
  return out;
}

/**
 * Render a mermaid diagram to an SVG string. Never throws: a failed dynamic
 * import (the production deploy risk) or a syntax error both resolve to an
 * { status: "error" } result the widget renders inline.
 */
export async function renderMermaid(
  source: string,
  id: string,
  opts: RenderOpts = {},
): Promise<MermaidRender> {
  try {
    const load = opts.load ?? (() => import("mermaid"));
    const mod = await load();
    const m = ("default" in mod ? mod.default : mod) as MermaidLike;
    m.initialize({ startOnLoad: false, securityLevel: "strict", theme: opts.theme ?? "default" });
    const { svg } = await m.render(id, source);
    return { status: "done", svg };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Build the preview widget DOM for one mermaid block from the cached render.
 * Pure: a cache miss shows a loading placeholder (the render is kicked by the
 * plugin's view lifecycle, not here). `contenteditable=false` so the SVG is
 * never editable; the error message is set via textContent so a diagram's error
 * string can never inject markup.
 */
export function createMermaidPreview(cached: MermaidRender | undefined): HTMLElement {
  const el = document.createElement("div");
  el.className = "markd-mermaid-preview";
  el.setAttribute("contenteditable", "false");

  if (!cached) {
    el.classList.add("is-loading");
    const ph = document.createElement("div");
    ph.className = "markd-mermaid-loading";
    ph.textContent = "Rendering diagram…";
    el.appendChild(ph);
    return el;
  }
  if (cached.status === "error") {
    el.classList.add("is-error");
    const err = document.createElement("div");
    err.className = "markd-mermaid-error";
    err.textContent = `Diagram error: ${cached.message}`;
    el.appendChild(err);
    return el;
  }
  // mermaid (securityLevel: strict) sanitizes the SVG it returns.
  el.innerHTML = cached.svg;
  return el;
}

// --- plugin glue ------------------------------------------------------------

const mermaidKey = new PluginKey("mermaidPreview");
// Source-keyed render cache, shared across editors. Keyed by source text so an
// unchanged diagram is never re-rendered (and a DOM rebuild on an unrelated edit
// reuses the cached SVG synchronously).
const cache = new Map<string, MermaidRender>();
const pending = new Set<string>();
let renderCounter = 0;

/** Hard cap on cached renders so editing one diagram (which produces a fresh
    cache entry per revision as the source string changes) can't grow memory
    without bound. 64 distinct diagrams in a single document is already a lot. */
export const MERMAID_CACHE_CAP = 64;

/**
 * Insert/refresh a render in an insertion-ordered cache, evicting the oldest
 * entries once `cap` is exceeded — a small LRU keyed by source text. (Map
 * iteration order is insertion order, so deleting `keys().next()` drops the
 * oldest.) Re-writing an existing key refreshes its recency without growing.
 */
export function rememberRender(
  map: Map<string, MermaidRender>,
  key: string,
  value: MermaidRender,
  cap = MERMAID_CACHE_CAP,
): void {
  map.delete(key); // re-insert so the freshest write counts as "newest"
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function requestRender(source: string, view: EditorView, theme: string): void {
  if (cache.has(source) || pending.has(source)) return;
  pending.add(source);
  void renderMermaid(source, `markd-mermaid-${renderCounter++}`, { theme }).then((res) => {
    pending.delete(source);
    rememberRender(cache, source, res);
    // Empty transaction → view update → props.decorations recomputes and picks
    // up the now-cached SVG. No docChanged, so dirty-tracking ignores it. The
    // recompute finds cache.has(source) → no re-request → terminates.
    if (!view.isDestroyed) view.dispatch(view.state.tr);
  });
}

/** Kick a render for every mermaid block in the doc. Driven by the plugin's
    view lifecycle (initial + every update) so a render reliably starts — we
    can't rely on props.decorations, which may run before the plugin view has
    captured the EditorView (the "stuck on Rendering…" bug). */
function kickMermaidRenders(view: EditorView, theme: string): void {
  for (const b of findMermaidBlocks(view.state.doc)) {
    requestRender(b.source, view, theme);
  }
}

/** Cache-status tag baked into the widget key so PM rebuilds the widget when a
    render resolves (pending -> done/error). A stable key makes ProseMirror reuse
    the stale placeholder DOM and never re-render (prosemirror-view compares
    spec.key) — which is why a diagram previously only appeared after a source
    toggle forced a full re-parse. */
function statusTag(c: Map<string, MermaidRender>, source: string): string {
  const r = c.get(source);
  return r ? r.status : "pending";
}

/** One preview widget per mermaid block, attached just after the code block.
    `c` defaults to the shared render cache; tests inject their own. */
export function buildMermaidDecorations(
  doc: PmNode,
  c: Map<string, MermaidRender> = cache,
): DecorationSet {
  const decorations = findMermaidBlocks(doc).map((b) =>
    Decoration.widget(b.pos + b.nodeSize, () => createMermaidPreview(c.get(b.source)), {
      side: 1,
      key: `mermaid-${b.pos}-${statusTag(c, b.source)}`,
      ignoreSelection: true,
    }),
  );
  return DecorationSet.create(doc, decorations);
}

export const MermaidPreview = Extension.create({
  name: "mermaidPreview",

  addProseMirrorPlugins() {
    const currentTheme = () =>
      typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "night"
        ? "dark"
        : "default";
    return [
      new Plugin({
        key: mermaidKey,
        view(editorView) {
          // Kick renders for the initial document. props.decorations may already
          // have run before any view was captured, so the plugin-view lifecycle
          // is the reliable place to start the async render.
          kickMermaidRenders(editorView, currentTheme());
          return {
            update(view) {
              // Content loaded after init (setContent), edits, and the empty-tx
              // redraw all reach here; requestRender self-guards on cache/pending.
              kickMermaidRenders(view, currentTheme());
            },
          };
        },
        props: {
          decorations: (state) => buildMermaidDecorations(state.doc),
        },
      }),
    ];
  },
});
