import type { JSONContent } from "@tiptap/core";

/**
 * Source-mode-aware content-truth accessors.
 *
 * In source mode the user's bytes live in the SourceEditor textarea
 * (`sourceMarkdown` in App.tsx) — the ProseMirror editor still holds the doc
 * from source-mode ENTRY and knows nothing about edits since. Every consumer
 * that asks "what is the buffer's current content?" (tab snapshots, the
 * closed-tab stack, Ctrl+S, Save As, the 30s autosave) is answered through
 * these three functions, registered once in App.tsx. The rules:
 *
 *  - Answer from the textarea VERBATIM. Serializing the stale editor loses
 *    every edit since entry; round-tripping the textarea through the AST
 *    (setContent → getMarkdown) churns untouched bytes via normalization.
 *  - Report no PM-JSON cache: the editor's JSON does not correspond to the
 *    textarea content, and a stale cache would be restored over the real
 *    content on switch-back (FileTab.docJSON invariant in use-file-tabs.ts).
 *  - Report not-clean: the doc.eq(saved) predicate reads the editor, which is
 *    exactly the thing that can't see textarea edits. The clean-skip only
 *    exists to avoid a costly PM serialize — in source mode the "serialize"
 *    is returning an existing string, so skipping saves nothing anyway.
 */

/** The buffer's current markdown: the textarea verbatim in source mode, else the serialized editor. */
export function currentMarkdown(
  sourceMode: boolean,
  sourceMarkdown: string,
  editorMarkdown: () => string,
): string {
  return sourceMode ? sourceMarkdown : editorMarkdown();
}

/** PM-JSON restore-cache candidate for a tab snapshot — none exists in source mode. */
export function currentDocJSON(
  sourceMode: boolean,
  editorJSON: () => JSONContent,
): JSONContent | undefined {
  return sourceMode ? undefined : editorJSON();
}

/** Clean-skip gate: never clean in source mode; the editor predicate can't see the textarea. */
export function editorBufferIsClean(
  sourceMode: boolean,
  editorMatchesSaved: () => boolean,
): boolean {
  return sourceMode ? false : editorMatchesSaved();
}
