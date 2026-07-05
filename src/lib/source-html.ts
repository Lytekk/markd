import type { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { parseSavedDoc } from "@/lib/dirty-check";

/**
 * Render raw markdown (the source-mode textarea's content) to export HTML
 * through the SAME pipeline as editor.getHTML(): markdown → PM doc (via
 * parseSavedDoc, which mirrors tiptap-markdown's setContent path) → schema
 * DOMSerializer. This keeps the export-path security guarantee — raw HTML in
 * the source lands in escaped text/attrs via the raw-html chip nodes, never
 * as live elements. Do NOT swap this for markdown-it's HTML output: with
 * html:true it emits hostile markup verbatim, bypassing that layer.
 *
 * Returns null when the markdown fails to parse — callers fall back to the
 * editor's own (possibly stale) getHTML rather than exporting nothing.
 */
export function renderSourceHtml(editor: Editor, markdown: string): string | null {
  const doc = parseSavedDoc(editor, markdown);
  if (!doc) return null;
  const div = document.createElement("div");
  div.appendChild(
    DOMSerializer.fromSchema(editor.state.schema).serializeFragment(doc.content),
  );
  return div.innerHTML;
}
