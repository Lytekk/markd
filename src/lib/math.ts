// LaTeX math: inline `$x$` and block `$$...$$`, rendered with KaTeX.
//
// Round-trip safety (the load-bearing concern): tiptap-markdown parses by
// rendering markdown -> HTML string -> ProseMirror DOMParser (verified in
// tiptap-markdown.es.js:830-938), NOT by mapping markdown-it tokens to nodes. So
// the bridge is: register @vscode/markdown-it-katex for tokenizing, then OVERRIDE
// its renderer rules to emit `<span/div data-latex="RAW">` instead of KaTeX HTML.
// The node's parseHTML reads `data-latex` back as the raw source; KaTeX runs only
// in the NodeView at display time (like ResolvedImage's display-time src
// resolution). This keeps the persisted document as plain `$...$` markdown — KaTeX
// output never enters the doc, so the source can't be lost on a load/save cycle.
//
// We ADOPT @vscode/markdown-it-katex (vs hand-rolling) because it already handles
// the corruption traps the critique reproduced: currency `$5 and $6` is left
// literal, escaped `\$` is literal, and a raw `<` inside math is attribute-escaped
// (not HTML-shredded). See CLAUDE.md math design note for the full rationale.

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import katex from "katex";
import markdownItKatex from "@vscode/markdown-it-katex";
import { promptModal } from "./modal";

// CJS module exposes the plugin as `default`; tolerate either interop shape.
const katexPlugin = (markdownItKatex as unknown as { default?: unknown }).default ?? markdownItKatex;

/** Minimal shape of the markdown-it instance tiptap-markdown hands to setup(). */
interface MdLike {
  use: (plugin: unknown, ...opts: unknown[]) => MdLike;
  utils: { escapeHtml: (s: string) => string };
  renderer: { rules: Record<string, (tokens: Array<{ content: string }>, idx: number) => string> };
}

/**
 * Render LaTeX to an HTML string via KaTeX. Synchronous and DOM-free.
 * `throwOnError: false` makes KaTeX emit its own inline error markup rather than
 * throwing, so a malformed formula degrades gracefully; the try/catch is a
 * belt-and-suspenders guard for any non-KaTeXError throw.
 */
export function renderMathToHtml(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      output: "htmlAndMathml",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `<span class="markd-math-error">${msg}</span>`;
  }
}

/**
 * Register the math tokenizer and override its render rules so markdown-it emits
 * the data-latex bridge (raw source in an HTML attribute) instead of KaTeX HTML.
 * Shared by both math nodes but only invoked from InlineMath's setup — the
 * markdown-it instance is single per editor, so registering once covers inline
 * AND block tokenizing.
 */
export function setupMathMarkdown(md: MdLike): void {
  md.use(katexPlugin);
  const esc = md.utils.escapeHtml;
  md.renderer.rules.math_inline = (t, i) => `<span data-latex="${esc(t[i]!.content)}"></span>`;
  // Block content carries a trailing newline from the fence; trim so the stored
  // attr is the bare source and the round-trip is clean.
  md.renderer.rules.math_block = (t, i) => `<div data-latex="${esc(t[i]!.content.trim())}"></div>`;
  md.renderer.rules.math_inline_bare_block = (t, i) => `<div data-latex="${esc(t[i]!.content.trim())}"></div>`;
}

/** NodeView factory: a non-editable element whose innerHTML is the KaTeX render
    of the node's raw `latex` attribute. Re-rendered whenever the attribute
    changes (atom nodes are replaced wholesale, so `update` re-renders). */
function mathNodeView(displayMode: boolean) {
  return (props: { node: { attrs: Record<string, unknown> }; editor: Editor; getPos: unknown }) => {
    const latex = typeof props.node.attrs.latex === "string" ? props.node.attrs.latex : "";
    const dom = document.createElement(displayMode ? "div" : "span");
    dom.className = displayMode ? "markd-math-block" : "markd-math-inline";
    dom.setAttribute("data-latex", latex);
    dom.contentEditable = "false";
    dom.title = "Double-click to edit";
    dom.innerHTML = renderMathToHtml(latex, displayMode);
    // Double-click to edit the raw LaTeX (single click still selects the atom).
    dom.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const current = typeof props.node.attrs.latex === "string" ? props.node.attrs.latex : "";
      void promptModal({
        title: displayMode ? "Edit math block" : "Edit inline math",
        label: "LaTeX",
        defaultValue: current,
        okLabel: "Save",
      }).then((next) => {
        if (next == null) return; // cancelled
        const pos = typeof props.getPos === "function" ? (props.getPos as () => number)() : null;
        if (pos == null) return;
        props.editor.chain().command(({ tr }) => {
          tr.setNodeAttribute(pos, "latex", next);
          return true;
        }).run();
      });
    });
    return { dom };
  };
}

export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-latex") ?? "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-latex]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "markd-math-inline" })];
  },

  addNodeView() {
    return mathNodeView(false);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { latex: string } }) {
          state.write("$" + node.attrs.latex + "$");
        },
        parse: {
          setup(md: MdLike) {
            setupMathMarkdown(md);
          },
        },
      },
    };
  },
});

export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        // Strip a trailing newline the fence parser leaves on the content.
        parseHTML: (el) => (el.getAttribute("data-latex") ?? "").replace(/\n+$/, ""),
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-latex]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "markd-math-block" })];
  },

  addNodeView() {
    return mathNodeView(true);
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; closeBlock: (n: unknown) => void },
          node: { attrs: { latex: string } },
        ) {
          state.write("$$\n" + node.attrs.latex + "\n$$");
          state.closeBlock(node);
        },
        // Tokenizer + render-rule overrides are registered by InlineMath's setup
        // (single markdown-it instance per editor); nothing to add here.
        parse: {},
      },
    };
  },
});
