import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Editor } from "./Editor";
import { getExtensions } from "@/lib/editor-extensions";

afterEach(cleanup);

function makeEditor() {
  return new TiptapEditor({
    extensions: getExtensions({ getFileDir: () => "" }),
    content: "<p>hello</p><p>world</p>",
  });
}

describe("Editor", () => {
  it("renders nothing until the editor exists", () => {
    const { container } = render(
      <Editor editor={null} focusMode={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("adds the focus-mode class and enables the focus-mode extension when on", () => {
    const editor = makeEditor();
    const { container } = render(
      <Editor editor={editor} focusMode={true} />,
    );
    const scroll = container.querySelector(".markd-editor-scroll");
    expect(scroll).not.toBeNull();
    expect(scroll!.classList.contains("focus-mode")).toBe(true);
    expect(editor.storage.focusMode.enabled).toBe(true);
    editor.destroy();
  });

  it("leaves focus mode off when focusMode is false", () => {
    const editor = makeEditor();
    const { container } = render(
      <Editor editor={editor} focusMode={false} />,
    );
    const scroll = container.querySelector(".markd-editor-scroll");
    expect(scroll!.classList.contains("focus-mode")).toBe(false);
    expect(editor.storage.focusMode.enabled).toBe(false);
    editor.destroy();
  });
});
