import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SnippetPicker } from "./SnippetPicker";
import type { Snippet } from "@/lib/snippets";

const snippets: Snippet[] = [
  { id: "h1", trigger: "h1", label: "Heading 1", body: "# $1" },
  { id: "link", trigger: "link", label: "Link", body: "[text](https://)" },
  { id: "date", trigger: "date", label: "Today's date", body: "{{date}}" },
];

describe("SnippetPicker", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <SnippetPicker open={false} snippets={snippets} onInsert={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector(".markd-command-palette")).toBeNull();
  });

  it("lists snippet labels with a body preview", () => {
    render(<SnippetPicker open snippets={snippets} onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Heading 1")).toBeTruthy();
    expect(screen.getByText("Link")).toBeTruthy();
    expect(screen.getByText("[text](https://)")).toBeTruthy(); // preview line
  });

  it("inserts the snippet body and closes when a row is picked", () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(<SnippetPicker open snippets={snippets} onInsert={onInsert} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByText("Link"));
    expect(onInsert).toHaveBeenCalledWith("[text](https://)");
    expect(onClose).toHaveBeenCalled();
  });

  it("filters by trigger", () => {
    render(<SnippetPicker open snippets={snippets} onInsert={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "date" } });
    expect(screen.getByText("Today's date")).toBeTruthy();
    expect(screen.queryByText("Heading 1")).toBeNull();
  });

  it("offers a distinct 'New snippet…' action row when onManage is provided", () => {
    const onManage = vi.fn();
    const { container } = render(
      <SnippetPicker open snippets={snippets} onInsert={vi.fn()} onClose={vi.fn()} onManage={onManage} />,
    );
    const row = screen.getByText("➕ New snippet…");
    expect(row).toBeTruthy();
    expect(container.querySelector(".markd-command-action")).toBeTruthy(); // shaded distinctly
    fireEvent.mouseDown(row);
    expect(onManage).toHaveBeenCalled();
  });

  it("omits the action row when onManage is absent", () => {
    render(<SnippetPicker open snippets={snippets} onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("➕ New snippet…")).toBeNull();
  });
});
