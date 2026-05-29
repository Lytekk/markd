import { describe, it, expect, vi, afterEach } from "vitest";

// Force the browser branch of openExternal (no Tauri runtime in jsdom).
vi.mock("@/lib/file-system", () => ({ isTauri: () => false }));

import { linkHrefForOpen, openExternal } from "./external-link-open";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("linkHrefForOpen", () => {
  it("returns null without a ctrl/meta modifier (plain click just moves the caret)", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "https://x.test");
    expect(linkHrefForOpen({ ctrlKey: false, metaKey: false, target: a })).toBeNull();
  });

  it("returns the anchor href on a modifier-click, even from a child element", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "https://x.test/p");
    const child = document.createElement("span");
    a.appendChild(child);
    expect(linkHrefForOpen({ ctrlKey: true, metaKey: false, target: a })).toBe("https://x.test/p");
    expect(linkHrefForOpen({ ctrlKey: false, metaKey: true, target: child })).toBe("https://x.test/p");
  });

  it("returns null on a modifier-click that isn't on a link", () => {
    const div = document.createElement("div");
    expect(linkHrefForOpen({ ctrlKey: true, metaKey: false, target: div })).toBeNull();
  });
});

describe("openExternal (browser fallback)", () => {
  it("opens a new noopener tab via window.open when not in Tauri", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    await openExternal("https://x.test");
    expect(open).toHaveBeenCalledWith("https://x.test", "_blank", "noopener");
  });
});
