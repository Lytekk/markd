import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { extractHeadings, type HeadingEntry } from "@/lib/section-commands";
import { computeHiddenSet, hasChildren } from "@/lib/outline-tree";

interface OutlinePanelProps {
  editor: Editor | null;
}

const COLLAPSED_KEY = "markd-outline-collapsed";

/**
 * Resolve the active heading index from the scroll-spy candidate, forcing the
 * first heading at the very top of the document and the last at the very
 * bottom. Pure (no DOM) so the edge behavior is unit-tested independently of
 * layout. `candidate` is the index chosen by the 40%-viewport-line rule.
 */
export function clampActiveHeading(
  candidate: number,
  count: number,
  atTop: boolean,
  atBottom: boolean,
): number {
  if (count === 0) return 0;
  if (atTop) return 0;
  if (atBottom) return count - 1;
  return candidate;
}

export function OutlinePanel({ editor }: OutlinePanelProps) {
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);
  const headingsRef = useRef<HeadingEntry[]>([]);

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
    (pos: number) => {
      if (!editor) return;

      const dom = editor.view.nodeDOM(pos);
      const element =
        dom instanceof HTMLElement ? dom : (dom as Node)?.parentElement;

      editor.chain().focus().setTextSelection(pos + 1).run();
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
            onClick={() => handleClick(heading.pos)}
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
