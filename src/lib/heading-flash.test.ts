import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { HeadingFlash, FLASH_CLASS, buildFlashDecorations, flashKey } from "./heading-flash";

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

    it("clears the flash after the animation window via the nonce-guarded timeout", () => {
      editor = makeEditor();
      vi.useFakeTimers();
      try {
        const h2 = headingPos(editor, 2);
        editor.commands.flashHeadingAt(h2);
        expect(editor.view.dom.querySelector("h2")?.classList.contains(FLASH_CLASS)).toBe(true);
        vi.advanceTimersByTime(1100);
        expect(editor.view.dom.querySelector("h2")?.classList.contains(FLASH_CLASS)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
