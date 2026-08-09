import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceEditor } from "./SourceEditor";

const metrics = vi.hoisted(() => ({
  measureLineHeights: vi.fn(() => [27, 27, 216]),
}));

vi.mock("@/lib/textarea-metrics", () => ({
  lineStartOffsets: (text: string) => {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "\n") starts.push(i + 1);
    }
    return starts;
  },
  measureLineHeights: metrics.measureLineHeights,
}));

let resizeCallback: ResizeObserverCallback;

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe() {}
  disconnect() {}
  unobserve() {}
}

function notifyWidth(target: Element, width: number) {
  resizeCallback(
    [
      {
        target,
        contentRect: { width } as DOMRectReadOnly,
      } as ResizeObserverEntry,
    ],
    {} as ResizeObserver,
  );
}

describe("SourceEditor line-number gutter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    metrics.measureLineHeights.mockClear();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    Object.defineProperty(HTMLTextAreaElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 1000,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("applies the measured height to a wrapped final logical line", () => {
    const { container } = render(
      <SourceEditor
        markdown={"first\nsecond\nwrapped final line"}
        onMarkdownChange={() => {}}
        lineNumbers
        zoom={100}
      />,
    );

    act(() => vi.advanceTimersByTime(80));

    const rows = container.querySelectorAll<HTMLElement>(".markd-line-number");
    expect(rows).toHaveLength(3);
    expect(rows[2]!.style.height).toBe("216px");
  });

  it("remeasures once after content-box width changes settle at a stable clientWidth", () => {
    const { container } = render(
      <SourceEditor
        markdown={"one\ntwo\nthree"}
        onMarkdownChange={() => {}}
        lineNumbers
        zoom={100}
      />,
    );
    act(() => vi.advanceTimersByTime(80));
    metrics.measureLineHeights.mockClear();

    const textarea = container.querySelector("textarea")!;
    act(() => {
      notifyWidth(textarea, 800);
      notifyWidth(textarea, 700);
      notifyWidth(textarea, 700);
      vi.advanceTimersByTime(79);
    });
    expect(metrics.measureLineHeights).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(metrics.measureLineHeights).toHaveBeenCalledTimes(1);

    metrics.measureLineHeights.mockClear();
    act(() => {
      notifyWidth(textarea, 700);
      vi.advanceTimersByTime(80);
    });
    expect(metrics.measureLineHeights).not.toHaveBeenCalled();
  });
});
