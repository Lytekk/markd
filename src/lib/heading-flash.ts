// A transient "you navigated here" flash for the heading an outline-sidebar
// click jumps to.
//
// IMPORTANT: this is a ProseMirror node DECORATION, not a direct DOM class.
// Mutating the heading element's classList directly does NOT work — PM's
// MutationObserver treats the foreign attribute change as stray DOM and reverts
// it on the next redraw (which the post-click selection/focus change triggers
// ~1 frame later), detaching the element we styled. A decoration is rendered BY
// ProseMirror, so it survives that re-render. Same lesson as focus-mode.ts.
//
// The CSS animation (@keyframes markd-heading-flash) lives in
// src/styles/outline-flash.css; this extension only attaches the class via the
// decoration and removes it after the animation so it doesn't linger.

import { Extension } from "@tiptap/core";
import { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const FLASH_CLASS = "markd-heading-flash";

// Must outlast the CSS animation (0.9s in outline-flash.css) so the fade
// completes before the decoration (and class) is removed.
const FLASH_MS = 1000;

interface FlashState {
  pos: number | null;
  nonce: number;
}

const flashKey = new PluginKey<FlashState>("headingFlash");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    headingFlash: {
      /** Flash the node starting at `pos` (a heading) to signal navigation. */
      flashHeadingAt: (pos: number) => ReturnType;
    };
  }
}

/**
 * One node decoration carrying the flash class over the node at `pos`. Pure
 * (mirrors focus-mode's buildFocusDecorations) so the mapping from
 * (doc, pos) → decoration is unit-testable without a live view. Returns null
 * when nothing is flashing (`pos === null`) or `pos` no longer addresses a node.
 */
export function buildFlashDecorations(doc: PmNode, pos: number | null): DecorationSet | null {
  if (pos === null) return null;
  // Bounds-guard: doc.nodeAt throws (not returns null) for an out-of-range pos,
  // which a stale mapped pos can become after an edit deletes the heading.
  if (pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  if (!node) return null;
  return DecorationSet.create(doc, [
    Decoration.node(pos, pos + node.nodeSize, { class: FLASH_CLASS }),
  ]);
}

export const HeadingFlash = Extension.create({
  name: "headingFlash",

  addCommands() {
    return {
      flashHeadingAt:
        (pos: number) =>
        ({ editor, state, dispatch }) => {
          if (!dispatch) return true;
          const nonce = (flashKey.getState(state)?.nonce ?? 0) + 1;
          dispatch(state.tr.setMeta(flashKey, { pos, nonce }));
          // Clear the decoration after the animation. The nonce guard means a
          // newer flash (e.g. clicking a different heading) is never cleared
          // early by an older heading's still-pending timeout.
          const { view } = editor;
          window.setTimeout(() => {
            if (view.isDestroyed) return;
            if (flashKey.getState(view.state)?.nonce === nonce) {
              view.dispatch(view.state.tr.setMeta(flashKey, { pos: null, nonce }));
            }
          }, FLASH_MS);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FlashState>({
        key: flashKey,
        state: {
          init: () => ({ pos: null, nonce: 0 }),
          apply(tr, value) {
            const meta = tr.getMeta(flashKey) as FlashState | undefined;
            if (meta) return meta;
            if (value.pos === null) return value;
            // Keep the flash anchored to its node across doc edits.
            return { pos: tr.mapping.map(value.pos), nonce: value.nonce };
          },
        },
        props: {
          decorations(state) {
            const fs = flashKey.getState(state);
            return buildFlashDecorations(state.doc, fs?.pos ?? null);
          },
        },
      }),
    ];
  },
});
