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

/**
 * Pixel top of each logical line's FIRST visual row, wrap-aware — one mirror,
 * one layout pass, a zero-width marker per line. Feeds the line-number
 * gutter's variable row heights so numbers stay aligned while soft-wrap is on
 * (a wrapped line spans several visual rows but gets ONE number).
 */
export function measureLineTops(ta: HTMLTextAreaElement, starts: number[]): number[] {
  const mirror = createTextareaMirror(ta);
  const text = ta.value;
  const markers: HTMLSpanElement[] = [];
  for (let i = 0; i < starts.length; i++) {
    const marker = document.createElement("span");
    markers.push(marker);
    mirror.appendChild(marker);
    const end = i + 1 < starts.length ? starts[i + 1]! : text.length;
    mirror.appendChild(document.createTextNode(text.slice(starts[i]!, end)));
  }
  document.body.appendChild(mirror);
  const tops = markers.map((m) => m.offsetTop);
  mirror.remove();
  return tops;
}

/** Select `range` in the textarea and scroll it to the vertical center. */
export function revealRange(ta: HTMLTextAreaElement, range: TextRange): void {
  ta.setSelectionRange(range.start, range.end);
  const top = textOffsetTop(ta, range.start);
  ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
}
