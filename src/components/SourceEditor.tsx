import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import type { TextRange } from "@/lib/text-search";
import { lineStartOffsets, measureLineTops } from "@/lib/textarea-metrics";

interface SourceEditorProps {
  markdown: string;
  onMarkdownChange: (md: string) => void;
  lineNumbers: boolean;
  /** Find/replace match ranges — rendered by the highlight backdrop. */
  searchRanges?: TextRange[] | null;
  searchCurrent?: number;
}

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
  // frame and the (irrelevant) last line.
  const [rowHeights, setRowHeights] = useState<number[] | null>(null);
  const measureGutter = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const tops = measureLineTops(ta, lineStartOffsets(ta.value));
    setRowHeights(tops.map((t, i) => (i + 1 < tops.length ? tops[i + 1]! - t : 0)));
  }, []);
  useEffect(() => {
    if (!lineNumbers) {
      setRowHeights(null);
      return;
    }
    const id = window.setTimeout(measureGutter, 80);
    return () => window.clearTimeout(id);
  }, [lineNumbers, value, measureGutter]);
  useEffect(() => {
    // Width changes re-wrap the text (full-width toggle, window resize).
    if (!lineNumbers || typeof ResizeObserver === "undefined") return;
    const ta = textareaRef.current;
    if (!ta) return;
    const ro = new ResizeObserver(() => measureGutter());
    ro.observe(ta);
    return () => ro.disconnect();
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
        <div className="markd-line-gutter" ref={gutterRef}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              className="markd-line-number"
              style={rowHeights?.[i] ? { height: rowHeights[i] } : undefined}
            >
              {i + 1}
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
