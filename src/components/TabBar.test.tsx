import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TabBar } from "./TabBar";
import type { FileTab } from "@/hooks/use-file-tabs";

afterEach(cleanup);

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

const tabEl = (name: string) => screen.getAllByText(name)[0]!.closest(".markd-tab")!;

describe("TabBar right-click context menu", () => {
  const twoTabs = [
    tab({ id: "t1", fileName: "notes.md", filePath: "/home/u/notes.md" }),
    tab({ id: "t2", fileName: "other.md", filePath: "/home/u/other.md" }),
  ];

  it("opens a context menu with path actions on right-click", () => {
    render(<TabBar tabs={twoTabs} activeTabId="t1" onSwitchTab={noop} onCloseTab={noop} onNewTab={noop} onTabAction={noop} />);
    fireEvent.contextMenu(tabEl("notes.md"));
    expect(screen.getByText(/Copy Full Path/i)).toBeTruthy();
    expect(screen.getByText(/Copy File Name/i)).toBeTruthy();
    expect(screen.getByText(/Reveal in File Explorer/i)).toBeTruthy();
  });

  it("dispatches copy-path with the right-clicked tab", () => {
    const onTabAction = vi.fn();
    render(<TabBar tabs={twoTabs} activeTabId="t1" onSwitchTab={noop} onCloseTab={noop} onNewTab={noop} onTabAction={onTabAction} />);
    fireEvent.contextMenu(tabEl("other.md"));
    fireEvent.click(screen.getByText(/Copy Full Path/i));
    expect(onTabAction).toHaveBeenCalledWith("copy-path", expect.objectContaining({ id: "t2" }));
  });

  it("dispatches close from the menu (App maps it to the guarded close)", () => {
    const onTabAction = vi.fn();
    render(<TabBar tabs={twoTabs} activeTabId="t1" onSwitchTab={noop} onCloseTab={noop} onNewTab={noop} onTabAction={onTabAction} />);
    fireEvent.contextMenu(tabEl("notes.md"));
    fireEvent.click(screen.getByText(/^Close$/));
    expect(onTabAction).toHaveBeenCalledWith("close", expect.objectContaining({ id: "t1" }));
  });

  it("omits path actions for an untitled (pathless) tab", () => {
    render(
      <TabBar
        tabs={[tab({ id: "u1", fileName: "Untitled", filePath: null, isDirty: true })]}
        activeTabId="u1"
        onSwitchTab={noop}
        onCloseTab={noop}
        onNewTab={noop}
        onTabAction={noop}
      />,
    );
    fireEvent.contextMenu(tabEl("Untitled"));
    expect(screen.queryByText(/Copy Full Path/i)).toBeNull();
    expect(screen.queryByText(/Reveal in File Explorer/i)).toBeNull();
    expect(screen.getByText(/Copy File Name/i)).toBeTruthy();
  });
});
