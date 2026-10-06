import { sourceSyntax, type SyntaxSpan } from "@/lib/source-syntax";
import { applySourceCommand, sourceShortcut } from "@/lib/source-commands";
import { createEditHistory, recordSourceEdit, travelEditHistory, type EditHistory } from "@/lib/edit-history";
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import type { TextRange } from "@/lib/text-search";
import { lineStartOffsets, measureLineHeights, revealRange } from "@/lib/textarea-metrics";

interface SourceEditorProps {
  markdown: string;
  history?: EditHistory;
  onHistory?: (redo: boolean) => void;
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
// metrics, syntax-colored glyphs and optional search marks. A plain
// textarea cannot style sub-ranges, and its selection is invisible while the
// find panel keeps focus — this is the standard highlight-backdrop technique.
function renderHighlightSegments(text: string, syntax: SyntaxSpan[], ranges: TextRange[], current: number): ReactNode[] {
  const boundaries = [...new Set([0, text.length, ...syntax.flatMap(s => [s.start, s.end]), ...ranges.flatMap(r => [r.start, r.end])])].sort((a, b) => a - b);
  let token = 0, match = 0;
  return boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1]!;
    while (token < syntax.length && syntax[token]!.end <= start) token++;
    while (match < ranges.length && ranges[match]!.end <= start) match++;
    const found = ranges[match] && ranges[match]!.start <= start && ranges[match]!.end >= end;
    const content = text.slice(start, end);
    return <span key={start} className={syntax[token]?.className || undefined}>
      {found ? <mark className={match === current ? "markd-search-current" : undefined}>{content}</mark> : content}
    </span>;
  });
}

export function SourceEditor({
  markdown,
  history: tabHistory,
  onHistory,
  onMarkdownChange,
  lineNumbers,
  zoom,
  searchRanges,
  searchCurrent,
}: SourceEditorProps) {
  const localHistory = useRef(createEditHistory(markdown));
  const history = tabHistory ?? localHistory.current;
  const historyRef = useRef(history);
  historyRef.current = history;
  const [value, setValue] = useState(markdown);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const displayedHistoryRef = useRef<EditHistory | null>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    recordSourceEdit(history, markdown);
    setValue(markdown);
  }, [markdown, history]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (value !== markdown) return;
    if (ta && displayedHistoryRef.current !== history) {
      ta.setSelectionRange(history.current.start, history.current.end);
    }
    displayedHistoryRef.current = history;
  }, [value, markdown, history]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      recordSourceEdit(history, e.target.value, e.target.selectionStart, e.target.selectionEnd, (e.nativeEvent as InputEvent).inputType);
      setValue(e.target.value);
      onMarkdownChange(e.target.value);
    },
    [onMarkdownChange, history],
  );

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !onHistory) return;
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
      event.preventDefault();
      onHistory(event.inputType === "historyRedo");
    };
    ta.addEventListener("beforeinput", onBeforeInput);
    return () => ta.removeEventListener("beforeinput", onBeforeInput);
  }, [onHistory]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;
      const command = sourceShortcut(e.nativeEvent);
      if (command) {
        e.preventDefault();
        const ta = e.currentTarget;
        const next = applySourceCommand(value, { start: ta.selectionStart, end: ta.selectionEnd }, command);
        recordSourceEdit(history, next.text, next.start, next.end);
        setValue(next.text);
        onMarkdownChange(next.text);
        requestAnimationFrame(() => {
          if (historyRef.current === history && textareaRef.current === ta) revealRange(ta, next);
        });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey &&
          (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        const redo = e.shiftKey || e.key.toLowerCase() === "y";
        if (onHistory) { onHistory(redo); return; }
        const next = travelEditHistory(history, redo);
        if (next) {
          setValue(next.text);
          onMarkdownChange(next.text);
          const textarea = e.currentTarget;
          requestAnimationFrame(() => {
            if (textareaRef.current === textarea && historyRef.current === history && history.current === next) {
              revealRange(textarea, next);
            }
          });
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue =
          value.substring(0, start) + "  " + value.substring(end);
        recordSourceEdit(history, newValue, start + 2);
        setValue(newValue);
        onMarkdownChange(newValue);
        requestAnimationFrame(() => {
          if (textareaRef.current === textarea && historyRef.current === history) {
            revealRange(textarea, { start: start + 2, end: start + 2 });
          }
        });
      }
    },
    [value, onMarkdownChange, history, onHistory],
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

  // Never paint stale colored text over live typing. Until the coalesced
  // tokenizer catches up, render the exact current text with its base color.
  const [syntax, setSyntax] = useState(() => ({ text: markdown, spans: sourceSyntax(markdown) }));
  useEffect(() => {
    if (syntax.text === value) return;
    const timer = window.setTimeout(() => setSyntax({ text: value, spans: sourceSyntax(value) }), 60);
    return () => window.clearTimeout(timer);
  }, [value, syntax.text]);
  const highlightSegments = useMemo(() => renderHighlightSegments(
    value, syntax.text === value ? syntax.spans : [{ start: 0, end: value.length, className: "" }],
    searchRanges ?? [], searchCurrent ?? -1,
  ), [value, syntax, searchRanges, searchCurrent]);

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
        <div className="markd-source-backdrop markd-source-syntax" ref={backdropRef} aria-hidden="true">
          {highlightSegments}
          {"\n"}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="markd-source-textarea markd-source-colored"
        value={value}
        onSelect={(e) => {
          if (history.current.start !== e.currentTarget.selectionStart || history.current.end !== e.currentTarget.selectionEnd) {
            history.group = undefined;
            history.current.rendered = undefined;
          }
          history.current.start = e.currentTarget.selectionStart;
          history.current.end = e.currentTarget.selectionEnd;
          history.current.sourceSelectionMapped = true;
        }}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        spellCheck={false}
      />
    </div>
  );
}
