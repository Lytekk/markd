import type { Editor } from "@tiptap/core";
import { splitFrontmatter } from "./frontmatter";
import { lineStartOffsets, textOffsetTops } from "./textarea-metrics";

export interface BlockAnchor { index: number; fraction: number }
export interface ModeScrollAnchor extends BlockAnchor { edge?: "start" | "end" }

export function blockAnchor(boundaries: number[], top: number): BlockAnchor {
  let index = 0;
  while (index + 2 < boundaries.length && boundaries[index + 1]! <= top) index++;
  const start = boundaries[index] ?? 0;
  const end = boundaries[index + 1] ?? start;
  return { index, fraction: end > start ? Math.max(0, Math.min(1, (top - start) / (end - start))) : 0 };
}

export function anchorTop(boundaries: number[], anchor: BlockAnchor): number {
  const index = Math.min(anchor.index, Math.max(0, boundaries.length - 2));
  const start = boundaries[index] ?? 0;
  return start + ((boundaries[index + 1] ?? start) - start) * anchor.fraction;
}

/** The same configured markdown parser that builds the rendered document.
 * Top-level tokens correspond to rendered blocks; nested list/quote tokens
 * must not shift the following blocks. Frontmatter is source-only. */
export function sourceBlockOffsets(editor: Editor, markdown: string): number[] {
  const { body } = splitFrontmatter(markdown);
  const prefix = markdown.length - body.length;
  const lines = lineStartOffsets(body);
  const tokens: { level: number; nesting: number; map: [number, number] | null }[] =
    editor.storage.markdown.parser.md.parse(body, {});
  return tokens.filter(token => token.level === 0 && token.nesting !== -1 && token.map)
    .map(token => prefix + (lines[token.map![0]] ?? body.length));
}

function boundaries(editor: Editor, source: boolean, offsets: number[], scroller: HTMLElement): number[] {
  const starts: number[] = [];
  if (source) {
    starts.push(...textOffsetTops(scroller as HTMLTextAreaElement, offsets));
  } else {
    const origin = scroller.getBoundingClientRect().top;
    editor.state.doc.forEach((_node, pos) => {
      const dom = editor.view.nodeDOM(pos);
      starts.push(dom instanceof HTMLElement ? dom.getBoundingClientRect().top - origin + scroller.scrollTop : (starts[starts.length - 1] ?? 0));
    });
  }
  // Include top padding/frontmatter in the first interval. A document with no
  // markdown blocks still has a valid scroll boundary.
  if (starts.length) starts[0] = 0;
  else starts.push(0);
  return [...starts, scroller.scrollHeight];
}

export function modeScroller(source: boolean): HTMLElement | null {
  return document.querySelector(source ? ".markd-source-textarea" : ".markd-editor-scroll");
}

export function captureModeScroll(editor: Editor, source: boolean, offsets: number[]): ModeScrollAnchor {
  const scroller = modeScroller(source);
  if (!scroller || scroller.scrollTop <= 0) return { index: 0, fraction: 0, edge: "start" };
  const anchor = blockAnchor(boundaries(editor, source, offsets, scroller), scroller.scrollTop);
  return scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1
    ? { ...anchor, edge: "end" } : anchor;
}

export function restoreModeScroll(editor: Editor, source: boolean, offsets: number[], anchor: ModeScrollAnchor): void {
  const scroller = modeScroller(source);
  if (!scroller) return;
  scroller.scrollTop = anchor.edge === "start" ? 0 : anchor.edge === "end"
    ? scroller.scrollHeight : anchorTop(boundaries(editor, source, offsets, scroller), anchor);
  // Keep source gutter/search backdrop aligned with programmatic scrolling.
  scroller.dispatchEvent(new Event("scroll"));
}
