import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Editor as TiptapEditor } from "@tiptap/core";
import { getExtensions } from "@/lib/editor-extensions";
import { FindReplace, type FindUiState } from "./FindReplace";
import { editorSearchBackend } from "@/lib/search-backend";

let editor: TiptapEditor;

// jsdom has no layout engine: ProseMirror's coordsAtPos (used by the
// scroll-to-match path that a non-empty search term triggers) needs
// Range.getClientRects, and the fallback path needs scrollIntoView.
const zeroRect = {
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  toJSON: () => ({}),
} as DOMRect;
Range.prototype.getClientRects = () => [zeroRect] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => zeroRect;
Element.prototype.scrollIntoView = () => {};

beforeEach(() => {
  editor = new TiptapEditor({
    extensions: getExtensions({ getFileDir: () => "" }),
    content: "<p>foo bar foo</p>",
  });
});
afterEach(() => {
  cleanup();
  editor.destroy();
});

const savedState: FindUiState = {
  searchTerm: "foo",
  replaceTerm: "qux",
  caseSensitive: true,
  useRegex: false,
  wholeWord: false,
};

describe("FindReplace per-tab state recall", () => {
  it("prefills find and replace inputs from initialState", () => {
    render(
      <FindReplace
        backend={editorSearchBackend(editor)}
        showReplace={true}
        onClose={() => {}}
        initialState={savedState}
      />,
    );
    expect((screen.getByPlaceholderText("Find...") as HTMLInputElement).value).toBe("foo");
    expect((screen.getByPlaceholderText("Replace...") as HTMLInputElement).value).toBe("qux");
  });

  it("restores option toggles from initialState", () => {
    render(
      <FindReplace
        backend={editorSearchBackend(editor)}
        showReplace={false}
        onClose={() => {}}
        initialState={{ ...savedState, useRegex: true, wholeWord: true }}
      />,
    );
    expect(screen.getByTitle("Case Sensitive").classList.contains("active")).toBe(true);
    expect(screen.getByTitle("Regular Expression").classList.contains("active")).toBe(true);
    expect(screen.getByTitle(/Whole Word/).classList.contains("active")).toBe(true);
  });

  it("applies the initial search term to the editor on mount (decorations live)", () => {
    render(
      <FindReplace
        backend={editorSearchBackend(editor)}
        showReplace={false}
        onClose={() => {}}
        initialState={savedState}
      />,
    );
    expect(editor.storage.searchAndReplace.searchTerm).toBe("foo");
  });

  it("reports every state change through onStateChange", () => {
    const onStateChange = vi.fn();
    render(
      <FindReplace
        backend={editorSearchBackend(editor)}
        showReplace={false}
        onClose={() => {}}
        initialState={savedState}
        onStateChange={onStateChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Find..."), {
      target: { value: "bar" },
    });
    const calls = onStateChange.mock.calls;
    const last = calls[calls.length - 1]![0] as FindUiState;
    expect(last.searchTerm).toBe("bar");
    expect(last.caseSensitive).toBe(true); // untouched options survive
  });

  it("starts empty when no initialState is given (back-compat)", () => {
    render(<FindReplace backend={editorSearchBackend(editor)} showReplace={false} onClose={() => {}} />);
    expect((screen.getByPlaceholderText("Find...") as HTMLInputElement).value).toBe("");
  });
});
