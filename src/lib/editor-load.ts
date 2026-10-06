import type { Editor, JSONContent } from "@tiptap/core";
import { EditorState, Plugin } from "@tiptap/pm/state";

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
 * Load a document with isolated undo history, optionally restoring its tab snapshot.
 *
 * One PM instance hosts every tab's doc. A plain `setContent` records the swap as
 * an undoable step, so Ctrl+Z after a tab switch restored the PREVIOUS tab's
 * document into the current tab — with the 30s autosave then poised to write the
 * wrong doc over the file (user-hit data loss, 2026-06-12). Clearing history at
 * a fresh-load boundary makes undo a no-op there, and undo-after-edits stops AT the
 * loaded doc. Extension storage (search term, focus mode, markdown serializer)
 * lives outside plugin state and survives.
 *
 * `body` is markdown (first load / open) OR a ProseMirror JSON doc (a tab's
 * cached doc on switch-back). JSON skips the expensive markdown re-parse — see
 * the per-tab docJSON cache in use-file-tabs.
 */
export function loadEditorContent(
  editor: Editor,
  body: string | JSONContent,
  snapshot?: EditorState,
): void {
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
  // Only restore history against its exact document and plugin instance. Disk
  // loads and stale snapshots retain the fresh-load isolation guarantee.
  const canRestore = snapshot?.schema === state.schema &&
    snapshot.doc.eq(state.doc) && snapshot.plugins.includes(history);
  const seededHistory = canRestore ? new Plugin({
    ...history.spec,
    state: {
      ...history.spec.state!,
      init: () => history.getState(snapshot!),
    },
  }) : history;
  let restored = withoutHistory.reconfigure({
    plugins: state.plugins.map((plugin) => plugin === history ? seededHistory : plugin),
  });
  // The seed uses the original plugin key; reconfiguring back keeps its state
  // and restores the original plugin identity for subsequent tab snapshots.
  restored = restored.reconfigure({ plugins: state.plugins });
  if (canRestore) {
    restored = restored.apply(restored.tr
      .setSelection(snapshot!.selection.getBookmark().resolve(restored.doc))
      .setStoredMarks(snapshot!.storedMarks)
      .setMeta("addToHistory", false));
  }
  view.updateState(restored);
}
