import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Menubar } from "./Menubar";

function renderMenubar(overrides: Record<string, unknown> = {}) {
  const props = {
    editor: null,
    sidebarCollapsed: false,
    sourceMode: false,
    focusMode: false,
    fullWidth: true,
    activeTheme: "day",
    themes: [{ id: "day", name: "Day" }] as const,
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onOpenFolder: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onExportHtml: vi.fn(),
    onExportPdf: vi.fn(),
    onFind: vi.fn(),
    onReplace: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleSource: vi.fn(),
    onToggleFocusMode: vi.fn(),
    onToggleFullWidth: vi.fn(),
    onThemeSelect: vi.fn(),
    onNewTab: vi.fn(),
    onCloseTab: vi.fn(),
    onNextTab: vi.fn(),
    onPrevTab: vi.fn(),
    onCheckForUpdates: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<Menubar {...(props as any)} />);
  return props;
}

describe("Menubar", () => {
  it("exposes Help > Check for Updates… and invokes the callback", () => {
    const props = renderMenubar();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByText("Check for Updates…"));
    expect(props.onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("renders the standard top-level menus", () => {
    renderMenubar();
    for (const label of ["File", "Edit", "View", "Help"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });
});
