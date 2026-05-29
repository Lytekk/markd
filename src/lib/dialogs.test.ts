import { describe, it, expect, vi } from "vitest";
import { askDialog, messageDialog } from "./dialogs";

// In jsdom there is no Tauri bridge, so the helpers exercise the browser
// fallback path (the path the dev server uses).
describe("dialog helpers (browser fallback)", () => {
  it("askDialog falls back to window.confirm and returns its result", async () => {
    const spy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await expect(askDialog("Proceed?")).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith("Proceed?");
    spy.mockRestore();
  });

  it("messageDialog falls back to window.alert", async () => {
    const spy = vi.spyOn(window, "alert").mockImplementation(() => {});
    await messageDialog("Hello");
    expect(spy).toHaveBeenCalledWith("Hello");
    spy.mockRestore();
  });
});
