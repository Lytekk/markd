// Focus mode: dim every top-level block except the one(s) the selection touches.
//
// The previous implementation set inline opacity on block DOM, which failed
// because ProseMirror discards inline styles when it re-renders a node on the
// next transaction. This rewrite uses Decoration.node, which attaches a CSS
// class to the node's DOM and is RE-APPLIED by PM on every render — the exact
// durability the inline approach lacked. The decoration set is a pure function
// of (doc, selection), recomputed by props.decorations(state) each update, so
// there is no plugin state to keep in sync (mirrors the prosemirror-view
// idiom). Enable/disable lives in extension storage; toggling dispatches an
// empty transaction to force a decoration recompute. Markdown round-trip is
// unaffected: decorations are view-only and never enter the document tree.

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Node as PmNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Whether a top-level block spanning [blockFrom, blockTo) is "active" (kept
 * crisp) for the selection [from, to]. A bare caret (from === to) uses
 * half-open containment with start-wins, so a caret on a block boundary belongs
 * to the block that STARTS there — never lighting two blocks at once. A range
 * selection uses interval overlap so every touched block stays active.
 */
export function isBlockActive(
  blockFrom: number,
  blockTo: number,
  from: number,
  to: number,
): boolean {
  if (from === to) return from >= blockFrom && from < blockTo;
  return blockFrom < to && blockTo > from;
}

/** One node decoration per top-level block: focus-active or focus-dimmed. */
export function buildFocusDecorations(doc: PmNode, from: number, to: number): DecorationSet {
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    const blockTo = offset + node.nodeSize;
    decorations.push(
      Decoration.node(offset, blockTo, {
        class: isBlockActive(offset, blockTo, from, to) ? "focus-active" : "focus-dimmed",
      }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Arbitrate the focused position between scroll and caret across one
 * transaction. A scroll update (metaScrollPos) always wins; otherwise a user
 * selection change reverts focus to the caret (null); otherwise the previous
 * scroll position is preserved. Pure so the scroll-vs-caret rule is testable.
 */
export function nextScrollPos(
  prev: number | null,
  opts: { selectionSet: boolean; metaScrollPos: number | null | undefined },
): number | null {
  if (typeof opts.metaScrollPos === "number") return opts.metaScrollPos;
  if (opts.selectionSet) return null;
  return prev;
}

const focusModeKey = new PluginKey<{ scrollPos: number | null }>("focusMode");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    focusMode: {
      setFocusMode: (enabled: boolean) => ReturnType;
      toggleFocusMode: () => ReturnType;
      setFocusScrollPos: (pos: number | null) => ReturnType;
    };
  }
}

export const FocusMode = Extension.create({
  name: "focusMode",

  addStorage() {
    return { enabled: false };
  },

  addCommands() {
    const storage = this.storage;
    // Empty transaction → view update → props.decorations recomputes against
    // the new storage.enabled. No doc change, so dirty-tracking ignores it.
    const refresh = (editor: Editor) => {
      editor.view.dispatch(editor.state.tr);
    };
    return {
      setFocusMode:
        (enabled: boolean) =>
        ({ editor }) => {
          storage.enabled = enabled;
          refresh(editor);
          return true;
        },
      toggleFocusMode:
        () =>
        ({ editor }) => {
          storage.enabled = !storage.enabled;
          refresh(editor);
          return true;
        },
      // Driven by the editor's scroll listener: focus the block centered in the
      // viewport. Stored in plugin state so a later caret move can clear it.
      setFocusScrollPos:
        (pos: number | null) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(focusModeKey, { scrollPos: pos }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<{ scrollPos: number | null }>({
        key: focusModeKey,
        state: {
          init: () => ({ scrollPos: null }),
          apply(tr, prev) {
            const meta = tr.getMeta(focusModeKey) as { scrollPos?: number | null } | undefined;
            return {
              scrollPos: nextScrollPos(prev.scrollPos, {
                selectionSet: tr.selectionSet,
                metaScrollPos: meta?.scrollPos,
              }),
            };
          },
        },
        props: {
          decorations: (state) => {
            if (!storage.enabled) return null;
            // Scroll position (reading focus) overrides the caret when set; a
            // caret move clears it via nextScrollPos so editing re-focuses.
            const scrollPos = focusModeKey.getState(state)?.scrollPos ?? null;
            if (scrollPos != null) return buildFocusDecorations(state.doc, scrollPos, scrollPos);
            const { from, to } = state.selection;
            return buildFocusDecorations(state.doc, from, to);
          },
        },
      }),
    ];
  },
});
