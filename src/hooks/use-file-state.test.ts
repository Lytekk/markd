import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileState } from "./use-file-state";

const { saveToFileMock, saveFileAsMock } = vi.hoisted(() => ({
  saveToFileMock: vi.fn(),
  saveFileAsMock: vi.fn(),
}));

vi.mock("@/lib/file-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/file-system")>();
  return {
    ...actual,
    saveToFile: saveToFileMock,
    saveFileAs: saveFileAsMock,
  };
});

beforeEach(() => {
  saveToFileMock.mockReset();
  saveFileAsMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

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

describe("useFileState openCount (open-class load signal)", () => {
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

describe("useFileState save ownership", () => {
  it("does not let a completed save mutate a buffer restored while the write was pending", async () => {
    let finishWrite: ((ok: boolean) => void) | undefined;
    saveToFileMock.mockImplementation(
      () => new Promise<boolean>((resolve) => {
        finishWrite = resolve;
      }),
    );
    const { result } = renderHook(() => useFileState());
    let markdown = "A edited";
    act(() => result.current.registerGetMarkdown(() => markdown));
    await act(async () => {
      await result.current.handleOpenByPath("/tmp/a.md", "A saved");
    });
    act(() => result.current.markDirty());

    const pendingSave = result.current.handleSave();
    act(() => {
      result.current.restoreState({
        fileName: "b.md",
        filePath: "/tmp/b.md",
        content: "B edited",
        isDirty: true,
        savedContent: "B saved",
      });
    });
    markdown = "B edited";
    finishWrite?.(true);
    await act(async () => {
      await pendingSave;
    });

    expect(result.current.filePath).toBe("/tmp/b.md");
    expect(result.current.savedContent).toBe("B saved");
    expect(result.current.isDirty).toBe(true);
  });

  it("keeps the buffer dirty when the user edits again during a pending save", async () => {
    let finishWrite: ((ok: boolean) => void) | undefined;
    saveToFileMock.mockImplementation(
      () => new Promise<boolean>((resolve) => {
        finishWrite = resolve;
      }),
    );
    const { result } = renderHook(() => useFileState());
    let markdown = "first edit";
    act(() => result.current.registerGetMarkdown(() => markdown));
    await act(async () => {
      await result.current.handleOpenByPath("/tmp/a.md", "saved");
    });
    act(() => result.current.markDirty());

    const pendingSave = result.current.handleSave();
    markdown = "second edit";
    act(() => result.current.markDirty());
    finishWrite?.(true);
    await act(async () => {
      await pendingSave;
    });

    expect(result.current.savedContent).toBe("saved");
    expect(result.current.isDirty).toBe(true);
  });

  it("queues a newer save behind an older write so disk bytes cannot land out of order", async () => {
    let finishFirst: ((ok: boolean) => void) | undefined;
    let finishSecond: ((ok: boolean) => void) | undefined;
    saveToFileMock
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => {
          finishSecond = resolve;
        }),
      );
    const { result } = renderHook(() => useFileState());
    let markdown = "first edit";
    act(() => result.current.registerGetMarkdown(() => markdown));
    await act(async () => {
      await result.current.handleOpenByPath("/tmp/a.md", "saved");
    });

    act(() => result.current.markDirty());
    const firstSave = result.current.handleSave();
    expect(saveToFileMock).toHaveBeenCalledWith("/tmp/a.md", "first edit");

    markdown = "second edit";
    act(() => result.current.markDirty());
    const secondSave = result.current.handleSave();
    // The second write must not start until the first has settled. Otherwise a
    // slow first write can land after the newer bytes and corrupt the file.
    expect(saveToFileMock).toHaveBeenCalledTimes(1);

    finishFirst?.(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(saveToFileMock).toHaveBeenLastCalledWith("/tmp/a.md", "second edit");

    finishSecond?.(true);
    await act(async () => {
      // The queue skipped this write entirely: a newer one owns the path.
      await expect(firstSave).resolves.toBe("superseded");
      await expect(secondSave).resolves.toBe("written");
    });
    expect(result.current.savedContent).toBe("second edit");
    expect(result.current.isDirty).toBe(false);
  });

  it("restarts the autosave debounce for every subsequent edit", async () => {
    vi.useFakeTimers();
    saveToFileMock.mockResolvedValue(true);
    const { result } = renderHook(() => useFileState());
    let markdown = "first edit";
    act(() => result.current.registerGetMarkdown(() => markdown));
    await act(async () => {
      await result.current.handleOpenByPath("/tmp/a.md", "saved");
    });

    act(() => result.current.markDirty());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    markdown = "second edit";
    act(() => result.current.markDirty());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(saveToFileMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(saveToFileMock).toHaveBeenCalledWith("/tmp/a.md", "second edit");
  });

  it("arms autosave when a dirty named tab becomes the active buffer", async () => {
    vi.useFakeTimers();
    saveToFileMock.mockResolvedValue(true);
    const { result } = renderHook(() => useFileState());
    act(() => result.current.registerGetMarkdown(() => "edited"));
    act(() => {
      result.current.restoreState({
        fileName: "a.md",
        filePath: "/tmp/a.md",
        content: "edited",
        isDirty: true,
        savedContent: "saved",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(saveToFileMock).toHaveBeenCalledWith("/tmp/a.md", "edited");
  });

  it("keeps an autosave retry armed when a manual save fails", async () => {
    vi.useFakeTimers();
    saveToFileMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { result } = renderHook(() => useFileState());
    act(() => result.current.registerGetMarkdown(() => "edited"));
    await act(async () => {
      await result.current.handleOpenByPath("/tmp/a.md", "saved");
    });
    act(() => result.current.markDirty());

    await act(async () => {
      await expect(result.current.handleSave()).resolves.toBe("failed");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(saveToFileMock).toHaveBeenCalledTimes(2);
    expect(saveToFileMock).toHaveBeenLastCalledWith("/tmp/a.md", "edited");
  });

  it("retries a failed autosave while the same buffer revision remains dirty", async () => {
    vi.useFakeTimers();
    saveToFileMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { result } = renderHook(() => useFileState());
    act(() => result.current.registerGetMarkdown(() => "edited"));
    await act(async () => {
      await result.current.handleOpenByPath("/tmp/a.md", "saved");
    });
    act(() => result.current.markDirty());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(saveToFileMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(saveToFileMock).toHaveBeenCalledTimes(2);
    expect(result.current.isDirty).toBe(false);
  });
});
