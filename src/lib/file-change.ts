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
