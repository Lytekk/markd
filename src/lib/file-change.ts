import { samePath } from "./path-identity";

const FILE_CHANGE_READ_RETRY_INITIAL_MS = 250;
const FILE_CHANGE_READ_RETRY_MAX_MS = 5_000;

/**
 * Back off a transient watcher read failure without ever resuming autosave
 * against bytes we could not inspect. Persistent failures stay fail-closed but
 * keep retrying, so a single atomic-save race cannot wedge the pause forever.
 */
export function fileChangeReadRetryDelay(attempt: number): number {
  const exponent = Math.max(0, Math.floor(attempt));
  return Math.min(
    FILE_CHANGE_READ_RETRY_INITIAL_MS * 2 ** exponent,
    FILE_CHANGE_READ_RETRY_MAX_MS,
  );
}

export interface FileChangeTarget {
  tabId: string;
  filePath: string;
  /** Per-edit active-buffer token from useFileState. */
  contentRevision: number;
  /** Structural tab token used only when hydrating the tab snapshot. */
  tabRevision: number;
}

export interface FileChangePromptCoordinator {
  isBusy: () => boolean;
  acquire: (owner: symbol, retry: () => void) => boolean;
  release: (owner: symbol) => void;
}

/**
 * Serialize active-file prompts without losing the initial check for a file
 * selected by an OS event while an older tab's prompt is still open. Duplicate
 * events for the current owner are absorbed; only the latest different owner
 * gets one trailing retry when the prompt releases.
 */
export function createFileChangePromptCoordinator(): FileChangePromptCoordinator {
  let activeOwner: symbol | null = null;
  let trailing: { owner: symbol; retry: () => void } | null = null;
  return {
    isBusy: () => activeOwner !== null,
    acquire(owner, retry) {
      if (activeOwner === null) {
        activeOwner = owner;
        return true;
      }
      if (activeOwner !== owner) trailing = { owner, retry };
      return false;
    },
    release(owner) {
      if (activeOwner !== owner) return;
      activeOwner = null;
      const next = trailing;
      trailing = null;
      next?.retry();
    },
  };
}

/**
 * An awaited file-change choice may only act on the exact buffer it described.
 * OS opens and watcher events can change tabs without going through keyboard
 * gating, so active-tab identity, path identity, and revision must all survive.
 */
export function fileChangeTargetIsCurrent(
  target: FileChangeTarget,
  activeTabId: string,
  activeFilePath: string | null,
  contentRevision: number,
): boolean {
  return (
    target.tabId === activeTabId &&
    samePath(target.filePath, activeFilePath) &&
    target.contentRevision === contentRevision
  );
}

/**
 * Path safety survives an editor mutation that advances only the revision.
 * This weaker check must never authorize a stale destructive choice, but it
 * lets the caller detach/reclassify the same active path instead of abandoning
 * an autosave pause after the user types while a post-modal probe is pending.
 */
export function fileChangeTargetOwnsActivePath(
  target: FileChangeTarget,
  activeTabId: string,
  activeFilePath: string | null,
): boolean {
  return target.tabId === activeTabId && samePath(target.filePath, activeFilePath);
}

/**
 * Decide whether to prompt the user to reload a file that changed on disk.
 *
 * Content-based (not mtime): the on-disk content is compared against the version
 * Markd last loaded or saved (savedContent). Robust where mtime is not — it
 * cannot false-positive on Markd's OWN save (after a save, disk === saved) and it
 * ignores touches that don't change content. We prompt whenever the disk differs
 * from what Markd has, EVERY time the file is (re-)checked — so re-editing the
 * file and switching back always re-prompts. Duplicate OS watch events fired for a
 * single save are absorbed by the caller's "prompt already open" guard, not here.
 */
export function shouldPromptForExternalChange(
  diskContent: string,
  savedContent: string,
  promptOpen: boolean,
): boolean {
  if (promptOpen) return false;
  return diskContent !== savedContent;
}


/**
 * Decide whether to prompt because the active file was DELETED/moved out from
 * under us (distinct from a content change). The watcher's read throws when the
 * file is gone, but a read can also fail transiently mid atomic-save (write-temp
 * + rename) — so the caller confirms with a definitive existence check
 * (`path_exists`) and passes the result here. We prompt only when the file truly
 * does not exist and no other prompt is already open (no stacked dialogs).
 */
export function shouldPromptForDeletion(fileExists: boolean, promptOpen: boolean): boolean {
  if (promptOpen) return false;
  return !fileExists;
}

/**
 * A deleted file's in-memory buffer is the only remaining copy. Dismissal,
 * Escape, backdrop click, or modal preemption must therefore keep and detach it;
 * closing is allowed only after the user chooses the explicit Close Tab action.
 */
export function shouldKeepDeletedFileOpen(choice: string | null): boolean {
  return choice !== "close";
}

/** Reloading can discard local edits, so only the explicit Reload action wins. */
export function shouldReloadExternalChange(choice: string | null): boolean {
  return choice === "reload";
}

export type ExternalChangeResolution = "reload" | "keep" | "recheck" | "abandon";

/**
 * A stale queued/dismissed request never counts as an acknowledged Keep. If the
 * same path still owns the buffer, re-read and classify it again before any
 * autosave can overwrite external bytes. An explicit Keep remains authoritative.
 */
export function resolveExternalChangeChoice(
  choice: string | null,
  isExactTarget: boolean,
  ownsActivePath: boolean,
): ExternalChangeResolution {
  if (!ownsActivePath) return "abandon";
  if (choice === "reload") return isExactTarget ? "reload" : "recheck";
  if (choice === "keep") return "keep";
  return isExactTarget ? "keep" : "recheck";
}
