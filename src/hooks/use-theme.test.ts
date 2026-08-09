import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./use-theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-boot-theme");
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: undefined,
  });
});

describe("useTheme", () => {
  it("applies the initial theme WITHOUT the transition class (no fade-in from the default palette on load)", () => {
    renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(document.documentElement.classList.contains("theme-transition")).toBe(false);
  });

  it("installs the transition before applying the new palette on the next frame", async () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.switchTheme("night"));
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(document.documentElement.classList.contains("theme-transition")).toBe(true);
    expect(localStorage.getItem("markd-theme")).toBe("night");

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    expect(document.documentElement.dataset.theme).toBe("night");
  });

  it("removes the transition class after the animation window so it never lags later UI", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.switchTheme("night"));
      expect(document.documentElement.classList.contains("theme-transition")).toBe(true);
      act(() => vi.advanceTimersByTime(400));
      expect(document.documentElement.classList.contains("theme-transition")).toBe(true);
      act(() => vi.advanceTimersByTime(300));
      expect(document.documentElement.classList.contains("theme-transition")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses one root snapshot transition instead of animating every descendant when supported", () => {
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() } as ViewTransition;
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    const { result } = renderHook(() => useTheme());
    act(() => result.current.switchTheme("night"));

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe("night");
    expect(document.documentElement.classList.contains("theme-transition")).toBe(false);
  });

  it("applies the palette instantly when reduced motion is requested", () => {
    const priorMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
    const startViewTransition = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true }) as MediaQueryList),
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.switchTheme("night"));

      expect(document.documentElement.dataset.theme).toBe("night");
      expect(startViewTransition).not.toHaveBeenCalled();
      expect(document.documentElement.classList.contains("theme-transition")).toBe(false);
    } finally {
      if (priorMatchMedia) Object.defineProperty(window, "matchMedia", priorMatchMedia);
      else Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("cross-fades from the dark boot theme to a day user's theme", async () => {
    // index.html boots dark so startup never flashes white, and records where
    // useTheme should land. A day user therefore arrives mid-journey: applying
    // instantly would be exactly the white snap the dark boot exists to avoid.
    localStorage.setItem("markd-theme", "day");
    const html = document.documentElement;
    html.dataset.theme = "night";
    html.dataset.bootTheme = "day";

    const { result } = renderHook(() => useTheme());
    expect(result.current.activeTheme).toBe("day");

    // The hand-off waits a frame so the dark paint is committed first.
    expect(html.dataset.theme).toBe("night");
    expect(html.dataset.bootTheme).toBeUndefined();

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    expect(html.dataset.theme).toBe("day");
    expect(html.classList.contains("theme-transition")).toBe(true);
  });

  it("does not animate when the document already booted on the user's theme", () => {
    localStorage.setItem("markd-theme", "night");
    const html = document.documentElement;
    html.dataset.theme = "night";
    html.dataset.bootTheme = "night";

    renderHook(() => useTheme());

    expect(html.dataset.theme).toBe("night");
    expect(html.classList.contains("theme-transition")).toBe(false);
    expect(html.dataset.bootTheme).toBeUndefined();
  });
});
