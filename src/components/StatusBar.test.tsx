import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { StatusBar } from "./StatusBar";

afterEach(cleanup);

const noop = vi.fn();

function renderBar(over: Partial<ComponentProps<typeof StatusBar>> = {}) {
  const props: ComponentProps<typeof StatusBar> = {
    fileName: "notes.md",
    filePath: "/p/notes.md",
    isDirty: false,
    theme: "day",
    lastSaved: null,
    sourceMode: false,
    focusMode: false,
    fullWidth: false,
    lineNumbers: false,
    statsBaseline: null,
    onThemeChange: noop,
    onExportHtml: noop,
    onExportPdf: noop,
    onToggleSource: noop,
    onToggleFocusMode: noop,
    onToggleFullWidth: noop,
    onToggleLineNumbers: noop,
    zoom: 100,
    ...over,
  };
  return render(<StatusBar {...props} />);
}

const sendStats = (words: number, chars: number) =>
  act(() => {
    window.dispatchEvent(
      new CustomEvent("markd:stats", { detail: { words, chars } }),
    );
  });

describe("StatusBar width toggle", () => {
  it("labels the button with the CURRENT state — Full when full-width is on", () => {
    renderBar({ fullWidth: true });
    const btn = screen.getByTitle("Toggle Full Width");
    expect(btn.textContent).toBe("Full");
    expect(btn.classList.contains("status-btn-active")).toBe(true);
  });

  it("labels the button Column when column (constrained) width is active", () => {
    renderBar({ fullWidth: false });
    const btn = screen.getByTitle("Toggle Full Width");
    expect(btn.textContent).toBe("Column");
    expect(btn.classList.contains("status-btn-active")).toBe(false);
  });
});

describe("StatusBar source toggle", () => {
  it("keeps a constant Source label and highlights it while source mode is on", () => {
    renderBar({ sourceMode: true });
    const btn = screen.getByTitle("Toggle Source (Ctrl+/)");
    expect(btn.textContent).toBe("Source");
    expect(btn.classList.contains("status-btn-active")).toBe(true);
  });

  it("does not highlight the Source button in rendered mode", () => {
    renderBar({ sourceMode: false });
    const btn = screen.getByTitle("Toggle Source (Ctrl+/)");
    expect(btn.textContent).toBe("Source");
    expect(btn.classList.contains("status-btn-active")).toBe(false);
  });
});

describe("StatusBar source line numbers", () => {
  it("does not offer misleading block counters in rendered mode", () => {
    renderBar({ sourceMode: false, lineNumbers: true });
    expect(screen.queryByTitle(/Line Numbers/)).toBeNull();
  });

  it("shows and toggles exact logical line numbers in source mode", () => {
    const onToggleLineNumbers = vi.fn();
    renderBar({ sourceMode: true, lineNumbers: true, onToggleLineNumbers });
    const button = screen.getByTitle("Toggle Source Line Numbers");
    expect(button.textContent).toBe("Lines");
    fireEvent.click(button);
    expect(onToggleLineNumbers).toHaveBeenCalledTimes(1);
  });
});

describe("StatusBar filename", () => {
  it("shows the display name and carries the full path as a tooltip", () => {
    const { container } = renderBar({ fileName: "docs/index.md", filePath: "/p/docs/index.md" });
    const el = container.querySelector(".markd-status-filename")!;
    expect(el.textContent).toContain("docs/index.md");
    expect(el.getAttribute("title")).toBe("/p/docs/index.md");
  });

  it("renders a styled dirty bullet element when dirty (not a bare text suffix)", () => {
    const { container } = renderBar({ isDirty: true });
    expect(container.querySelector(".markd-dirty-bullet")).not.toBeNull();
  });

  it("renders no dirty bullet when clean", () => {
    const { container } = renderBar({ isDirty: false });
    expect(container.querySelector(".markd-dirty-bullet")).toBeNull();
  });
});

describe("StatusBar word/char deltas", () => {
  it("shows green (+) and red (-) deltas against the saved baseline while dirty", () => {
    const { container } = renderBar({
      statsBaseline: { words: 10, chars: 50 },
      isDirty: true,
    });
    sendStats(12, 48);
    const deltas = container.querySelectorAll(".markd-stat-delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0]!.textContent).toBe("+2");
    expect(deltas[0]!.classList.contains("plus")).toBe(true);
    expect(deltas[0]!.classList.contains("faded")).toBe(false);
    expect(deltas[1]!.textContent).toBe("-2");
    expect(deltas[1]!.classList.contains("minus")).toBe(true);
  });

  it("clears the deltas once the file is saved", () => {
    const { container } = renderBar({
      statsBaseline: { words: 10, chars: 50 },
      isDirty: false,
    });
    sendStats(12, 48);
    expect(container.querySelectorAll(".markd-stat-delta")).toHaveLength(0);
  });

  it("hides a zero delta (reverted to the saved state) per-stat", () => {
    const { container } = renderBar({
      statsBaseline: { words: 10, chars: 50 },
      isDirty: false,
    });
    sendStats(10, 50);
    expect(container.querySelectorAll(".markd-stat-delta")).toHaveLength(0);
  });

  it("shows no deltas without a baseline", () => {
    const { container } = renderBar({ statsBaseline: null, isDirty: true });
    sendStats(12, 48);
    expect(container.querySelectorAll(".markd-stat-delta")).toHaveLength(0);
  });

  it("shows deltas identically in source mode", () => {
    const { container } = renderBar({
      statsBaseline: { words: 10, chars: 50 },
      sourceMode: true,
      isDirty: true,
    });
    sendStats(12, 48);
    const deltas = container.querySelectorAll(".markd-stat-delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0]!.textContent).toBe("+2");
    expect(deltas[1]!.textContent).toBe("-2");
  });

  it("still shows the plain counts from the stats event", () => {
    renderBar();
    sendStats(7, 33);
    expect(screen.getByText(/7 words/)).toBeTruthy();
    expect(screen.getByText(/33 chars/)).toBeTruthy();
  });
});

// HTML/PDF EXPORT are one-shot actions, not on/off toggles. Sitting flush in the
// toggle row they read as toggles (the reported confusion). They carry their own
// `markd-status-action` class (bordered button look), never the toggle's
// `status-btn-active` highlight, and a `markd-status-divider` fences them off.
describe("StatusBar export actions look distinct from toggles", () => {
  it("styles HTML/PDF as action buttons and never applies the toggle-active highlight", () => {
    // Turn every toggle ON — proves the export buttons still never light up.
    renderBar({ sourceMode: true, fullWidth: true, focusMode: true, lineNumbers: true });
    const html = screen.getByTitle("Export as HTML");
    const pdf = screen.getByTitle("Export as PDF");
    expect(html.classList.contains("markd-status-action")).toBe(true);
    expect(pdf.classList.contains("markd-status-action")).toBe(true);
    expect(html.classList.contains("status-btn-active")).toBe(false);
    expect(pdf.classList.contains("status-btn-active")).toBe(false);
  });

  it("fences the export actions off from the toggle group with a divider", () => {
    const { container } = renderBar();
    expect(container.querySelector(".markd-status-divider")).not.toBeNull();
  });

  it("still fires the export handlers on click", () => {
    const onExportHtml = vi.fn();
    const onExportPdf = vi.fn();
    renderBar({ onExportHtml, onExportPdf });
    fireEvent.click(screen.getByTitle("Export as HTML"));
    fireEvent.click(screen.getByTitle("Export as PDF"));
    expect(onExportHtml).toHaveBeenCalledTimes(1);
    expect(onExportPdf).toHaveBeenCalledTimes(1);
  });
});
