import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecentFiles } from "./use-recent-files";

const STORAGE_KEY = "markd-recent-files";

beforeEach(() => localStorage.clear());

describe("useRecentFiles.removeRecentFile", () => {
  it("removes an entry by path and persists the removal", () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => {
      result.current.addRecentFile("a.md", "/p/a.md");
      result.current.addRecentFile("b.md", "/p/b.md");
    });
    expect(result.current.recentFiles.map((f) => f.path)).toEqual(["/p/b.md", "/p/a.md"]);

    act(() => result.current.removeRecentFile("/p/a.md"));

    expect(result.current.recentFiles.map((f) => f.path)).toEqual(["/p/b.md"]);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Array<{ path: string }>;
    expect(persisted.map((f) => f.path)).toEqual(["/p/b.md"]);
  });

  it("no-ops when the path is not in the list", () => {
    const { result } = renderHook(() => useRecentFiles());
    act(() => result.current.addRecentFile("a.md", "/p/a.md"));

    act(() => result.current.removeRecentFile("/p/does-not-exist.md"));

    expect(result.current.recentFiles.map((f) => f.path)).toEqual(["/p/a.md"]);
  });
});
