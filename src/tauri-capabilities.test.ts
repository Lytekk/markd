import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Regression guard for Tauri capability/ACL drift — the silent-failure class that
// kept the auto-updater dead for 21 days (missing `updater:default`). A missing
// permission does not fail the build; the JS command just throws at runtime and is
// swallowed by a catch, so the feature is silently dead. These static assertions
// fail loudly in CI instead.
//
// Note: the external-file-modification watcher does NOT appear here because it is a
// custom Rust command (notify crate) that bypasses the fs-plugin ACL, like
// read_file/write_file — so it needs no fs capability at all.
const caps = JSON.parse(
  readFileSync("src-tauri/capabilities/default.json", "utf8"),
) as { permissions: string[] };
const perms = caps.permissions;

describe("Tauri capabilities (src-tauri/capabilities/default.json)", () => {
  it("grants the fs-plugin read/write commands the app invokes directly", () => {
    expect(perms).toContain("fs:allow-read-text-file");
    expect(perms).toContain("fs:allow-write-text-file");
  });

  it("grants core:event:allow-listen — single-instance + file-change listeners need it", () => {
    expect(perms).toContain("core:event:allow-listen");
  });

  it("grants updater:default — the auto-updater check() needs it", () => {
    expect(perms).toContain("updater:default");
  });

  it("grants dialog:default — askDialog()/messageDialog() need ask/message", () => {
    expect(perms).toContain("dialog:default");
  });
});
