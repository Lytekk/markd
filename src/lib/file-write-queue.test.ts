import { describe, expect, it, vi } from "vitest";
import { queueFileWrite } from "./file-write-queue";

describe("queueFileWrite", () => {
  it("starts a later write for the same path only after the prior one settles", async () => {
    let finishFirst: (() => void) | undefined;
    const firstWrite = vi.fn(
      () => new Promise<void>((resolve) => {
        finishFirst = resolve;
      }),
    );
    const secondWrite = vi.fn().mockResolvedValue(undefined);

    const first = queueFileWrite("/tmp/a.md", firstWrite);
    const second = queueFileWrite("/tmp/a.md", secondWrite);
    await Promise.resolve();
    expect(firstWrite).toHaveBeenCalledTimes(1);
    expect(secondWrite).not.toHaveBeenCalled();

    finishFirst?.();
    await first;
    await second;
    expect(secondWrite).toHaveBeenCalledTimes(1);
  });
});
