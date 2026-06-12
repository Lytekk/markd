import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Raw HTML preservation (round-trip fidelity).
 *
 * With `html: true`, markdown-it tokenizes raw HTML into html_inline /
 * html_block tokens, renders them as live HTML, and ProseMirror's DOM parser
 * then silently DROPS any element the schema doesn't know (`<placeholder>`,
 * `<span data-x>`, `<details>` …) — user data was deleted on the next save.
 *
 * Same bridge pattern as the KaTeX data-latex bridge in math.ts: override the
 * markdown-it render rules to emit a carrier element holding the RAW source
 * in an attribute, parse that into an atom node, and serialize the attribute
 * verbatim. Wrapping tags arrive as separate open/close tokens, so each
 * becomes its own atom — byte-faithful by construction.
 *
 * Display is the literal source as a muted chip (raw-html.css). Rendering the
 * HTML live was rejected: an unknown tag has no trustworthy rendering, and a
 * live-rendered known tag would re-enter the schema-drop trap on copy/paste.
 */

interface MdToken {
  content: string;
}
interface MdLike {
  utils: { escapeHtml: (s: string) => string };
  renderer: {
    rules: Record<string, (tokens: MdToken[], idx: number) => string>;
  };
}

/** Bridge markdown-it raw-HTML tokens to data-raw-html carrier elements. */
export function setupRawHtmlMarkdown(md: MdLike): void {
  const esc = md.utils.escapeHtml;
  md.renderer.rules.html_inline = (t, i) =>
    `<span data-raw-html="${esc(t[i]!.content)}"></span>`;
  // Block tokens carry trailing newline(s); the block separator is re-added
  // by the serializer's closeBlock, so store the bare source.
  md.renderer.rules.html_block = (t, i) =>
    `<div data-raw-html="${esc(t[i]!.content.replace(/\n+$/, ""))}"></div>`;
}

const sourceAttribute = {
  source: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute("data-raw-html") ?? "",
    renderHTML: (attrs: { source: string }) => ({ "data-raw-html": attrs.source }),
  },
};

export const RawInlineHTML = Node.create({
  name: "rawInlineHTML",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return sourceAttribute;
  },

  parseHTML() {
    return [{ tag: "span[data-raw-html]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "markd-raw-html", contenteditable: "false" }),
      String(node.attrs.source),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { source: string } }) {
          state.write(node.attrs.source);
        },
        parse: {
          setup(md: MdLike) {
            setupRawHtmlMarkdown(md);
          },
        },
      },
    };
  },
});

export const RawBlockHTML = Node.create({
  name: "rawBlockHTML",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return sourceAttribute;
  },

  parseHTML() {
    return [{ tag: "div[data-raw-html]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "markd-raw-html-block", contenteditable: "false" }),
      String(node.attrs.source),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { text: (s: string, esc: boolean) => void; closeBlock: (n: unknown) => void },
          node: { attrs: { source: string } },
        ) {
          // text() (not write()): it splits on newlines and re-applies the
          // active container delimiter (e.g. "> ") to every line — a single
          // write() lets continuation lines of a multi-line block escape a
          // blockquote, corrupting it non-idempotently.
          state.text(node.attrs.source, false);
          state.closeBlock(node);
        },
        // markdown-it setup registered once via RawInlineHTML.
        parse: {},
      },
    };
  },
});
