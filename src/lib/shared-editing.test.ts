import { Editor } from "@tiptap/core";
import { afterEach, expect, it, vi } from "vitest";
import { getExtensions } from "./editor-extensions";
let editor: Editor;
afterEach(() => editor?.destroy());
it("routes commands and native history input to the shared owner, with no competing native history", () => {
  const travel = vi.fn((_redo: boolean) => true);
  editor = new Editor({ extensions: getExtensions({ getFileDir: () => "", editingBridge: { travel, isSource: () => false } }) });
  expect(editor.extensionManager.extensions.some(e => e.name === "history")).toBe(false);
  editor.commands.undo();
  expect(travel.mock.calls[0]?.[0]).toBe(false);
  editor.commands.redo();
  expect(travel.mock.calls[1]?.[0]).toBe(true);
  const event = new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(travel).toHaveBeenCalledTimes(3);
});
it("requests caret reveal for formatting and typing but not content loads", () => {
  editor = new Editor({ extensions: getExtensions({ getFileDir: () => "", editingBridge: { travel: () => false, isSource: () => false } }) });
  let state = editor.state;
  const load = state.applyTransaction(state.tr.insertText("alpha").setMeta("preventUpdate", true));
  expect(load.transactions.some(t => t.scrolledIntoView)).toBe(false);
  state = load.state;
  const bold = state.applyTransaction(state.tr.addMark(1, 4, state.schema.marks.bold!.create()));
  expect(bold.transactions.some(t => t.scrolledIntoView)).toBe(true);
  const stored = bold.state.applyTransaction(bold.state.tr.setStoredMarks([state.schema.marks.italic!.create()]));
  expect(stored.transactions.some(t => t.scrolledIntoView)).toBe(true);
});
