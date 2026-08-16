import { describe, it, expect, vi } from "vitest";
import {
  createFileChangePromptCoordinator,
  defaultExternalChangeChoice,
  fileChangeReadRetryDelay,
  fileChangeTargetOwnsActivePath,
  fileChangeTargetIsCurrent,
  resolveExternalChangeChoice,
  shouldKeepDeletedFileOpen,
  shouldPromptForExternalChange,
  shouldPromptForDeletion,
  shouldReloadExternalChange,
} from "./file-change";

describe("fileChangeReadRetryDelay", () => {
  it("backs off transient read failures while capping the fail-closed retry", () => {
    expect(fileChangeReadRetryDelay(0)).toBe(250);
    expect(fileChangeReadRetryDelay(1)).toBe(500);
    expect(fileChangeReadRetryDelay(4)).toBe(4_000);
    expect(fileChangeReadRetryDelay(5)).toBe(5_000);
    expect(fileChangeReadRetryDelay(50)).toBe(5_000);
  });
});

// Content-based detection: compare on-disk content to what Markd last
// loaded/saved. Prompt EVERY time the disk differs (so re-editing + switching
// back always re-prompts); duplicate OS events for one save are absorbed by the
// caller's promptOpen guard.
describe("shouldPromptForExternalChange", () => {
  it("prompts when on-disk content differs from what Markd saved/loaded", () => {
    expect(shouldPromptForExternalChange("external edit", "original", false)).toBe(true);
  });

  it("prompts again for a second, different external change", () => {
    expect(shouldPromptForExternalChange("edit two", "original", false)).toBe(true);
  });

  it("does not prompt when disk matches saved content (Markd's own save / identical)", () => {
    expect(shouldPromptForExternalChange("same", "same", false)).toBe(false);
  });

  it("does not prompt while a prompt is already open (absorbs duplicate save events)", () => {
    expect(shouldPromptForExternalChange("external edit", "original", true)).toBe(false);
  });
});

// A file the active tab points at can be deleted/moved out from under us. The
// watcher's read then fails; a definitive existence check (path_exists) tells a
// true deletion apart from a transient mid-atomic-save read failure. We prompt
// once (Keep in editor / Close tab) — never while a prompt is already open.
describe("shouldPromptForDeletion", () => {
  it("prompts when the file no longer exists on disk", () => {
    expect(shouldPromptForDeletion(false, false)).toBe(true);
  });

  it("does not prompt when the file still exists (read failure was transient)", () => {
    expect(shouldPromptForDeletion(true, false)).toBe(false);
  });

  it("does not prompt while a prompt is already open (no stacked dialogs)", () => {
    expect(shouldPromptForDeletion(false, true)).toBe(false);
  });
});

describe("in-app file-change choices", () => {
  it("defaults Enter to reload only when the Markd buffer is clean", () => {
    expect(defaultExternalChangeChoice(false)).toBe("reload");
    expect(defaultExternalChangeChoice(true)).toBe("keep");
  });

  it("keeps and detaches a deleted file unless Close Tab was chosen explicitly", () => {
    expect(shouldKeepDeletedFileOpen("keep")).toBe(true);
    expect(shouldKeepDeletedFileOpen(null)).toBe(true);
    expect(shouldKeepDeletedFileOpen("close")).toBe(false);
  });

  it("reloads an external change only when Reload from Disk was chosen explicitly", () => {
    expect(shouldReloadExternalChange("reload")).toBe(true);
    expect(shouldReloadExternalChange("keep")).toBe(false);
    expect(shouldReloadExternalChange(null)).toBe(false);
  });

  it("rechecks an unseen stale prompt instead of treating its null result as Keep", () => {
    expect(resolveExternalChangeChoice(null, false, true)).toBe("recheck");
    expect(resolveExternalChangeChoice("reload", false, true)).toBe("recheck");
    expect(resolveExternalChangeChoice("keep", false, true)).toBe("keep");
    expect(resolveExternalChangeChoice(null, true, true)).toBe("keep");
    expect(resolveExternalChangeChoice("reload", true, true)).toBe("reload");
    expect(resolveExternalChangeChoice("keep", true, false)).toBe("abandon");
  });

  it("rejects a modal continuation after its tab, path, or revision changed", () => {
    const target = {
      tabId: "a",
      filePath: "C:\\notes.md",
      contentRevision: 4,
      tabRevision: 9,
    };
    expect(fileChangeTargetIsCurrent(target, "a", "c:/NOTES.md", 4)).toBe(true);
    expect(fileChangeTargetIsCurrent(target, "b", "C:\\notes.md", 4)).toBe(false);
    expect(fileChangeTargetIsCurrent(target, "a", "C:\\other.md", 4)).toBe(false);
    expect(fileChangeTargetIsCurrent(target, "a", "C:\\notes.md", 5)).toBe(false);
  });

  it("keeps path-safety ownership when only the buffer revision advances", () => {
    const target = {
      tabId: "a",
      filePath: "C:\\notes.md",
      contentRevision: 4,
      tabRevision: 9,
    };
    expect(fileChangeTargetOwnsActivePath(target, "a", "c:/NOTES.md")).toBe(true);
    expect(fileChangeTargetOwnsActivePath(target, "b", "C:\\notes.md")).toBe(false);
    expect(fileChangeTargetOwnsActivePath(target, "a", "C:\\other.md")).toBe(false);
  });

  it("drops duplicate checks for one prompt but retries the latest switched file", () => {
    const coordinator = createFileChangePromptCoordinator();
    const ownerA = Symbol("A");
    const ownerB = Symbol("B");
    const ownerC = Symbol("C");
    const retryA = vi.fn();
    const retryB = vi.fn();
    const retryC = vi.fn();

    expect(coordinator.acquire(ownerA, retryA)).toBe(true);
    expect(coordinator.acquire(ownerA, retryA)).toBe(false);
    expect(coordinator.acquire(ownerB, retryB)).toBe(false);
    expect(coordinator.acquire(ownerC, retryC)).toBe(false);
    coordinator.release(ownerA);

    expect(retryA).not.toHaveBeenCalled();
    expect(retryB).not.toHaveBeenCalled();
    expect(retryC).toHaveBeenCalledTimes(1);
    expect(coordinator.isBusy()).toBe(false);
  });
});
