import Table from "@tiptap/extension-table";
import { getHTMLFromFragment, type Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";

/**
 * Table extension whose markdown serialize rule forks tiptap-markdown's
 * (src/extensions/nodes/table.js) to fix two cell-level data losses
 * (review-caught, pre-existing):
 *
 * 1. Their cell guard `if (cellContent.textContent.trim())` skips cells whose
 *    only content is an ATOM (raw-HTML chip, math) — the cell was emptied on
 *    save. Guard on childCount instead.
 * 2. Nothing pipe-escapes cell content. A literal `|` inside a code span or
 *    raw HTML (which bypass esc(); escape:false) split the row on the next
 *    parse — structural, non-idempotent corruption. Per GFM, `\|` is the
 *    escape for a pipe ANYWHERE in a row, including inside other inline
 *    spans (the table parser unescapes before inline parsing), so a uniform
 *    post-pass over each rendered cell segment is correct for text, code and
 *    chips alike. Mutating state.out is the lib's own pattern (trimInline).
 *
 * Everything else (header/span fallback to a raw HTML block, the inTable
 * flag that hardBreak reads to emit <br>) mirrors upstream byte-for-byte.
 * Override lands via getMarkdownSpec's `{...default, ...extensionStorage}`
 * precedence; @tiptap/extension-table defines no storage of its own.
 */

interface TableState {
  out: string;
  inTable: boolean;
  write(s: string): void;
  renderInline(node: PMNode): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
}

function childNodes(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((c) => out.push(c));
  return out;
}

function hasSpan(node: PMNode): boolean {
  return Number(node.attrs.colspan) > 1 || Number(node.attrs.rowspan) > 1;
}

/** A table is GFM-expressible only as header row + simple single-block cells. */
function isMarkdownSerializable(node: PMNode): boolean {
  const rows = childNodes(node);
  const firstRow = rows[0];
  if (!firstRow) return false;
  const bodyRows = rows.slice(1);

  if (
    childNodes(firstRow).some(
      (cell) => cell.type.name !== "tableHeader" || hasSpan(cell) || cell.childCount > 1,
    )
  ) {
    return false;
  }
  if (
    bodyRows.some((row) =>
      childNodes(row).some(
        (cell) => cell.type.name === "tableHeader" || hasSpan(cell) || cell.childCount > 1,
      ),
    )
  ) {
    return false;
  }
  return true;
}

/** Mirrors tiptap-markdown's HTMLNode fallback incl. its commonmark block formatting. */
function serializeTableAsHTML(node: PMNode): string {
  const html = getHTMLFromFragment(Fragment.from(node), node.type.schema);
  const tmp = document.createElement("div");
  tmp.innerHTML = `<body>${html}</body>`;
  const el = tmp.querySelector("body")!.firstElementChild;
  if (!el) return html;
  el.innerHTML = el.innerHTML.trim() ? `\n${el.innerHTML}\n` : "\n";
  return el.outerHTML;
}

export const FaithfulTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(this: { editor: Editor }, state: TableState, node: PMNode) {
          if (!isMarkdownSerializable(node)) {
            if (this.editor.storage.markdown.options.html) {
              state.write(serializeTableAsHTML(node));
            } else {
              state.write("[table]");
            }
            state.closeBlock(node);
            return;
          }
          state.inTable = true;
          node.forEach((row, _rowOffset, i) => {
            state.write("| ");
            row.forEach((col, _colOffset, j) => {
              if (j) state.write(" | ");
              const cellContent = col.firstChild;
              if (cellContent && cellContent.childCount > 0) {
                const start = state.out.length;
                state.renderInline(cellContent);
                state.out =
                  state.out.slice(0, start) + state.out.slice(start).replace(/\|/g, "\\|");
              }
            });
            state.write(" |");
            state.ensureNewLine();
            if (!i) {
              const delimiterRow = Array.from({ length: row.childCount })
                .map(() => "---")
                .join(" | ");
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
