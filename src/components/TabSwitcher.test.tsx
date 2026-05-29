import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabSwitcher } from "./TabSwitcher";
import type { FileTab } from "@/hooks/use-file-tabs";

const tab = (over: Partial<FileTab> & { id: string }): FileTab => ({
  fileName: "Untitled",
  filePath: null,
  content: "",
  isDirty: false,
  savedContent: "",
  scrollTop: 0,
  ...over,
});

describe("TabSwitcher", () => {
  const tabs = [
    tab({ id: "a", fileName: "index.md", filePath: "/p/docs/index.md" }),
    tab({ id: "b", fileName: "index.md", filePath: "/p/blog/index.md", isDirty: true }),
    tab({ id: "c", fileName: "notes.md", filePath: "/p/notes.md" }),
  ];
  // MRU most-recent-first: current = "a", previous = "b".
  const getMru = () => ["a", "b", "c"];

  it("renders nothing when closed", () => {
    const { container } = render(
      <TabSwitcher open={false} tabs={tabs} getMru={getMru} onSwitch={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector(".markd-command-palette")).toBeNull();
  });

  it("lists open tabs with a disambiguating parent dir for same-named files", () => {
    render(<TabSwitcher open tabs={tabs} getMru={getMru} onSwitch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByText("index.md").length).toBe(2);
    expect(screen.getByText("docs")).toBeTruthy();
    expect(screen.getByText("blog")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
  });

  it("pre-selects the previous tab so a bare Enter toggles to it (Alt-Tab semantics)", () => {
    const onSwitch = vi.fn();
    const onClose = vi.fn();
    render(<TabSwitcher open tabs={tabs} getMru={getMru} onSwitch={onSwitch} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onSwitch).toHaveBeenCalledWith("b");
    expect(onClose).toHaveBeenCalled();
  });

  it("switches to a clicked tab", () => {
    const onSwitch = vi.fn();
    render(<TabSwitcher open tabs={tabs} getMru={getMru} onSwitch={onSwitch} onClose={vi.fn()} />);
    fireEvent.mouseDown(screen.getByText("notes.md"));
    expect(onSwitch).toHaveBeenCalledWith("c");
  });

  it("marks dirty tabs with a dirty dot", () => {
    const { container } = render(
      <TabSwitcher open tabs={tabs} getMru={getMru} onSwitch={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector(".markd-tab-switcher-dot.dirty")).toBeTruthy();
  });

  it("filters by filename and by parent dir (kept in the search haystack)", () => {
    render(<TabSwitcher open tabs={tabs} getMru={getMru} onSwitch={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "blog" } });
    // only the /p/blog/index.md tab matches (parentDir is in keywords)
    expect(screen.getByText("blog")).toBeTruthy();
    expect(screen.queryByText("notes.md")).toBeNull();
  });
});
