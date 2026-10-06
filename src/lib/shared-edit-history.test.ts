import { afterEach, beforeEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "./editor-extensions";
import { createEditHistory, recordRenderedEdit, recordSourceEdit, travelEditHistory, attachRenderedState } from "./edit-history";
let editor: Editor;
beforeEach(() => { editor = new Editor({ extensions: [...getExtensions({ getFileDir: () => "" }), Markdown], content: "alpha" }); });
afterEach(() => editor.destroy());
it("keeps one chronological history across rendered and source edits", () => {
  const history = createEditHistory("alpha");
  attachRenderedState(history.current, editor.state);
  editor.commands.setTextSelection(6);
  editor.commands.insertContent(" beta");
  recordRenderedEdit(history, editor, "");
  expect(history.current.text).toBe("alpha beta");
  recordSourceEdit(history, "**alpha beta**", 2, 12);
  expect(travelEditHistory(history, false)?.text).toBe("alpha beta");
  expect(travelEditHistory(history, false)?.text).toBe("alpha");
  expect(travelEditHistory(history, true)?.text).toBe("alpha beta");
  expect(travelEditHistory(history, true)?.text).toBe("**alpha beta**");
});
it("does not create an undo step or normalize raw bytes for a mode switch", () => {
  const history = createEditHistory("alpha");
  recordSourceEdit(history, "__alpha__", 2, 7);
  editor.commands.setContent("__alpha__", false);
  attachRenderedState(history.current, editor.state);
  expect(history.current.text).toBe("__alpha__");
  expect(history.past).toHaveLength(1);
  expect(travelEditHistory(history, false)?.text).toBe("alpha");
});

it("groups adjacent rendered typing without merging a formatting operation", () => {
  const history = createEditHistory("alpha");
  editor.commands.setTextSelection(6);
  attachRenderedState(history.current, editor.state);
  for (const char of ["x", "y", "z"]) {
    const transaction = editor.state.tr.insertText(char);
    editor.view.dispatch(transaction);
    recordRenderedEdit(history, editor, "", transaction);
  }
  editor.commands.selectAll();
  editor.commands.toggleBold();
  recordRenderedEdit(history, editor, "");
  expect(travelEditHistory(history, false)?.text).toBe("alphaxyz");
  expect(travelEditHistory(history, false)?.text).toBe("alpha");
});
