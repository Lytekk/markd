import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Regression guard for Tauri capability/ACL drift — the silent-failure class that
// kept the auto-updater dead for 21 days (missing `updater:default`). A missing
// permission does not fail the build; the JS command just throws at runtime and is
// swallowed by a catch, so the feature is silently dead. These static assertions
// fail loudly in CI instead.
//
// Native filesystem commands enforce Tauri's runtime fs scope themselves. The
// renderer must not receive direct fs-plugin permissions that could bypass the
// hardened atomic write and no-clobber operations.
const caps = JSON.parse(
  readFileSync("src-tauri/capabilities/default.json", "utf8"),
) as { permissions: string[] };
const perms = caps.permissions;

describe("Tauri capabilities (src-tauri/capabilities/default.json)", () => {
  it("does not grant direct fs-plugin commands to the renderer", () => {
    expect(perms.some((permission) => permission.startsWith("fs:"))).toBe(false);
  });

  it("grants core:event:allow-listen — single-instance + file-change listeners need it", () => {
    expect(perms).toContain("core:event:allow-listen");
  });

  it("grants updater:default — the auto-updater check() needs it", () => {
    expect(perms).toContain("updater:default");
  });

  it("grants only native file pickers, never native ask/message/confirm popups", () => {
    expect(perms.filter((permission) => permission.startsWith("dialog:"))).toEqual([
      "dialog:allow-open",
      "dialog:allow-save",
    ]);
  });

  it("grants opener:allow-reveal-item-in-dir — the tab/file-tree 'Reveal in File Explorer' action needs it", () => {
    expect(perms).toContain("opener:allow-reveal-item-in-dir");
  });

  it("grants core:window:allow-destroy — the quit guard needs it to finish closing", () => {
    // core:window:default deliberately omits destroy. The quit guard calls
    // preventDefault() first, so without this permission destroy() throws and
    // the window can never close at all.
    expect(perms).toContain("core:window:allow-destroy");
  });
});
