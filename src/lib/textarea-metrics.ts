import type { TextRange } from "@/lib/text-search";

/**
 * Vertical pixel offset of a character offset inside a textarea, measured via
 * a hidden mirror div with the textarea's text metrics (the standard textarea-
 * measurement technique — a textarea exposes no per-character geometry). Used
 * to scroll a match / heading into view; layout-dependent, so verified live
 * rather than unit-tested (jsdom has no layout).
 */
export function textOffsetTop(ta: HTMLTextAreaElement, offset: number): number {
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
  mirror.textContent = ta.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

/** Select `range` in the textarea and scroll it to the vertical center. */
export function revealRange(ta: HTMLTextAreaElement, range: TextRange): void {
  ta.setSelectionRange(range.start, range.end);
  const top = textOffsetTop(ta, range.start);
  ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
}
