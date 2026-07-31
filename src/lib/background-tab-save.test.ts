import { describe, expect, it, vi } from "vitest";
import { saveBackgroundTab } from "./background-tab-save";
import { queueFileWrite } from "./file-write-queue";

const dirtyNamedTab = {
  id: "named",
  fileName: "named.md",
  filePath: "/tmp/named.md",
  content: "edited",
  savedContent: "saved",
};

describe("saveBackgroundTab", () => {
  it("refuses to report success when a named background write fails", async () => {
    const saveToFile = vi.fn().mockResolvedValue(false);
    const saveFileAs = vi.fn();

    await expect(saveBackgroundTab(dirtyNamedTab, { saveToFile, saveFileAs })).resolves.toBeNull();
    expect(saveToFile).toHaveBeenCalledWith("/tmp/named.md", "edited");
    expect(saveFileAs).not.toHaveBeenCalled();
  });

  it("routes an untitled background buffer through Save As and returns its new identity", async () => {
    const saveToFile = vi.fn();
    const saveFileAs = vi.fn().mockResolvedValue({ status: "saved", path: "/tmp/untitled.md", name: "untitled.md" });
    const tab = { ...dirtyNamedTab, id: "untitled", fileName: "Untitled", filePath: null };

    await expect(saveBackgroundTab(tab, { saveToFile, saveFileAs })).resolves.toEqual({
      filePath: "/tmp/untitled.md",
      fileName: "untitled.md",
      savedContent: "edited",
    });
    expect(saveFileAs).toHaveBeenCalledWith("edited", "Untitled");
    expect(saveToFile).not.toHaveBeenCalled();
  });

  it("skips a queued named write when its tab revision becomes stale before it starts", async () => {
    let releaseLeadingWrite: (() => void) | undefined;
    const leadingWrite = queueFileWrite(
      "/tmp/named.md",
      () => new Promise<void>((resolve) => {
        releaseLeadingWrite = resolve;
      }),
    );
    let isCurrent = true;
    const saveToFile = vi.fn().mockResolvedValue(true);
    const saveFileAs = vi.fn();
    const pending = saveBackgroundTab(dirtyNamedTab, { saveToFile, saveFileAs }, () => isCurrent);

    isCurrent = false;
    releaseLeadingWrite?.();
    await leadingWrite;

    await expect(pending).resolves.toBeNull();
    expect(saveToFile).not.toHaveBeenCalled();
  });
});
