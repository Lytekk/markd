import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileState } from "./use-file-state";

describe("useFileState dirty lifecycle", () => {
  it("markDirty sets isDirty and markClean clears it", () => {
    const { result } = renderHook(() => useFileState());
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.markDirty());
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.markClean());
    expect(result.current.isDirty).toBe(false);
  });

  it("markClean on an already-clean state stays clean", () => {
    const { result } = renderHook(() => useFileState());
    act(() => result.current.markClean());
    expect(result.current.isDirty).toBe(false);
  });
});

describe("useFileState openCount (baseline-reset signal)", () => {
  it("bumps on open-class loads but NOT on tab-switch restores", async () => {
    const { result } = renderHook(() => useFileState());
    expect(result.current.openCount).toBe(0);

    act(() => result.current.handleNew());
    expect(result.current.openCount).toBe(1);

    await act(async () => {
      await result.current.handleOpenByPath("/tmp/a.md", "# A\n");
    });
    expect(result.current.openCount).toBe(2);

    act(() =>
      result.current.restoreState({
        fileName: "b.md",
        filePath: "/tmp/b.md",
        content: "edited",
        isDirty: true,
        savedContent: "saved",
      }),
    );
    expect(result.current.openCount).toBe(2);
  });
});
