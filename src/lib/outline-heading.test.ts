import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { OutlineHeading, OUTLINE_HEADING_CLASS } from "./outline-heading";

let editor: Editor;
beforeEach(() => {
  editor = new Editor({ extensions: [StarterKit, OutlineHeading], content: "<h1>One</h1><p>body</p><h2>Two</h2>" });
});
afterEach(() => editor.destroy());
const highlighted = () => editor.view.dom.querySelector(`.${OUTLINE_HEADING_CLASS}`)?.textContent;

it("does not change document content, selection, dirty events or undo history", () => {
  const json = editor.getJSON();
  const selection = editor.state.selection;
  const onUpdate = vi.fn();
  editor.on("update", onUpdate);
  editor.commands.setOutlineHeading(0);
  expect(highlighted()).toBe("One");
  expect(editor.getJSON()).toEqual(json);
  expect(editor.getHTML()).not.toContain(OUTLINE_HEADING_CLASS);
  expect(editor.state.selection.eq(selection)).toBe(true);
  expect(onUpdate).not.toHaveBeenCalled();
  expect(editor.commands.undo()).toBe(false);
});

it("follows edits before the heading and clears when it is deleted", () => {
  const second = editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize;
  editor.commands.setOutlineHeading(second);
  editor.view.dispatch(editor.state.tr.insertText("extra ", 1));
  expect(highlighted()).toBe("Two");
  const moved = editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize;
  editor.view.dispatch(editor.state.tr.delete(moved, editor.state.doc.content.size));
  expect(highlighted()).toBeUndefined();
});

it("clears on a document load and refuses non-heading or stale positions", () => {
  editor.commands.setOutlineHeading(0);
  editor.commands.setContent("<h1>Other tab</h1>", false);
  expect(highlighted()).toBeUndefined();
  editor.commands.setOutlineHeading(9999);
  expect(highlighted()).toBeUndefined();
  editor.commands.setContent("<p>Plain text</p>", false);
  editor.commands.setOutlineHeading(0);
  expect(highlighted()).toBeUndefined();
});
