import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { StatusBar } from "./StatusBar";

afterEach(cleanup);

const noop = vi.fn();

function barProps(
  over: Partial<ComponentProps<typeof StatusBar>> = {},
): ComponentProps<typeof StatusBar> {
  return {
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
}

function renderBar(over: Partial<ComponentProps<typeof StatusBar>> = {}) {
  return render(<StatusBar {...barProps(over)} />);
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
  it("keeps one Lines slot mounted while making it unavailable in rendered mode", () => {
    const onToggleLineNumbers = vi.fn();
    const { rerender } = renderBar({
      sourceMode: false,
      lineNumbers: true,
      onToggleLineNumbers,
    });
    const button = screen.getByRole("button", { name: /Lines/ }) as HTMLButtonElement;
    expect(button.textContent).toBe("Lines");
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onToggleLineNumbers).not.toHaveBeenCalled();

    rerender(
      <StatusBar
        {...barProps({ sourceMode: true, lineNumbers: true, onToggleLineNumbers })}
      />,
    );
    const enabled = screen.getByRole("button", { name: /Lines/ }) as HTMLButtonElement;
    expect(enabled).toBe(button);
    expect(enabled.disabled).toBe(false);
    expect(enabled.getAttribute("aria-pressed")).toBe("true");
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

describe("StatusBar fixed slot topology", () => {
  const slots = (container: HTMLElement, side: "left" | "right") =>
    Array.from(container.querySelector(`.markd-status-${side}`)!.children).map(
      (node) => (node as HTMLElement).dataset.statusSlot,
    );

  it("keeps every footer slot mounted and ordered across all state changes", () => {
    const initial = barProps();
    const { container, rerender } = render(<StatusBar {...initial} />);
    const leftBefore = Array.from(container.querySelector(".markd-status-left")!.children);
    const rightBefore = Array.from(container.querySelector(".markd-status-right")!.children);

    expect(slots(container, "left")).toEqual(["filename", "saved"]);
    expect(slots(container, "right")).toEqual([
      "words",
      "chars",
      "focus",
      "source",
      "width",
      "lines",
      "divider",
      "html",
      "pdf",
      "theme",
      "zoom",
      "version",
    ]);

    rerender(
      <StatusBar
        {...barProps({
          fileName: "a-very-different-name.md",
          isDirty: true,
          lastSaved: 123,
          sourceMode: true,
          focusMode: true,
          fullWidth: true,
          lineNumbers: true,
          statsBaseline: { words: 1, chars: 2 },
          theme: "night",
          zoom: 200,
        })}
      />,
    );
    sendStats(123456, 987654);

    expect(slots(container, "left")).toEqual(["filename", "saved"]);
    expect(slots(container, "right")).toEqual([
      "words",
      "chars",
      "focus",
      "source",
      "width",
      "lines",
      "divider",
      "html",
      "pdf",
      "theme",
      "zoom",
      "version",
    ]);
    const leftAfter = Array.from(container.querySelector(".markd-status-left")!.children);
    const rightAfter = Array.from(container.querySelector(".markd-status-right")!.children);
    expect(leftAfter.every((node, index) => node === leftBefore[index])).toBe(true);
    expect(rightAfter.every((node, index) => node === rightBefore[index])).toBe(true);
    expect(container.querySelectorAll(".markd-stat-delta")).toHaveLength(2);
    expect(container.querySelectorAll(".markd-dirty-bullet")).toHaveLength(1);
  });

  it("fully reveals a focused control inside the narrow-window rail", () => {
    const { container } = renderBar();
    const rail = container.querySelector(".markd-status-right") as HTMLDivElement;
    const theme = screen.getByTitle("Toggle Theme");
    Object.defineProperty(rail, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(theme, "offsetLeft", { configurable: true, value: 150 });
    Object.defineProperty(theme, "offsetWidth", { configurable: true, value: 30 });

    rail.scrollLeft = 0;
    fireEvent.focus(theme);
    expect(rail.scrollLeft).toBe(81);

    Object.defineProperty(theme, "offsetLeft", { configurable: true, value: 20 });
    rail.scrollLeft = 80;
    fireEvent.focus(theme);
    expect(rail.scrollLeft).toBe(19);

    Object.defineProperty(theme, "offsetLeft", { configurable: true, value: 60 });
    rail.scrollLeft = 50;
    fireEvent.focus(theme);
    expect(rail.scrollLeft).toBe(50);
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
    const bullet = container.querySelector(".markd-dirty-bullet")!;
    expect(bullet).not.toBeNull();
    expect(bullet.classList.contains("is-slot-empty")).toBe(true);
    expect(bullet.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("StatusBar word/char deltas", () => {
  it("shows green (+) and red (-) deltas against the saved baseline while dirty", () => {
    const { container } = renderBar({
      statsBaseline: { words: 10, chars: 50 },
      isDirty: true,
    });
    sendStats(12, 48);
    const deltas = container.querySelectorAll(".markd-stat-delta:not(.is-slot-empty)");
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
    expect(container.querySelectorAll(".markd-stat-delta")).toHaveLength(2);
    expect(container.querySelectorAll(".markd-stat-delta:not(.is-slot-empty)")).toHaveLength(0);
  });

  it("hides a zero delta (reverted to the saved state) per-stat", () => {
    const { container } = renderBar({
      statsBaseline: { words: 10, chars: 50 },
      isDirty: false,
    });
    sendStats(10, 50);
    expect(container.querySelectorAll(".markd-stat-delta")).toHaveLength(2);
    expect(container.querySelectorAll(".markd-stat-delta:not(.is-slot-empty)")).toHaveLength(0);
  });

  it("shows no deltas without a baseline", () => {
    const { container } = renderBar({ statsBaseline: null, isDirty: true });
    sendStats(12, 48);
    expect(container.querySelectorAll(".markd-stat-delta")).toHaveLength(2);
    expect(container.querySelectorAll(".markd-stat-delta:not(.is-slot-empty)")).toHaveLength(0);
  });

  it("shows deltas identically in source mode", () => {
    const { container } = renderBar({
      statsBaseline: { words: 10, chars: 50 },
      sourceMode: true,
      isDirty: true,
    });
    sendStats(12, 48);
    const deltas = container.querySelectorAll(".markd-stat-delta:not(.is-slot-empty)");
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
