import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { ContextMenu, promptAndInsertImage } from "./ContextMenu";
import { promptModal } from "@/lib/modal";

vi.mock("@/lib/modal", () => ({ promptModal: vi.fn() }));

function makeEditor(inTable: boolean): Editor {
  return { isActive: (name: string) => inTable && name === "table" } as unknown as Editor;
}

function openMenuInEditorArea() {
  const scroll = document.createElement("div");
  scroll.className = "markd-editor-scroll";
  document.body.appendChild(scroll);
  fireEvent.contextMenu(scroll);
  return () => document.body.removeChild(scroll);
}

describe("ContextMenu", () => {
  it("opens on right-click inside the editor area and shows Insert Image", () => {
    render(<ContextMenu editor={makeEditor(false)} />);
    const cleanup = openMenuInEditorArea();
    try {
      expect(screen.getByText("Insert Image")).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it("hides table-editing items when the cursor is not in a table", () => {
    render(<ContextMenu editor={makeEditor(false)} />);
    const cleanup = openMenuInEditorArea();
    try {
      expect(screen.queryByText("Delete Table")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("shows table-editing items when the cursor is in a table", () => {
    render(<ContextMenu editor={makeEditor(true)} />);
    const cleanup = openMenuInEditorArea();
    try {
      expect(screen.getByText("Delete Table")).toBeTruthy();
      expect(screen.getByText("Add Row Above")).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it("does not open for right-clicks outside the editor area", () => {
    render(<ContextMenu editor={makeEditor(false)} />);
    fireEvent.contextMenu(document.body);
    expect(screen.queryByText("Insert Image")).toBeNull();
  });

  it("does not insert a deferred image into a replacement tab document", async () => {
    let resolve!: (value: string | null) => void;
    vi.mocked(promptModal).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const originalDoc = {};
    const state = { doc: originalDoc, selection: { from: 7, to: 7 } };
    const setImage = vi.fn();
    const editor = {
      state,
      isDestroyed: false,
      chain: () => ({
        focus: () => ({
          setTextSelection: () => ({ setImage: () => ({ run: setImage }) }),
        }),
      }),
    } as unknown as Editor;

    const pending = promptAndInsertImage(editor);
    const request = vi.mocked(promptModal).mock.calls[0]![0];
    expect(request.isCurrent?.()).toBe(true);
    state.doc = {};
    expect(request.isCurrent?.()).toBe(false);
    resolve("https://example.com/image.png");
    await pending;

    expect(setImage).not.toHaveBeenCalled();
  });
});
