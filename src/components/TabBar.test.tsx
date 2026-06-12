import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TabBar } from "./TabBar";
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

const noop = vi.fn();

describe("TabBar", () => {
  it("shows a parent-dir prefix only to disambiguate same-named files", () => {
    const tabs = [
      tab({ id: "a", fileName: "index.md", filePath: "/p/docs/index.md" }),
      tab({ id: "b", fileName: "index.md", filePath: "/p/blog/index.md" }),
      tab({ id: "c", fileName: "notes.md", filePath: "/p/notes.md" }),
    ];
    render(<TabBar tabs={tabs} activeTabId="a" onSwitchTab={noop} onCloseTab={noop} onNewTab={noop} />);
    expect(screen.getByText("docs/")).toBeTruthy();
    expect(screen.getByText("blog/")).toBeTruthy();
    // the unique-named tab gets no dir prefix
    expect(screen.queryByText("notes/")).toBeNull();
  });

  it("renders a prominent dirty dot for unsaved tabs (close button stays for hover-swap)", () => {
    const tabs = [tab({ id: "a", fileName: "x.md", filePath: "/p/x.md", isDirty: true })];
    const { container } = render(
      <TabBar tabs={tabs} activeTabId="a" onSwitchTab={noop} onCloseTab={noop} onNewTab={noop} />,
    );
    const tabEl = container.querySelector(".markd-tab")!;
    expect(tabEl.classList.contains("dirty")).toBe(true);
    expect(container.querySelector(".markd-tab-dirty-dot")).not.toBeNull();
    expect(container.querySelector(".markd-tab-close")).not.toBeNull();
    // the old low-visibility text-bullet suffix is gone
    expect(screen.queryByText(/x\.md •/)).toBeNull();
  });

  it("renders no dirty dot for clean tabs", () => {
    const tabs = [tab({ id: "a", fileName: "x.md", filePath: "/p/x.md", isDirty: false })];
    const { container } = render(
      <TabBar tabs={tabs} activeTabId="a" onSwitchTab={noop} onCloseTab={noop} onNewTab={noop} />,
    );
    expect(container.querySelector(".markd-tab")!.classList.contains("dirty")).toBe(false);
    expect(container.querySelector(".markd-tab-dirty-dot")).toBeNull();
  });
});
