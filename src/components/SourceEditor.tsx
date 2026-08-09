import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import type { TextRange } from "@/lib/text-search";
import { lineStartOffsets, measureLineHeights } from "@/lib/textarea-metrics";

interface SourceEditorProps {
  markdown: string;
  onMarkdownChange: (md: string) => void;
  lineNumbers: boolean;
  /** Font zoom changes wrapping/row height without changing the textarea box. */
  zoom: number;
  /** Find/replace match ranges — rendered by the highlight backdrop. */
  searchRanges?: TextRange[] | null;
  searchCurrent?: number;
}

const GUTTER_MEASURE_DELAY_MS = 80;

// The backdrop is a text twin painted behind the transparent textarea: same
// metrics, transparent glyphs, only the <mark> backgrounds visible. A plain
// textarea cannot style sub-ranges, and its selection is invisible while the
// find panel keeps focus — this is the standard highlight-backdrop technique.
function renderHighlightSegments(
  text: string,
  ranges: TextRange[],
  current: number,
): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) out.push(text.slice(cursor, r.start));
    out.push(
      <mark key={i} className={i === current ? "markd-search-current" : undefined}>
        {text.slice(r.start, r.end)}
      </mark>,
    );
    cursor = r.end;
  });
  out.push(text.slice(cursor));
  return out;
}

export function SourceEditor({
  markdown,
  onMarkdownChange,
  lineNumbers,
  zoom,
  searchRanges,
  searchCurrent,
}: SourceEditorProps) {
  const [value, setValue] = useState(markdown);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setValue(markdown);
  }, [markdown]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      onMarkdownChange(e.target.value);
    },
    [onMarkdownChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue =
          value.substring(0, start) + "  " + value.substring(end);
        setValue(newValue);
        onMarkdownChange(newValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      }
    },
    [value, onMarkdownChange],
  );

  // Keep the backdrop's box and scroll in lockstep with the textarea. The
  // right inset mirrors the textarea's SCROLLBAR width (offsetWidth −
  // clientWidth): the scrollbar narrows the textarea's content box, and
  // without the inset the two wrap at different widths — highlights drift
  // vertically on any scrollable soft-wrapped doc (adversarial-review catch).
  const syncBackdrop = useCallback(() => {
    const ta = textareaRef.current;
    const bd = backdropRef.current;
    if (!ta || !bd) return;
    bd.style.right = `${ta.offsetWidth - ta.clientWidth}px`;
    bd.scrollTop = ta.scrollTop;
    bd.scrollLeft = ta.scrollLeft;
  }, []);

  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
    syncBackdrop();
  }, [syncBackdrop]);

  // A freshly-mounted / re-rendered backdrop starts at scroll 0 while the
  // textarea may be scrolled — resnap whenever its content changes (this also
  // re-measures the scrollbar as content grows/shrinks past the overflow
  // threshold).
  useEffect(() => {
    syncBackdrop();
  }, [searchRanges, searchCurrent, value, syncBackdrop]);

  const lineCount = value.split("\n").length;

  // Measured gutter row heights: soft-wrap stays ON with line numbers (a
  // user-visible wrap-off was the old behavior — reported 2026-07-05), so a
  // logical line can span several visual rows; its number cell gets the
  // line's MEASURED height. One debounced mirror pass per edit burst, only
  // while line numbers are on; the CSS fixed height covers the pre-measure
  // frame. The measured array includes the final logical line.
  const [rowHeights, setRowHeights] = useState<number[] | null>(null);
  const measureGutter = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    setRowHeights(measureLineHeights(ta, lineStartOffsets(ta.value)));
  }, []);
  useEffect(() => {
    if (!lineNumbers) {
      setRowHeights(null);
      return;
    }
    const id = window.setTimeout(measureGutter, GUTTER_MEASURE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [lineNumbers, value, zoom, measureGutter]);
  useEffect(() => {
    // Content-box width changes re-wrap the text (full-width toggle, sidebar,
    // window resize). Full↔Column changes horizontal padding while clientWidth
    // stays fixed, so ResizeObserverEntry.contentRect.width is authoritative.
    //
    // measureGutter builds a hidden mirror of the WHOLE document — one span per
    // line — and reads offsetTop off every marker. That is hundreds of
    // milliseconds on a large document, and this observer used to call it once
    // per resize notification, unthrottled: dragging a window edge fired it
    // continuously. Only WIDTH re-wraps text, so height notifications are
    // ignored, and a trailing debounce measures once after the resize settles.
    if (!lineNumbers || typeof ResizeObserver === "undefined") return;
    const ta = textareaRef.current;
    if (!ta) return;
    let timer: number | null = null;
    const cs = getComputedStyle(ta);
    let lastWidth =
      ta.clientWidth -
      (Number.parseFloat(cs.paddingLeft) || 0) -
      (Number.parseFloat(cs.paddingRight) || 0);
    const ro = new ResizeObserver((entries) => {
      const width = entries.find((entry) => entry.target === ta)?.contentRect.width;
      if (width === undefined || Math.abs(width - lastWidth) < 0.5) return;
      lastWidth = width;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        measureGutter();
      }, GUTTER_MEASURE_DELAY_MS);
    });
    ro.observe(ta);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [lineNumbers, measureGutter]);

  // Memoized so unrelated re-renders (line-number toggle, focus churn) don't
  // rebuild the whole-document segment list; content/match changes still do —
  // unavoidable, the text changed. Known bound (review-noted): with the panel
  // open on very large docs this is O(doc length) per keystroke.
  const highlightSegments = useMemo(
    () =>
      searchRanges && searchRanges.length > 0
        ? renderHighlightSegments(value, searchRanges, searchCurrent ?? -1)
        : null,
    [value, searchRanges, searchCurrent],
  );

  return (
    <div className={`markd-source-editor ${lineNumbers ? "with-line-numbers" : ""}`}>
      {lineNumbers && (
        <div className="markd-line-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              className="markd-line-number"
              style={rowHeights?.[i] !== undefined ? { height: rowHeights[i] } : undefined}
            >
              <span className="markd-line-number-label">{i + 1}</span>
            </div>
          ))}
        </div>
      )}
      {highlightSegments && (
        <div className="markd-source-backdrop" ref={backdropRef} aria-hidden="true">
          {highlightSegments}
          {"\n"}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="markd-source-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        spellCheck={false}
      />
    </div>
  );
}
