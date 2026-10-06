import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useFileTabs } from "@/hooks/use-file-tabs";
import { useFileState } from "@/hooks/use-file-state";
import { loadEditorContent } from "./editor-load";
import { createEditHistory, recordSourceEdit, travelEditHistory } from "./edit-history";

afterEach(() => { cleanup(); localStorage.clear(); });

it("carries rendered history through tab snapshots and file-state restore; disk hydration invalidates it", () => {
  const editor = new Editor({ extensions: [StarterKit] });
  const { result } = renderHook(() => ({ tabs: useFileTabs(), file: useFileState() }));
  try {
    result.current.tabs.registerGetMarkdown(() => editor.getText());
    result.current.tabs.registerGetJSON(() => editor.getJSON());
    result.current.tabs.registerGetEditorState(() => editor.state);
    result.current.file.registerSetContent((md, _dir, json, _dirty, state) => {
      loadEditorContent(editor, json ?? md, state);
    });
    loadEditorContent(editor, "alpha");
    editor.commands.insertContent("edit A");
    const aId = result.current.tabs.activeTabId;
    act(() => { result.current.tabs.newTab(); });
    loadEditorContent(editor, "beta");
    editor.commands.insertContent("edit B");
    const bId = result.current.tabs.activeTabId;
    act(() => {
      const tab = result.current.tabs.switchTab(aId)!;
      result.current.file.restoreState(tab);
    });
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("alpha");
    act(() => {
      const tab = result.current.tabs.switchTab(bId)!;
      result.current.file.restoreState(tab);
    });
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("beta");
    act(() => { result.current.tabs.hydrateTab(aId, "disk revision"); });
    act(() => {
      const tab = result.current.tabs.switchTab(aId)!;
      expect(tab.editorState).toBeUndefined();
      result.current.file.restoreState(tab);
    });
    expect(editor.commands.undo()).toBe(false);
    expect(editor.getText()).toBe("disk revision");
  } finally { editor.destroy(); }
});

it("carries source history through snapshots and restore without persisting it to disk", () => {
  const { result } = renderHook(() => ({ tabs: useFileTabs(), file: useFileState() }));
  let history = createEditHistory("alpha");
  result.current.tabs.registerGetMarkdown(() => history.current.text);
  result.current.tabs.registerGetEditHistory(() => history);
  result.current.file.registerSetContent((md, _dir, _json, _dirty, _state, savedHistory) => {
    history = savedHistory ?? createEditHistory(md);
  });
  const aId = result.current.tabs.activeTabId;
  recordSourceEdit(history, "alpha edit");
  act(() => { result.current.tabs.newTab(); });
  history = createEditHistory("beta");
  recordSourceEdit(history, "beta edit");
  act(() => {
    result.current.file.restoreState(result.current.tabs.switchTab(aId)!);
  });
  expect(travelEditHistory(history, false)?.text).toBe("alpha");
  expect(travelEditHistory(history, false)).toBeUndefined();
  expect(travelEditHistory(history, true)?.text).toBe("alpha edit");
  act(() => { result.current.tabs.hydrateTab(aId, "reloaded"); });
  expect(result.current.tabs.activeTab.editHistory).toBeUndefined();
});
