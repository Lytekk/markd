import type { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";

/**
 * Load a document into the shared editor and RESET ProseMirror history.
 *
 * One PM instance hosts every tab's doc. A plain `setContent` records the
 * content swap as an undoable step, so Ctrl+Z after a tab switch restored
 * the PREVIOUS tab's document into the current tab — with the 30s autosave
 * then poised to write the wrong doc over the file (user-hit data loss,
 * 2026-06-12). Stripping just the one step isn't enough either: older
 * history entries would be re-mapped onto the new doc and undo would apply
 * a foreign step to it.
 *
 * Re-creating the EditorState from the freshly-loaded doc re-initializes
 * every plugin state — empty history means undo is a no-op at a load
 * boundary and undo-after-edits stops AT the loaded doc. Extension storage
 * (search term, focus mode, markdown serializer) lives outside plugin state
 * and survives.
 */
export function loadEditorContent(editor: Editor, body: string): void {
  editor.commands.setContent(body, false);
  const { view } = editor;
  view.updateState(
    EditorState.create({ doc: view.state.doc, plugins: view.state.plugins }),
  );
}
