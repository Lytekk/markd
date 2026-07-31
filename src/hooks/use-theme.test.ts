import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./use-theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-boot-theme");
});

describe("useTheme", () => {
  it("applies the initial theme WITHOUT the transition class (no fade-in from the default palette on load)", () => {
    renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(document.documentElement.classList.contains("theme-transition")).toBe(false);
  });

  it("adds the theme-transition class on switch so day/night cross-fades instead of snapping", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.switchTheme("night"));
    expect(document.documentElement.dataset.theme).toBe("night");
    expect(document.documentElement.classList.contains("theme-transition")).toBe(true);
    expect(localStorage.getItem("markd-theme")).toBe("night");
  });

  it("removes the transition class after the animation window so it never lags later UI", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useTheme());
      act(() => result.current.switchTheme("night"));
      expect(document.documentElement.classList.contains("theme-transition")).toBe(true);
      act(() => vi.advanceTimersByTime(500));
      expect(document.documentElement.classList.contains("theme-transition")).toBe(false);
    } finally {
      vi.useRealTimers();
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
