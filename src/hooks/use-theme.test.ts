import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./use-theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
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
});
