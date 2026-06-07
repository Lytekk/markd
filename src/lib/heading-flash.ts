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

// Must outlast the CSS animation (1.4s in outline-flash.css — and the 0.8s
// prefers-reduced-motion variant) so the fade completes before the decoration
// (and class) is removed — else the flash is yanked mid-fade and disappears
// too soon.
const FLASH_MS = 1500;

interface FlashState {
  pos: number | null;
  nonce: number;
}

// Exported for white-box tests (inspecting clear→set transaction metas).
export const flashKey = new PluginKey<FlashState>("headingFlash");

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

/** Minimal IntersectionObserverEntry shape this helper reads (real entries satisfy it). */
export interface InViewEntry {
  isIntersecting: boolean;
  intersectionRatio: number;
}

/** Minimal observer surface this helper uses (real IntersectionObserver satisfies it). */
export interface InViewObserver {
  observe(el: Element): void;
  disconnect(): void;
}

export interface FlashWhenInViewOptions {
  /** The heading element an outline click is jumping to. */
  element: HTMLElement;
  /** Scroll root the visibility is measured against (the editor scroll container). */
  root: Element | null;
  /** Fraction of the element that must be visible to count as "in view" (0–1). */
  threshold: number;
  /** Called exactly once, when the element is in view (or via the fallback). */
  onInView: () => void;
  /** Constructs the observer — injectable so tests run without IntersectionObserver. */
  createObserver: (
    callback: (entries: InViewEntry[]) => void,
    options: { root: Element | null; threshold: number },
  ) => InViewObserver;
  /** Schedules a fallback `run` and returns a clear fn — injectable for tests. */
  scheduleFallback: (run: () => void) => () => void;
}

/**
 * Fire `onInView` exactly ONCE, when `element` is at least `threshold` visible
 * within `root`. Used to defer the heading flash until a smooth-scroll has
 * actually landed the heading in the viewport — flashing at click time would
 * burn the ~1.4s pulse off-screen while the scroll is still travelling. A
 * fallback fires anyway if the observer never reports the element in view (e.g.
 * it was detached by a ProseMirror re-render during the scroll). Returns a
 * cancel fn (used to supersede a pending flash when a newer click arrives).
 *
 * Dependency-injected (observer + fallback) so it is unit-testable without a
 * real IntersectionObserver — jsdom provides none. Mirrors the injectable-deps
 * pattern of file-change.ts / focus-mode's pure helpers.
 */
export function flashWhenInView(options: FlashWhenInViewOptions): () => void {
  let done = false;
  let clearFallback = (): void => {};
  let observer: InViewObserver | null = null;

  const finish = () => {
    if (done) return;
    done = true;
    clearFallback();
    observer?.disconnect();
    options.onInView();
  };

  observer = options.createObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= options.threshold)) {
        finish();
      }
    },
    { root: options.root, threshold: options.threshold },
  );
  clearFallback = options.scheduleFallback(finish);
  observer.observe(options.element);

  return () => {
    if (done) return;
    done = true;
    clearFallback();
    observer?.disconnect();
  };
}

export const HeadingFlash = Extension.create({
  name: "headingFlash",

  addCommands() {
    return {
      flashHeadingAt:
        (pos: number) =>
        ({ editor, dispatch }) => {
          if (!dispatch) return true;
          const view = editor.view;
          const nonce = (flashKey.getState(view.state)?.nonce ?? 0) + 1;
          // Restart on EVERY click (incl. re-clicking the same heading): clear
          // the decoration, force a reflow on the heading's DOM, then re-set it.
          // A lone set is a no-op when the class is already present (the browser
          // sees no change and won't replay the animation). PM applies decoration
          // DOM changes synchronously within dispatch, so the reflow between the
          // two dispatches makes the class absence→presence transition real and
          // the CSS animation replays. NOTE: a forced reflow (offsetWidth) is used
          // rather than requestAnimationFrame — rAF is throttled in background
          // tabs / jsdom and is unnecessary given PM's synchronous DOM update.
          view.dispatch(view.state.tr.setMeta(flashKey, { pos: null, nonce }));
          const size = view.state.doc.content.size;
          const dom = pos >= 0 && pos < size ? view.nodeDOM(pos) : null;
          if (dom instanceof HTMLElement) void dom.offsetWidth; // force reflow
          view.dispatch(view.state.tr.setMeta(flashKey, { pos, nonce }));
          // Clear the decoration after the animation. The nonce guard means a
          // newer flash (a different heading, or a repeat click) is never cleared
          // early by an older still-pending timeout.
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
