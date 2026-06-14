import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RecentFilesList } from "./Sidebar";
import type { RecentFile } from "@/hooks/use-recent-files";

afterEach(cleanup);

const files: RecentFile[] = [
  { name: "a.md", path: "/p/a.md", timestamp: 2 },
  { name: "b.md", path: "/p/b.md", timestamp: 1 },
];

describe("RecentFilesList", () => {
  it("opens a file when its row is clicked", () => {
    const onSelect = vi.fn();
    render(<RecentFilesList files={files} onSelect={onSelect} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByText("a.md"));
    expect(onSelect).toHaveBeenCalledWith(files[0]);
  });

  it("removes an entry via its × button without opening it (click does not bubble to the row)", () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    render(<RecentFilesList files={files} onSelect={onSelect} onRemove={onRemove} />);
    const removeButtons = screen.getAllByRole("button", { name: /remove from recent/i });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]!);
    expect(onRemove).toHaveBeenCalledWith("/p/a.md");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks entries whose file no longer exists on disk", () => {
    const { container } = render(
      <RecentFilesList
        files={files}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        missing={new Set(["/p/b.md"])}
      />,
    );
    const items = container.querySelectorAll(".markd-file-item");
    expect(items[0]!.classList.contains("markd-recent-missing")).toBe(false);
    expect(items[1]!.classList.contains("markd-recent-missing")).toBe(true);
  });
});
