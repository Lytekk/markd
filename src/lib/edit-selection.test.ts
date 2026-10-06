import { Editor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { afterEach, beforeEach, expect, it } from "vitest";
import { getExtensions } from "./editor-extensions";
import { createEditHistory, attachRenderedState } from "./edit-history";
import { renderedStateForSnapshot, sourceSelectionForSnapshot } from "./edit-selection";
let editor: Editor;
beforeEach(() => { editor = new Editor({ extensions: [...getExtensions({ getFileDir: () => "" }), Markdown], content: "alpha **beta**" }); });
afterEach(() => editor.destroy());
it("maps a rendered selection into source markup without modifying the buffer", () => {
  editor.commands.setTextSelection({ from: 7, to: 11 });
  const snapshot = createEditHistory("alpha **beta**").current;
  attachRenderedState(snapshot, editor.state);
  sourceSelectionForSnapshot(editor, snapshot);
  expect(snapshot.text.slice(snapshot.start, snapshot.end)).toBe("beta");
  expect(snapshot.text).toBe("alpha **beta**");
});
it("maps source selection and frontmatter into the same rendered text", () => {
  const text = "---\ntitle: Test\n---\n\nalpha __beta__";
  const snapshot = { text, start: text.indexOf("beta"), end: text.indexOf("beta") + 4 };
  const state = renderedStateForSnapshot(editor, snapshot);
  expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe("beta");
  expect(state.doc.textContent).toBe("alpha beta");
});
it("restores stored formatting marks together with the rendered selection", () => {
  editor.commands.setTextSelection(2);
  editor.commands.toggleItalic();
  const snapshot = createEditHistory("alpha **beta**").current;
  attachRenderedState(snapshot, editor.state);
  expect(renderedStateForSnapshot(editor, snapshot).storedMarks?.map(m => m.type.name)).toContain("italic");
});
