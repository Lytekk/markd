import type { TextRange } from "@/lib/text-search";

/**
 * Vertical pixel offset of a character offset inside a textarea, measured via
 * a hidden mirror div with the textarea's text metrics (the standard textarea-
 * measurement technique — a textarea exposes no per-character geometry). Used
 * to scroll a match / heading into view; layout-dependent, so verified live
 * rather than unit-tested (jsdom has no layout).
 */
function createTextareaMirror(ta: HTMLTextAreaElement): HTMLDivElement {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  for (const prop of [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "padding-top",
    "padding-left",
    "padding-right",
    "padding-bottom",
    "border-top-width",
    "white-space",
    "overflow-wrap",
    "word-break",
    "tab-size",
    "box-sizing",
  ]) {
    mirror.style.setProperty(prop, cs.getPropertyValue(prop));
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.height = "auto";
  mirror.style.width = `${ta.clientWidth}px`;
  return mirror;
}

export function textOffsetTop(ta: HTMLTextAreaElement, offset: number): number {
  const mirror = createTextareaMirror(ta);
  mirror.textContent = ta.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

/** Start offset of every logical line (split on \n), incl. a trailing empty one. */
export function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** Convert N+1 vertical line boundaries into the height of each logical line. */
export function lineHeightsFromBoundaries(boundaries: number[]): number[] {
  const heights: number[] = [];
  for (let i = 0; i + 1 < boundaries.length; i++) {
    heights.push(Math.max(0, boundaries[i + 1]! - boundaries[i]!));
  }
  return heights;
}

/**
 * Height of every logical line, including the final wrapped or trailing-empty
 * line. N line-start sentinels plus one forced next-line sentinel produce N+1
 * boundaries in one mirror/layout pass. Without the final boundary, the last
 * line fell back to one CSS row and made the gutter too short to scroll.
 */
export function measureLineHeights(ta: HTMLTextAreaElement, starts: number[]): number[] {
  const mirror = createTextareaMirror(ta);
  const text = ta.value;
  const boundaries: HTMLSpanElement[] = [];
  for (let i = 0; i < starts.length; i++) {
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    boundaries.push(marker);
    mirror.appendChild(marker);
    const end = i + 1 < starts.length ? starts[i + 1]! : text.length;
    mirror.appendChild(document.createTextNode(text.slice(starts[i]!, end)));
  }
  // Force a boundary one visual row after the final logical line. This also
  // gives an empty document and a document ending in \n their real final row.
  mirror.appendChild(document.createTextNode("\n"));
  const endMarker = document.createElement("span");
  endMarker.textContent = "\u200b";
  boundaries.push(endMarker);
  mirror.appendChild(endMarker);
  document.body.appendChild(mirror);
  const tops = boundaries.map((marker) => marker.offsetTop);
  mirror.remove();
  return lineHeightsFromBoundaries(tops);
}

/** Select `range` in the textarea and scroll it to the vertical center. */
export function revealRange(ta: HTMLTextAreaElement, range: TextRange): void {
  ta.setSelectionRange(range.start, range.end);
  const top = textOffsetTop(ta, range.start);
  ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
}
