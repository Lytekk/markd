import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/file-system", () => ({
  pathExists: vi.fn(),
}));

import { Sidebar, RecentFilesList } from "./Sidebar";
import { pathExists } from "@/lib/file-system";
import type { RecentFile } from "@/hooks/use-recent-files";

afterEach(() => {
  cleanup();
  vi.mocked(pathExists).mockReset();
});

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

  it("keeps other recent-file existence checks when one path is unauthorized", async () => {
    vi.mocked(pathExists).mockImplementation((path) => {
      if (path === "/p/a.md") return Promise.resolve(false);
      return Promise.reject(new Error("MARKD_PATH_NOT_AUTHORIZED"));
    });

    const { container } = render(
      <Sidebar
        tree={[]}
        activeFile=""
        activeFilePath={null}
        collapsed={false}
        editor={null}
        recentFiles={files}
        activeTab="files"
        onTabChange={vi.fn()}
        heldModifier={null}
        onFileSelect={vi.fn()}
        onOpenFolder={vi.fn()}
        onToggle={vi.fn()}
        onRecentFileSelect={vi.fn()}
        onRecentFileRemove={vi.fn()}
      />,
    );

    await waitFor(() => {
      const items = container.querySelectorAll(".markd-file-item");
      expect(items[0]!.classList.contains("markd-recent-missing")).toBe(true);
      expect(items[1]!.classList.contains("markd-recent-missing")).toBe(false);
    });
  });
});
