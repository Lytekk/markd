import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  HeadingFlash,
  FLASH_CLASS,
  buildFlashDecorations,
  flashKey,
  flashWhenInView,
  isInView,
  type InViewEntry,
  type InViewObserver,
} from "./heading-flash";

function makeEditor(): Editor {
  return new Editor({
    extensions: [StarterKit, HeadingFlash],
    content: "<h1>One</h1><p>body</p><h2>Two</h2>",
  });
}

function headingPos(editor: Editor, level: number): number {
  let p = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.attrs.level === level) p = pos;
  });
  return p;
}

describe("HeadingFlash", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("exposes the flash class name (matches outline-flash.css)", () => {
    expect(FLASH_CLASS).toBe("markd-heading-flash");
  });

  describe("buildFlashDecorations (pure)", () => {
    it("returns a node decoration spanning the heading at pos, carrying the flash class", () => {
      editor = makeEditor();
      const h2 = headingPos(editor, 2);
      const set = buildFlashDecorations(editor.state.doc, h2);
      expect(set).not.toBeNull();
      const decos = set!.find();
      expect(decos).toHaveLength(1);
      expect(decos[0]!.from).toBe(h2);
      expect(
        (decos[0]! as unknown as { type: { attrs: Record<string, string> } }).type.attrs.class,
      ).toBe(FLASH_CLASS);
    });

    it("returns null when pos is null (nothing flashing)", () => {
      editor = makeEditor();
      expect(buildFlashDecorations(editor.state.doc, null)).toBeNull();
    });

    it("returns null for an out-of-range pos (no node there)", () => {
      editor = makeEditor();
      expect(buildFlashDecorations(editor.state.doc, 99999)).toBeNull();
    });
  });

  describe("flashHeadingAt command — applies via a PM decoration (survives PM re-render)", () => {
    it("applies the flash class to the target heading's DOM, and not to others", () => {
      editor = makeEditor();
      expect(editor.commands.flashHeadingAt(headingPos(editor, 2))).toBe(true);
      expect(editor.view.dom.querySelector("h2")?.classList.contains(FLASH_CLASS)).toBe(true);
      expect(editor.view.dom.querySelector("h1")?.classList.contains(FLASH_CLASS)).toBe(false);
    });

    it("moves the flash to a different heading, clearing the previous one", () => {
      editor = makeEditor();
      editor.commands.flashHeadingAt(headingPos(editor, 1));
      expect(editor.view.dom.querySelector("h1")?.classList.contains(FLASH_CLASS)).toBe(true);
      editor.commands.flashHeadingAt(headingPos(editor, 2));
      expect(editor.view.dom.querySelector("h1")?.classList.contains(FLASH_CLASS)).toBe(false);
      expect(editor.view.dom.querySelector("h2")?.classList.contains(FLASH_CLASS)).toBe(true);
    });
  });

  describe("flashHeadingAt restart — replays the animation on EVERY click", () => {
    it("dispatches a clear BEFORE the set so the CSS animation restarts even on the same heading", () => {
      // Re-clicking the same heading must replay the flash. A lone set is a no-op
      // when the class is already present (the browser sees no change). The
      // restart mechanism removes the decoration (pos:null) then re-adds it
      // (pos:h2) with a reflow between — verified here as a clear meta dispatched
      // before the set meta. (Empty framework dispatches carry no flashKey meta.)
      editor = makeEditor();
      const h2 = headingPos(editor, 2);
      const spy = vi.spyOn(editor.view, "dispatch");
      editor.commands.flashHeadingAt(h2);
      const metas = spy.mock.calls.map(([tr]) => tr.getMeta(flashKey) as { pos: number | null } | undefined);
      const clearIdx = metas.findIndex((m) => m != null && m.pos === null);
      const setIdx = metas.findIndex((m) => m != null && m.pos === h2);
      expect(clearIdx).toBeGreaterThanOrEqual(0);
      expect(setIdx).toBeGreaterThan(clearIdx);
      expect(editor.view.dom.querySelector("h2")?.classList.contains(FLASH_CLASS)).toBe(true);
      spy.mockRestore();
    });

    it("keeps the flash through the (longer) animation window, then clears via the nonce-guarded timeout", () => {
      editor = makeEditor();
      vi.useFakeTimers();
      try {
        const h2 = headingPos(editor, 2);
        editor.commands.flashHeadingAt(h2);
        expect(editor.view.dom.querySelector("h2")?.classList.contains(FLASH_CLASS)).toBe(true);
        // Must OUTLAST the 1.4s CSS animation (outline-flash.css) so the fade
        // completes before the decoration/class is removed — else the flash is
        // yanked mid-fade and disappears too soon.
        vi.advanceTimersByTime(1300);
        expect(editor.view.dom.querySelector("h2")?.classList.contains(FLASH_CLASS)).toBe(true);
        vi.advanceTimersByTime(300); // total 1600ms, past FLASH_MS
        expect(editor.view.dom.querySelector("h2")?.classList.contains(FLASH_CLASS)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("flashWhenInView — defers the flash until the heading is in view, fires once", () => {
  // A controllable stand-in for IntersectionObserver (jsdom has none). Captures
  // the callback so a test can drive intersection events on demand.
  function makeFakeObserver() {
    let cb: ((entries: InViewEntry[]) => void) | null = null;
    const state = {
      observed: null as Element | null,
      disconnected: false,
      options: null as { root: Element | null; threshold: number | number[] } | null,
    };
    const create = (
      callback: (entries: InViewEntry[]) => void,
      options: { root: Element | null; threshold: number | number[] },
    ): InViewObserver => {
      cb = callback;
      state.options = options;
      return {
        observe: (el: Element) => {
          state.observed = el;
        },
        disconnect: () => {
          state.disconnected = true;
        },
      };
    };
    return {
      create,
      emit: (entries: InViewEntry[]) => cb?.(entries),
      get observed() {
        return state.observed;
      },
      get disconnected() {
        return state.disconnected;
      },
      get options() {
        return state.options;
      },
    };
  }

  // A controllable stand-in for the setTimeout fallback.
  function makeFakeFallback() {
    const state = { run: null as (() => void) | null, cleared: false };
    return {
      schedule: (run: () => void) => {
        state.run = run;
        return () => {
          state.cleared = true;
        };
      },
      fire: () => state.run?.(),
      get cleared() {
        return state.cleared;
      },
    };
  }

  const IN_VIEW: InViewEntry = { isIntersecting: true, intersectionRatio: 0.9 };

  it("observes the element and does NOT flash before it is in view", () => {
    const el = document.createElement("h2");
    const obs = makeFakeObserver();
    const fb = makeFakeFallback();
    const onInView = vi.fn();
    flashWhenInView({
      element: el,
      root: null,
      threshold: 0.6,
      onInView,
      createObserver: obs.create,
      scheduleFallback: fb.schedule,
    });
    expect(obs.observed).toBe(el);
    expect(onInView).not.toHaveBeenCalled();
  });

  it("flashes once the element crosses the visibility threshold", () => {
    const obs = makeFakeObserver();
    const fb = makeFakeFallback();
    const onInView = vi.fn();
    flashWhenInView({
      element: document.createElement("h2"),
      root: null,
      threshold: 0.6,
      onInView,
      createObserver: obs.create,
      scheduleFallback: fb.schedule,
    });
    obs.emit([IN_VIEW]);
    expect(onInView).toHaveBeenCalledTimes(1);
    expect(obs.disconnected).toBe(true);
    expect(fb.cleared).toBe(true);
  });

  it("flashes for a TALL heading via root-coverage even when its own ratio is below threshold", () => {
    const obs = makeFakeObserver();
    const fb = makeFakeFallback();
    const onInView = vi.fn();
    flashWhenInView({
      element: document.createElement("h1"),
      root: null,
      threshold: 0.6,
      onInView,
      createObserver: obs.create,
      scheduleFallback: fb.schedule,
    });
    // ratio 0.3 (< 0.6) — a heading taller than the viewport — but its visible
    // slice fills the root viewport (covers 100% of root).
    obs.emit([{ isIntersecting: true, intersectionRatio: 0.3, intersectionHeight: 480, rootHeight: 480 }]);
    expect(onInView).toHaveBeenCalledTimes(1);
  });

  it("passes a DENSE threshold grid to the observer (max 1% gaps)", () => {
    // IntersectionObserver only fires at ratio crossings. A very tall heading
    // sweeps a tiny ratio range (a 6x-viewport heading maxes at ~0.17), so with
    // coarse thresholds the observer fires once at entry (coverage ~0) and then
    // goes SILENT — the root-coverage predicate never sees the settled state and
    // the flash degrades to the timer fallback (browser-measured: 2015ms).
    // A 1%-step grid keeps callbacks coming for any heading height.
    const obs = makeFakeObserver();
    const fb = makeFakeFallback();
    flashWhenInView({
      element: document.createElement("h1"),
      root: null,
      threshold: 0.6,
      onInView: vi.fn(),
      createObserver: obs.create,
      scheduleFallback: fb.schedule,
    });
    const t = obs.options?.threshold;
    expect(Array.isArray(t)).toBe(true);
    const arr = (t as number[]).slice().sort((a, b) => a - b);
    expect(arr[0]).toBe(0);
    expect(arr[arr.length - 1]).toBe(1);
    const maxGap = Math.max(...arr.slice(1).map((v, i) => v - arr[i]!));
    expect(maxGap).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  it("does NOT flash while the element is only partially visible (below threshold)", () => {
    const obs = makeFakeObserver();
    const fb = makeFakeFallback();
    const onInView = vi.fn();
    flashWhenInView({
      element: document.createElement("h2"),
      root: null,
      threshold: 0.6,
      onInView,
      createObserver: obs.create,
      scheduleFallback: fb.schedule,
    });
    obs.emit([{ isIntersecting: true, intersectionRatio: 0.3 }]);
    obs.emit([{ isIntersecting: false, intersectionRatio: 0 }]);
    expect(onInView).not.toHaveBeenCalled();
  });

  it("flashes exactly once across repeated in-view reports", () => {
    const obs = makeFakeObserver();
    const fb = makeFakeFallback();
    const onInView = vi.fn();
    flashWhenInView({
      element: document.createElement("h2"),
      root: null,
      threshold: 0.6,
      onInView,
      createObserver: obs.create,
      scheduleFallback: fb.schedule,
    });
    obs.emit([IN_VIEW]);
    obs.emit([IN_VIEW]);
    expect(onInView).toHaveBeenCalledTimes(1);
  });

  it("falls back to flashing if the observer never reports the element in view", () => {
    const obs = makeFakeObserver();
    const fb = makeFakeFallback();
    const onInView = vi.fn();
    flashWhenInView({
      element: document.createElement("h2"),
      root: null,
      threshold: 0.6,
      onInView,
      createObserver: obs.create,
      scheduleFallback: fb.schedule,
    });
    fb.fire();
    expect(onInView).toHaveBeenCalledTimes(1);
    expect(obs.disconnected).toBe(true);
  });

  it("does not double-flash when the fallback fires after an in-view flash", () => {
    const obs = makeFakeObserver();
    const fb = makeFakeFallback();
    const onInView = vi.fn();
    flashWhenInView({
      element: document.createElement("h2"),
      root: null,
      threshold: 0.6,
      onInView,
      createObserver: obs.create,
      scheduleFallback: fb.schedule,
    });
    obs.emit([IN_VIEW]);
    fb.fire();
    expect(onInView).toHaveBeenCalledTimes(1);
  });

  it("cancel() stops a pending flash and disconnects", () => {
    const obs = makeFakeObserver();
    const fb = makeFakeFallback();
    const onInView = vi.fn();
    const cancel = flashWhenInView({
      element: document.createElement("h2"),
      root: null,
      threshold: 0.6,
      onInView,
      createObserver: obs.create,
      scheduleFallback: fb.schedule,
    });
    cancel();
    expect(obs.disconnected).toBe(true);
    expect(fb.cleared).toBe(true);
    obs.emit([IN_VIEW]);
    expect(onInView).not.toHaveBeenCalled();
  });
});

describe("isInView — in-view predicate, incl. targets taller than the viewport", () => {
  it("is false when not intersecting", () => {
    expect(isInView({ isIntersecting: false, intersectionRatio: 1 }, 0.6)).toBe(false);
  });

  it("is true when the target's own visible fraction meets the threshold", () => {
    expect(isInView({ isIntersecting: true, intersectionRatio: 0.6 }, 0.6)).toBe(true);
    expect(isInView({ isIntersecting: true, intersectionRatio: 0.9 }, 0.6)).toBe(true);
  });

  it("is false when partially visible and not taller than the root", () => {
    expect(isInView({ isIntersecting: true, intersectionRatio: 0.3 }, 0.6)).toBe(false);
  });

  it("is true for a TALL target whose visible slice covers the threshold of the root", () => {
    // 3x-viewport heading: own ratio maxes ~0.33, but centred it fills the root.
    expect(
      isInView(
        { isIntersecting: true, intersectionRatio: 0.33, intersectionHeight: 480, rootHeight: 480 },
        0.6,
      ),
    ).toBe(true);
  });

  it("is false for a tall target whose visible slice does not yet cover the threshold of the root", () => {
    expect(
      isInView(
        { isIntersecting: true, intersectionRatio: 0.2, intersectionHeight: 200, rootHeight: 480 },
        0.6,
      ),
    ).toBe(false);
  });

  it("falls back to the ratio check when rootHeight is missing or zero", () => {
    expect(
      isInView({ isIntersecting: true, intersectionRatio: 0.3, intersectionHeight: 480, rootHeight: 0 }, 0.6),
    ).toBe(false);
    expect(
      isInView({ isIntersecting: true, intersectionRatio: 0.3, intersectionHeight: 480 }, 0.6),
    ).toBe(false);
  });
});
