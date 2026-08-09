import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Editor } from "./Editor";
import { getExtensions } from "@/lib/editor-extensions";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

  it("publishes stats immediately for programmatic document loads", () => {
    vi.useFakeTimers();
    const editor = makeEditor();
    const onStats = vi.fn();
    window.addEventListener("markd:stats", onStats);
    render(<Editor editor={editor} focusMode={false} />);
    onStats.mockClear();

    act(() => {
      editor.commands.setContent("<p>new document</p><p>right now</p>", false);
    });

    expect(onStats).toHaveBeenCalledTimes(1);
    expect((onStats.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      words: 4,
      chars: 22,
    });
    window.removeEventListener("markd:stats", onStats);
    editor.destroy();
  });
});
