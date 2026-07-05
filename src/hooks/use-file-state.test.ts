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

describe("useFileState restoreState → setContent forwarding", () => {
  it("forwards content, docJSON and the snapshot's isDirty (source-mode entry-dirty seed)", () => {
    const { result } = renderHook(() => useFileState());
    const calls: Array<[string, string, unknown, boolean | undefined]> = [];
    act(() =>
      result.current.registerSetContent((md, fileDir, docJSON, isDirty) => {
        calls.push([md, fileDir, docJSON, isDirty]);
      }),
    );
    const docJSON = { type: "doc", content: [] };
    act(() =>
      result.current.restoreState({
        fileName: "b.md",
        filePath: "/tmp/dir/b.md",
        content: "edited",
        isDirty: true,
        savedContent: "saved",
        docJSON,
      }),
    );
    expect(calls).toHaveLength(1);
    const [md, dir, json, isDirty] = calls[0]!;
    expect(md).toBe("edited");
    expect(dir).toBe("/tmp/dir");
    expect(json).toBe(docJSON);
    // A dirty tab arriving in source mode must seed entryWasDirty=true —
    // otherwise reverting the textarea to the arrival snapshot would falsely
    // clear dirty on a buffer that still differs from disk (close-guard bypass).
    expect(isDirty).toBe(true);
  });
});
