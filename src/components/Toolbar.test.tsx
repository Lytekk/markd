import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Toolbar } from "./Toolbar";
import type { Editor } from "@tiptap/react";

// Source-mode gate: the toolbar's actions drive the ProseMirror doc, which in
// source mode is hidden and stale (the textarea owns the buffer). A click
// there is a phantom mutation the user cannot see — the buttons must be
// visibly and functionally inert while disabled, and untouched otherwise.

function mockEditor(): Editor {
  return {
    isActive: vi.fn(() => false),
    chain: vi.fn(),
    commands: {},
  } as unknown as Editor;
}

describe("Toolbar disabled (source mode)", () => {
  it("disables every button and dispatches no actions while disabled", () => {
    const editor = mockEditor();
    const { container } = render(
      <Toolbar editor={editor} heldModifier={null} disabled />,
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.disabled).toBe(true);
    fireEvent.click(buttons[0]!);
    expect(editor.chain).not.toHaveBeenCalled();
    // Active-state highlight must not render off the stale doc either.
    expect(editor.isActive).not.toHaveBeenCalled();
  });

  it("stays fully enabled when the prop is omitted (rendered mode unchanged)", () => {
    const { container } = render(
      <Toolbar editor={mockEditor()} heldModifier={null} />,
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.disabled).toBe(false);
  });
});
