import type { Editor } from "@tiptap/core";
import { DOMParser as PMDOMParser, type Node as PMNode } from "@tiptap/pm/model";

/**
 * True when the live doc has returned to the saved-state baseline (e.g. the
 * user Ctrl+Z'd every change away) — the signal that clears the dirty
 * indicator without a save.
 *
 * ProseMirror docs are persistent data structures: an edit replaces only the
 * nodes along the changed path, and undo restores the ORIGINAL node objects.
 * `doc.eq(saved)` therefore hits reference-equality fast paths on the
 * shared-lineage case, making this far cheaper than serializing markdown on
 * each keystroke. Frontmatter lives outside the editor, so it is compared
 * separately.
 */
export function docMatchesSaved(
  doc: PMNode,
  savedDoc: PMNode | null,
  frontmatter: string,
  savedFrontmatter: string,
): boolean {
  if (!savedDoc) return false;
  if (frontmatter !== savedFrontmatter) return false;
  return doc.eq(savedDoc);
}

/**
 * Parse a saved markdown body into a standalone doc for baseline compares —
 * used when a dirty tab is restored, where the editor holds unsaved content
 * and the saved state must be reconstructed. Mirrors tiptap-markdown's own
 * setContent path (markdown → HTML → PM parse) so the result is structurally
 * identical to what loading the same string produces. Returns null on parse
 * failure; callers degrade to "stay dirty" (never falsely clean).
 */
export function parseSavedDoc(editor: Editor, savedBody: string): PMNode | null {
  try {
    const html = editor.storage.markdown.parser.parse(savedBody, { inline: false });
    if (typeof html !== "string") return null;
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return PMDOMParser.fromSchema(editor.state.schema).parse(tmp);
  } catch {
    return null;
  }
}

/**
 * Whether a "buffer matches the saved baseline" result is ALLOWED to clear
 * the dirty flag. A detached buffer (file trashed → filePath null while
 * savedContent keeps the old on-disk text) has no saved state anymore: the
 * in-editor buffer may be the only copy, so matching the stale baseline must
 * never clear the unsaved-changes close guard. Never-saved untitled buffers
 * (savedContent "") may clear — an empty scratch buffer has nothing to lose.
 */
export function canRevertClean(filePath: string | null, savedContent: string): boolean {
  return filePath !== null || savedContent === "";
}

/**
 * Dirty predicate for source mode, where the buffer is a raw string and plain
 * equality suffices. Buffer == saved file → clean. Buffer == the entry
 * snapshot → restore the entry dirty flag (serialization can normalize
 * markdown, so a clean doc's entry snapshot may differ from savedContent
 * byte-wise — matching it means "back where source mode started", not
 * necessarily "matches disk"). Anything else → dirty.
 *
 * The entry branch is only honored while `savedContent` still equals
 * `entrySavedContent` (its value when the entry snapshot was seeded). Once a
 * save happens in source mode, savedContent belongs to a NEWER state and a
 * buffer matching the PRE-save entry no longer matches disk — honoring the
 * stale entry flag there falsely reported clean and let the close guard
 * silently discard a reverted buffer (adversarial-review confirmed).
 */
export function sourceModeIsDirty(
  md: string,
  savedContent: string,
  entryMd: string,
  entryWasDirty: boolean,
  entrySavedContent: string,
): boolean {
  if (md === savedContent) return false;
  if (md === entryMd && savedContent === entrySavedContent) return entryWasDirty;
  return true;
}
