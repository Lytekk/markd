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
        activeFilePath={null}
        collapsed={false}
        editor={null}
        recentFiles={files}
        activeTab="files"
        onTabChange={vi.fn()}
        heldModifier={null}
        onFileSelect={vi.fn()}
        onOpenFolder={vi.fn()}
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

  it("does not probe the filesystem for a Recent Files list it is not showing", async () => {
    // These probes are IPC round trips through the full authorization walk, and
    // the effect re-runs whenever recentFiles changes — i.e. on every file open,
    // during the exact window the user is waiting for their document. The list
    // only renders when the sidebar is expanded, on the files tab, with no tree.
    const base = {
      tree: [],
      activeFilePath: null,
      editor: null,
      recentFiles: files,
      heldModifier: null,
      onTabChange: vi.fn(),
      onFileSelect: vi.fn(),
      onOpenFolder: vi.fn(),
      onRecentFileSelect: vi.fn(),
      onRecentFileRemove: vi.fn(),
    };

    const { rerender } = render(<Sidebar {...base} collapsed activeTab="files" />);
    await waitFor(() => expect(pathExists).not.toHaveBeenCalled());

    rerender(<Sidebar {...base} collapsed={false} activeTab="outline" />);
    await waitFor(() => expect(pathExists).not.toHaveBeenCalled());

    // Visible: now it may ask.
    vi.mocked(pathExists).mockResolvedValue(true);
    rerender(<Sidebar {...base} collapsed={false} activeTab="files" />);
    await waitFor(() => expect(pathExists).toHaveBeenCalled());
  });
});

describe("Sidebar collapsed accessibility", () => {
  it("removes its hidden interactive subtree from keyboard and accessibility navigation", () => {
    const { container } = render(
      <Sidebar
        tree={[]}
        activeFilePath={null}
        collapsed
        editor={null}
        recentFiles={files}
        activeTab="files"
        onTabChange={vi.fn()}
        heldModifier={null}
        onFileSelect={vi.fn()}
        onOpenFolder={vi.fn()}
        onRecentFileSelect={vi.fn()}
        onRecentFileRemove={vi.fn()}
      />,
    );

    const sidebar = container.querySelector(".markd-sidebar")!;
    expect(sidebar.getAttribute("inert")).not.toBeNull();
    expect(sidebar.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Sidebar active file identity", () => {
  it("highlights only the exact path when multiple files share a basename", () => {
    const tree = [
      {
        name: "project-a",
        path: "/work/project-a",
        kind: "directory" as const,
        depth: 0,
        children: [
          {
            name: "AGENTS.md",
            path: "/work/project-a/AGENTS.md",
            kind: "file" as const,
            depth: 1,
          },
        ],
      },
      {
        name: "project-b",
        path: "/work/project-b",
        kind: "directory" as const,
        depth: 0,
        children: [
          {
            name: "AGENTS.md",
            path: "/work/project-b/AGENTS.md",
            kind: "file" as const,
            depth: 1,
          },
        ],
      },
    ];

    const { container } = render(
      <Sidebar
        tree={tree}
        activeFilePath="/work/project-b/AGENTS.md"
        collapsed={false}
        editor={null}
        recentFiles={[]}
        activeTab="files"
        onTabChange={vi.fn()}
        heldModifier={null}
        onFileSelect={vi.fn()}
        onOpenFolder={vi.fn()}
        onRecentFileSelect={vi.fn()}
        onRecentFileRemove={vi.fn()}
      />,
    );

    const agentsRows = Array.from(container.querySelectorAll(".markd-file-item"))
      .filter((row) => row.querySelector(".name")?.textContent === "AGENTS.md");
    expect(agentsRows).toHaveLength(2);
    expect(agentsRows[0]!.classList.contains("active")).toBe(false);
    expect(agentsRows[1]!.classList.contains("active")).toBe(true);
  });
});
