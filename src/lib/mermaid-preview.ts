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
  /** mermaid `themeVariables` (used with theme "base") to match the app palette. */
  themeVariables?: Record<string, string>;
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
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: opts.theme ?? "default",
      ...(opts.themeVariables ? { themeVariables: opts.themeVariables } : {}),
    });
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

interface MermaidThemeConfig {
  /** "day" | "night" — also the cache-key prefix so each theme caches its own SVG. */
  id: string;
  theme: string;
  themeVariables: Record<string, string>;
}

/**
 * Build mermaid `themeVariables` from the app's own CSS custom properties so the
 * diagram matches the active theme AND is always legible: lines + text use
 * `--text-color` (dark on day, light on night) and node fills contrast on the
 * surface. Falls back to sensible values when the DOM/vars are unavailable.
 */
function readMermaidThemeConfig(): MermaidThemeConfig {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const isNight = root?.getAttribute("data-theme") === "night";
  const cs = root && typeof getComputedStyle !== "undefined" ? getComputedStyle(root) : null;
  const v = (name: string, fallback: string) => cs?.getPropertyValue(name).trim() || fallback;
  const text = v("--text-color", isNight ? "#e6e6e6" : "#1a1a2e");
  const surface = v("--code-block-bg-color", isNight ? "#1e1e2e" : "#f3f4f6");
  const accent = v("--primary-color", "#4361ee");
  const nodeFill = isNight ? v("--code-bg-color", "#2a2a3c") : "#ffffff";
  const altFill = isNight ? "#33334a" : "#eef0f2";
  return {
    id: isNight ? "night" : "day",
    theme: "base",
    themeVariables: {
      darkMode: String(isNight),
      background: surface,
      primaryColor: nodeFill,
      primaryTextColor: text,
      primaryBorderColor: accent,
      lineColor: text,
      textColor: text,
      secondaryColor: altFill,
      tertiaryColor: surface,
      fontFamily: v("--font-family", "sans-serif"),
    },
  };
}

/** Cache key — theme-prefixed so day and night cache distinct SVGs (and a theme
    flip re-renders rather than showing the other theme's colors). */
function cacheKey(themeId: string, source: string): string {
  return `${themeId}::${source}`;
}

function requestRender(source: string, view: EditorView, config: MermaidThemeConfig): void {
  const key = cacheKey(config.id, source);
  if (cache.has(key) || pending.has(key)) return;
  pending.add(key);
  void renderMermaid(source, `markd-mermaid-${renderCounter++}`, {
    theme: config.theme,
    themeVariables: config.themeVariables,
  }).then((res) => {
    pending.delete(key);
    rememberRender(cache, key, res);
    // Empty transaction → props.decorations recomputes; the widget key encodes
    // theme + status so it changes pending→done and PM rebuilds the widget
    // (a stable key reuses the stale "Rendering…" DOM). cache.has(key) → ends.
    if (!view.isDestroyed) view.dispatch(view.state.tr);
  });
}

/** Kick a render for every mermaid block in the doc. Driven by the plugin's
    view lifecycle (initial + every update) so a render reliably starts — we
    can't rely on props.decorations, which may run before the plugin view has
    captured the EditorView (the "stuck on Rendering…" bug). */
function kickMermaidRenders(view: EditorView, config: MermaidThemeConfig): void {
  for (const b of findMermaidBlocks(view.state.doc)) {
    requestRender(b.source, view, config);
  }
}

/** Cache-status tag baked into the widget key so PM rebuilds the widget when a
    render resolves (pending -> done/error). A stable key makes ProseMirror reuse
    the stale placeholder DOM and never re-render (prosemirror-view compares
    spec.key) — which is why a diagram previously only appeared after a source
    toggle forced a full re-parse. */
function statusTag(c: Map<string, MermaidRender>, themeId: string, source: string): string {
  const r = c.get(cacheKey(themeId, source));
  return r ? r.status : "pending";
}

/** One preview widget per mermaid block, attached just after the code block.
    `c` defaults to the shared render cache; tests inject their own. */
export function buildMermaidDecorations(
  doc: PmNode,
  themeId = "day",
  c: Map<string, MermaidRender> = cache,
): DecorationSet {
  const decorations = findMermaidBlocks(doc).map((b) =>
    Decoration.widget(b.pos + b.nodeSize, () => createMermaidPreview(c.get(cacheKey(themeId, b.source))), {
      side: 1,
      key: `mermaid-${b.pos}-${themeId}-${statusTag(c, themeId, b.source)}`,
      ignoreSelection: true,
    }),
  );
  return DecorationSet.create(doc, decorations);
}

export const MermaidPreview = Extension.create({
  name: "mermaidPreview",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mermaidKey,
        view(editorView) {
          // Kick renders for the initial document. props.decorations may already
          // have run before any view was captured, so the plugin-view lifecycle
          // is the reliable place to start the async render.
          kickMermaidRenders(editorView, readMermaidThemeConfig());
          // Re-render when the app theme flips (data-theme on <html>): an empty
          // transaction recomputes decorations under the new theme id (cache
          // miss -> kick render in the new palette -> recolored SVG).
          let themeObserver: MutationObserver | null = null;
          if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
            themeObserver = new MutationObserver(() => {
              if (!editorView.isDestroyed) editorView.dispatch(editorView.state.tr);
            });
            themeObserver.observe(document.documentElement, {
              attributes: true,
              attributeFilter: ["data-theme"],
            });
          }
          return {
            update(view) {
              // Content loaded after init (setContent), edits, the theme-flip tx,
              // and the post-resolve redraw all reach here; requestRender
              // self-guards on cache/pending.
              kickMermaidRenders(view, readMermaidThemeConfig());
            },
            destroy() {
              themeObserver?.disconnect();
            },
          };
        },
        props: {
          decorations: (state) => buildMermaidDecorations(state.doc, readMermaidThemeConfig().id),
        },
      }),
    ];
  },
});
