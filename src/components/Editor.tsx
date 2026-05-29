import { useEffect } from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";

interface EditorProps {
  editor: TiptapEditor | null;
  onUpdate: () => void;
  focusMode: boolean;
}

export function Editor({ editor, focusMode }: EditorProps) {
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

  if (!editor) return null;

  return (
    <div className={`markd-editor-scroll ${focusMode ? "focus-mode" : ""}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
