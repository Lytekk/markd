import type { Editor } from "@tiptap/core";
import { EditorState, type Plugin } from "@tiptap/pm/state";

/**
 * prosemirror-history's plugin is the only one whose state carries both an undo
 * branch (`done`) and a redo branch (`undone`). Identify it structurally rather
 * than by an unexported key so we can reset ONLY it.
 */
export function isHistoryPlugin(plugin: Plugin, state: EditorState): boolean {
  const s = plugin.getState(state) as unknown;
  return !!s && typeof s === "object" && "done" in s && "undone" in s;
}

/**
 * Load a document into the shared editor and RESET ProseMirror undo history.
 *
 * One PM instance hosts every tab's doc. A plain `setContent` records the swap as
 * an undoable step, so Ctrl+Z after a tab switch restored the PREVIOUS tab's
 * document into the current tab — with the 30s autosave then poised to write the
 * wrong doc over the file (user-hit data loss, 2026-06-12). Clearing history at
 * the load boundary makes undo a no-op there, and undo-after-edits stops AT the
 * loaded doc. Extension storage (search term, focus mode, markdown serializer)
 * lives outside plugin state and survives.
 */
export function loadEditorContent(editor: Editor, body: string): void {
  editor.commands.setContent(body, false);
  const { view } = editor;
  const { state } = view;

  // Clearing undo history (above) is the data-loss fix, but HOW matters for
  // perf. Recreating the whole EditorState re-initializes all ~88 plugins, which
  // forces a full SECOND view re-render of the just-loaded doc (every code block
  // re-highlighted, every NodeView rebuilt) — measured ~49ms on a large doc, i.e.
  // most of the tab-switch lag. Instead, drop and re-add ONLY the history plugin:
  // it gets a fresh (empty) state while every other plugin keeps its decorations,
  // so updateState is a near-no-op render. Verified to still clear undo.
  const history = state.plugins.find((p) => isHistoryPlugin(p, state));
  if (!history) {
    // Fallback: if history can't be located (e.g. a future TipTap change),
    // recreate the whole state so the undo-isolation guarantee always holds.
    view.updateState(EditorState.create({ doc: state.doc, plugins: state.plugins }));
    return;
  }
  const withoutHistory = state.reconfigure({
    plugins: state.plugins.filter((p) => p !== history),
  });
  view.updateState(withoutHistory.reconfigure({ plugins: state.plugins }));
}
