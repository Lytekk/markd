/**
 * Decide whether an external-modification reload prompt should be shown.
 *
 * Encapsulates the watcher invariant so both triggers — the 2s mtime poll and the
 * window-refocus check in App.tsx — share one definition that is unit-testable
 * without Tauri. A prompt is warranted only when the file's mtime has advanced
 * past the baseline we recorded, and no prompt is already on screen (so the two
 * triggers can't stack dialogs). Null mtimes (startup race before the first stat,
 * or a stat that returned no mtime) never prompt.
 */
export function shouldPromptReload(
  lastMtime: number | null,
  currentMtime: number | null,
  promptOpen: boolean,
): boolean {
  if (promptOpen) return false;
  if (lastMtime === null || currentMtime === null) return false;
  return currentMtime > lastMtime;
}
