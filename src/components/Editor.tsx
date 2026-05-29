import { useEffect, useRef } from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";

interface EditorProps {
  editor: TiptapEditor | null;
  onUpdate: () => void;
  focusMode: boolean;
}

export function Editor({ editor, focusMode }: EditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Dispatch word/char stats on every transaction. `transaction` (not
  // `update`) is required because file loads use `setContent(md, false)`
  // which suppresses the `update` event — stats would stay at 0 after load.
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const text = editor.state.doc.textContent;
      const words = text.split(/\s+/).filter(Boolean).length;
      window.dispatchEvent(
        new CustomEvent("markd:stats", {
          detail: { words, chars: text.length },
        }),
      );
    };
    editor.on("transaction", handler);
    handler();
    return () => {
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

  // While focus mode is on, scrolling re-targets the crisp block to the one
  // centered in the viewport (reading focus), overriding the caret until the
  // caret moves again (nextScrollPos clears it on selection change). rAF-
  // coalesced to one update per frame.
  useEffect(() => {
    if (!editor || !focusMode) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = scroller.getBoundingClientRect();
        const at = editor.view.posAtCoords({
          left: rect.left + rect.width / 2,
          top: rect.top + rect.height / 2,
        });
        if (at) editor.commands.setFocusScrollPos(at.pos);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
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
