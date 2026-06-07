import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { extractHeadings, type HeadingEntry } from "@/lib/section-commands";
import { computeHiddenSet, hasChildren } from "@/lib/outline-tree";
import { clampActiveHeading } from "@/lib/outline-active";
import { flashWhenInView } from "@/lib/heading-flash";

interface OutlinePanelProps {
  editor: Editor | null;
}

const COLLAPSED_KEY = "markd-outline-collapsed";

export function OutlinePanel({ editor }: OutlinePanelProps) {
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);
  const headingsRef = useRef<HeadingEntry[]>([]);
  // Holds the scroll-spy back briefly after an outline click so the programmatic
  // smooth-scroll's own scroll events can't overwrite the clicked heading before
  // it settles. Time-window idiom mirrors Editor.tsx's TYPING_PRIORITY_MS.
  const suppressSpyUntilRef = useRef(0);
  // Cancels a pending "flash once in view" from a prior click, so a rapid second
  // click can't flash the previous heading when its scroll finally lands.
  const cancelFlashRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelFlashRef.current?.(), []);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch {
      return new Set();
    }
  });

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // Quota exceeded — collapse state is non-critical, drop silently
      }
      return next;
    });
  }, []);

  const hiddenSet = useMemo(
    () => computeHiddenSet(headings, collapsedIds),
    [headings, collapsedIds],
  );

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const h = extractHeadings(editor);
      setHeadings(h);
      headingsRef.current = h;
    };
    update();

    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) update();
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || headings.length === 0) {
      setActiveHeadingIndex(null);
      return;
    }

    const scrollContainer = editor.view.dom.closest(".markd-editor-scroll");
    if (!scrollContainer) return;

    let ticking = false;
    const updateActive = () => {
      ticking = false;
      // After an outline click we pin the clicked heading active and ignore the
      // smooth-scroll's transient scroll events for ~700ms (see handleClick).
      if (performance.now() < suppressSpyUntilRef.current) return;
      const h = headingsRef.current;
      if (h.length === 0) return;

      const containerRect = scrollContainer.getBoundingClientRect();
      const containerTop = containerRect.top + containerRect.height * 0.4;
      let candidate = 0;

      for (let i = h.length - 1; i >= 0; i--) {
        const dom = editor.view.nodeDOM(h[i]!.pos);
        const el = dom instanceof HTMLElement ? dom : (dom as Node)?.parentElement;
        if (el instanceof HTMLElement) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= containerTop) {
            candidate = i;
            break;
          }
        }
      }

      // Force first/last at the scroll extremes: the 40%-line rule alone misses
      // the first heading at the very top (lower clustered headings win) and the
      // last heading at the very bottom (a short final section never crosses the
      // line). Clamp so scroll-top highlights heading 0 and scroll-bottom the last.
      const EDGE_EPS = 2;
      const atTop = scrollContainer.scrollTop <= EDGE_EPS;
      const atBottom =
        scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - EDGE_EPS;
      setActiveHeadingIndex(clampActiveHeading(candidate, h.length, atTop, atBottom));
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateActive);
      }
    };

    // NOTE: rAF deduplication (not throttling) — coalesces multiple scroll events into one computation per frame
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    updateActive();

    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [editor, headings]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeHeadingIndex]);

  const handleClick = useCallback(
    (index: number, pos: number) => {
      if (!editor) return;

      // Highlight the clicked row at once and hold the scroll-spy back for the
      // smooth-scroll's duration — the scroll lands the heading at viewport
      // centre, below the 40%-line spy threshold, so without this the spy would
      // re-pick the previous heading. After the window lapses with no further
      // user scroll, the clicked heading stays active.
      setActiveHeadingIndex(index);
      suppressSpyUntilRef.current = performance.now() + 700;

      editor.chain().focus().setTextSelection(pos + 1).run();

      const dom = editor.view.nodeDOM(pos);
      const element = dom instanceof HTMLElement ? dom : (dom as Node)?.parentElement ?? null;

      // Defer the flash until the heading has actually scrolled into view, then
      // play it once. Firing at click time would burn the ~1.4s pulse off-screen
      // while the smooth-scroll is still travelling for any off-viewport heading.
      // flashHeadingAt(pos) re-resolves the node BY POSITION, so it still targets
      // the right element even if PM re-rendered it during the scroll. A fallback
      // (in flashWhenInView) still flashes if the observer never reports in view.
      if (element) {
        cancelFlashRef.current?.();
        cancelFlashRef.current = flashWhenInView({
          element,
          root: element.closest(".markd-editor-scroll"),
          threshold: 0.6,
          onInView: () => editor.commands.flashHeadingAt(pos),
          createObserver: (cb, opts) =>
            new IntersectionObserver((entries) => cb(entries), opts),
          scheduleFallback: (run) => {
            // Only matters if the observer never reports in view (heading detached
            // by a re-render). 2000ms gives a very long smooth-scroll headroom to
            // land first, so the fallback doesn't flash mid-travel.
            const id = window.setTimeout(run, 2000);
            return () => window.clearTimeout(id);
          },
        });
      }
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [editor],
  );

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
    setDraggingIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (!isNaN(fromIndex) && fromIndex !== toIndex) {
        editor?.commands.moveSection(fromIndex, toIndex);
      }
      setDraggingIndex(null);
      setDragOverIndex(null);
    },
    [editor],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (!e.altKey) return;
      if (e.key === "ArrowUp" && index > 0) {
        e.preventDefault();
        editor?.commands.moveSection(index, index - 1);
      } else if (e.key === "ArrowDown" && index < headings.length - 1) {
        e.preventDefault();
        editor?.commands.moveSection(index, index + 1);
      }
    },
    [editor, headings.length],
  );

  if (headings.length === 0) {
    return (
      <div className="markd-outline-empty">
        No headings in this document
      </div>
    );
  }

  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <div className="markd-outline">
      {headings.map((heading, index) => {
        if (hiddenSet.has(index)) return null;
        const isParent = hasChildren(headings, index);
        const isCollapsed = collapsedIds.has(heading.id);
        return (
          <div
            key={heading.id}
            className={`markd-outline-item ${index === activeHeadingIndex ? "active" : ""} ${index === draggingIndex ? "dragging" : ""} ${index === dragOverIndex ? "drag-over" : ""}`}
            style={{ paddingLeft: 16 + (heading.level - minLevel) * 16 }}
            onClick={() => handleClick(index, heading.pos)}
            aria-current={index === activeHeadingIndex ? "true" : undefined}
            ref={index === activeHeadingIndex ? activeItemRef : undefined}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragEnter={(e) => handleDragEnter(e, index)}
            onDragOver={handleDragOver}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={(e) => handleDrop(e, index)}
            tabIndex={0}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {isParent ? (
              <button
                type="button"
                className="markd-outline-caret"
                aria-label={isCollapsed ? "Expand section" : "Collapse section"}
                aria-expanded={!isCollapsed}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(heading.id);
                }}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            ) : (
              <span className="markd-outline-caret markd-outline-caret-empty" aria-hidden="true" />
            )}
            <span className="markd-outline-level">H{heading.level}</span>
            <span className="markd-outline-text">{heading.text}</span>
          </div>
        );
      })}
    </div>
  );
}
