/**
 * Decide whether to prompt the user to reload a file that changed on disk.
 *
 * Content-based (not mtime): the on-disk content is compared against the version
 * Markd last loaded or saved (savedContent). This is robust where mtime is not —
 * it cannot false-positive on Markd's OWN save (after a save, disk === saved), and
 * it ignores touches that don't change content. `lastPromptedContent` suppresses
 * re-prompting for a change the user already declined (identical disk content),
 * while still prompting for a genuinely new external change.
 */
export function shouldPromptForExternalChange(
  diskContent: string,
  savedContent: string,
  lastPromptedContent: string | null,
  promptOpen: boolean,
): boolean {
  if (promptOpen) return false;
  if (diskContent === savedContent) return false;
  if (diskContent === lastPromptedContent) return false;
  return true;
}
