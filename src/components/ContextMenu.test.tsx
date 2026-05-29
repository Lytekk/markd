import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { ContextMenu } from "./ContextMenu";

const fakeEditor = {} as unknown as Editor;

describe("ContextMenu", () => {
  it("opens on right-click inside the editor area and shows Insert Image", () => {
    // The menu only opens for contextmenu events targeted inside .markd-editor-scroll.
    const scroll = document.createElement("div");
    scroll.className = "markd-editor-scroll";
    document.body.appendChild(scroll);
    try {
      render(<ContextMenu editor={fakeEditor} />);
      fireEvent.contextMenu(scroll);
      expect(screen.getByText("Insert Image")).toBeTruthy();
    } finally {
      document.body.removeChild(scroll);
    }
  });

  it("does not open for right-clicks outside the editor area", () => {
    render(<ContextMenu editor={fakeEditor} />);
    fireEvent.contextMenu(document.body);
    expect(screen.queryByText("Insert Image")).toBeNull();
  });
});
