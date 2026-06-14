import { describe, it, expect, vi, afterEach } from "vitest";

// Force the browser branch (no Tauri runtime in jsdom).
vi.mock("@/lib/file-system", () => ({ isTauri: () => false }));

import { revealInFileManager } from "./reveal";

afterEach(() => vi.restoreAllMocks());

describe("revealInFileManager (browser fallback)", () => {
  it("is a no-op (does not throw) when not running in Tauri", async () => {
    await expect(revealInFileManager("/p/notes.md")).resolves.toBeUndefined();
  });
});
