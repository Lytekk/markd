import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import type { Command } from "@/lib/command-palette";

function makeCommands(): { commands: Command[]; runs: Record<string, ReturnType<typeof vi.fn>> } {
  const runs = {
    new: vi.fn(),
    open: vi.fn(),
    save: vi.fn(),
  };
  const commands: Command[] = [
    { id: "new", label: "New File", run: runs.new },
    { id: "open", label: "Open File", run: runs.open },
    { id: "save", label: "Save", run: runs.save },
  ];
  return { commands, runs };
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { commands } = makeCommands();
    const { container } = render(
      <CommandPalette open={false} commands={commands} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("lists every command when opened with an empty query", () => {
    const { commands } = makeCommands();
    render(<CommandPalette open commands={commands} onClose={vi.fn()} />);
    expect(screen.getByText("New File")).toBeTruthy();
    expect(screen.getByText("Open File")).toBeTruthy();
    expect(screen.getByText("Save")).toBeTruthy();
  });

  it("filters the list as the user types", () => {
    const { commands } = makeCommands();
    render(<CommandPalette open commands={commands} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "open" } });
    expect(screen.queryByText("Open File")).toBeTruthy();
    expect(screen.queryByText("New File")).toBeNull();
  });

  it("runs the highlighted command and closes on Enter (ArrowDown moves the highlight)", () => {
    const { commands, runs } = makeCommands();
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // highlight #2 (Open File)
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runs.open).toHaveBeenCalledTimes(1);
    expect(runs.new).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs a command and closes when its row is clicked", () => {
    const { commands, runs } = makeCommands();
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByText("Save"));
    expect(runs.save).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape without running anything", () => {
    const { commands, runs } = makeCommands();
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runs.new).not.toHaveBeenCalled();
  });

  it("shows an empty-state message when nothing matches", () => {
    const { commands } = makeCommands();
    render(<CommandPalette open commands={commands} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzzz" } });
    expect(screen.getByText(/no matching commands/i)).toBeTruthy();
  });

  it("uses a custom renderItem for row content when provided", () => {
    const { commands } = makeCommands();
    render(
      <CommandPalette
        open
        commands={commands}
        onClose={vi.fn()}
        renderItem={(c) => <span>★ {c.label}</span>}
      />,
    );
    expect(screen.getByText("★ New File")).toBeTruthy();
  });

  it("still runs the command on click when a custom renderItem is used", () => {
    const { commands, runs } = makeCommands();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        commands={commands}
        onClose={onClose}
        renderItem={(c) => <span>{c.label}</span>}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Save"));
    expect(runs.save).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("defaults the input placeholder but accepts an override", () => {
    const { commands } = makeCommands();
    const { rerender } = render(<CommandPalette open commands={commands} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("Type a command…")).toBeTruthy();
    rerender(<CommandPalette open commands={commands} onClose={vi.fn()} placeholder="Search tabs…" />);
    expect(screen.getByPlaceholderText("Search tabs…")).toBeTruthy();
  });
});
