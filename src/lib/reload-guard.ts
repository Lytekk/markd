/**
 * Reload-from-disk replaces the buffer and resets ProseMirror's history, so
 * unsaved edits are gone with no undo. Ctrl+R is a reflex carried over from the
 * browser, and Ctrl+Shift+R does it to every tab at once — both need to ask
 * first when there is anything to lose.
 */
export function reloadDiscardPrompt(
  dirtyFileNames: string[],
): { title: string; message: string } | null {
  if (dirtyFileNames.length === 0) return null;
  const subject =
    dirtyFileNames.length === 1
      ? `"${dirtyFileNames[0]}" has unsaved changes`
      : `${dirtyFileNames.length} open files have unsaved changes`;
  return {
    title: "Reload From Disk",
    message: `${subject}. Reloading replaces the buffer with the file on disk — those edits are discarded and cannot be undone.`,
  };
}
