import { useEffect, useRef } from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { computeTextStats } from "@/lib/text-stats";

interface EditorProps {
  editor: TiptapEditor | null;
  focusMode: boolean;
}

// Matches App's source-mode coalescing window: the status bar stays responsive
// without paying an O(document) pass per keystroke.
const STATS_COALESCE_MS = 150;

export function Editor({ editor, focusMode }: EditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Dispatch word/char stats on every transaction. `transaction` (not
  // `update`) is required because file loads use `setContent(md, false)`
  // which suppresses the `update` event — stats would stay at 0 after load.
  useEffect(() => {
    if (!editor) return;
    // `doc.textContent` rebuilds the whole document as a string and
    // computeTextStats then splits it — O(document), and this fired on EVERY
    // transaction: caret moves, selection changes, focus-mode and search meta
    // transactions, mermaid redraws. None of those change a word count.
    // Gate on docChanged, then coalesce the rest to the end of a typing burst,
    // the same way source mode does.
    let timer: number | null = null;
    const dispatch = () => {
      timer = null;
      window.dispatchEvent(
        new CustomEvent("markd:stats", {
          detail: computeTextStats(editor.state.doc.textContent),
        }),
      );
    };
    const handler = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(dispatch, STATS_COALESCE_MS);
    };
    editor.on("transaction", handler);
    // Once up front so a freshly loaded document reports immediately —
    // setContent(md, false) suppresses `update`, which is why this listens to
    // `transaction` at all.
    dispatch();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      editor.off("transaction", handler);
    };
  }, [editor]);

  // Focus mode is a ProseMirror node-decoration plugin (src/lib/focus-mode.ts):
  // it dims non-active blocks via CSS classes that PM re-applies on every
  // render. The earlier inline-opacity approach failed because PM discards
  // inline styles on re-render; here we just drive the extension's enabled flag.
  useEffect(() => {
    editor?.commands.setFocusMode(focusMode);
  }, [editor, focusMode]);

  // Reading focus: while focus mode is on, scrolling and hovering both
  // re-target the crisp block to where the user is looking — the viewport
  // centre on scroll, the block under the pointer on hover. Both feed
  // setFocusScrollPos; a caret move clears it (see nextScrollPos). Priority:
  // typing / caret movement wins over the mouse — hover is suppressed for a
  // short window after any caret activity, so an incidental mouse move can't
  // steal focus mid-edit. Scroll is NOT suppressed (it intentionally overrides
  // the caret). rAF-coalesced; hover is deduped to the top-level block.
  useEffect(() => {
    if (!editor || !focusMode) return;
    const scroller = scrollRef.current;
    if (!scroller) return;

    const TYPING_PRIORITY_MS = 500;
    let raf = 0;
    let lastHoverBlock = -1;
    let lastCaretActivity = 0;

    const noteCaretActivity = ({ transaction }: { transaction: { docChanged: boolean; selectionSet: boolean } }) => {
      // Real typing / caret moves only — the reading-focus updates dispatch a
      // meta-only transaction (no doc change, no selection change).
      if (transaction.docChanged || transaction.selectionSet) {
        lastCaretActivity = performance.now();
      }
    };
    editor.on("transaction", noteCaretActivity);

    const blockAt = (left: number, top: number): { pos: number; blockStart: number } | null => {
      const at = editor.view.posAtCoords({ left, top });
      if (!at) return null;
      const $pos = editor.state.doc.resolve(at.pos);
      return { pos: at.pos, blockStart: $pos.depth > 0 ? $pos.before(1) : at.pos };
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = scroller.getBoundingClientRect();
        const hit = blockAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (hit) editor.commands.setFocusScrollPos(hit.pos);
      });
    };

    const onMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (performance.now() - lastCaretActivity < TYPING_PRIORITY_MS) return; // caret wins
        const hit = blockAt(clientX, clientY);
        if (!hit || hit.blockStart === lastHoverBlock) return;
        lastHoverBlock = hit.blockStart;
        editor.commands.setFocusScrollPos(hit.pos);
      });
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      editor.off("transaction", noteCaretActivity);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [editor, focusMode]);

  if (!editor) return null;

  return (
    <div ref={scrollRef} className={`markd-editor-scroll ${focusMode ? "focus-mode" : ""}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
