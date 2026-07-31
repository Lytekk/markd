/**
 * What actually happened to a save.
 *
 * A boolean cannot carry this: "false" used to mean the user cancelled the Save
 * As dialog, the write failed, *and* the write succeeded but was superseded by a
 * later keystroke. Callers guessed, and guessed wrong in both directions — a
 * successful save on a slow share raised a "could not be saved" alarm, while a
 * genuinely failed Save As of an untitled buffer was completely silent.
 */
export type SaveOutcome =
  /** Bytes are on disk and this call settled the buffer's saved state. */
  | "written"
  /** The user dismissed the Save As dialog. Nothing was written, by choice. */
  | "cancelled"
  /**
   * The buffer moved on while the write was in flight (a keystroke, a tab
   * switch, a path change). The write itself was not reported as failing; this
   * call simply no longer owns the state, so it must not clear dirty — and must
   * not claim a failure either.
   */
  | "superseded"
  /** The write was attempted and did not succeed. The document is unsaved. */
  | "failed";

/** True only when the document is genuinely unsaved because a write failed. */
export function isSaveFailure(outcome: SaveOutcome): boolean {
  return outcome === "failed";
}

/**
 * The message to show for a save outcome, or null when the user should not be
 * interrupted. Untitled documents get the same treatment as named ones.
 */
export function saveOutcomeMessage(outcome: SaveOutcome, fileName: string): string | null {
  if (!isSaveFailure(outcome)) return null;
  return `"${fileName}" could not be saved. Its contents remain unsaved.`;
}
