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
