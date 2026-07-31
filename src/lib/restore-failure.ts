import { isPathAuthorizationError, isPathUnavailableError } from "./file-system";

/**
 * Why a persisted tab's file could not be read while restoring the session.
 *
 * These are deliberately separate because the correct response differs:
 * `unauthorized` needs a user gesture to re-grant the path, `missing` is final,
 * and `unavailable` is transient — a sleeping WSL/VM share, a disconnected
 * network drive, or a file locked mid-write. Collapsing them into one bucket is
 * what made a deleted file tell the user to "authorize access again".
 */
export type RestoreFailureKind = "unauthorized" | "missing" | "unavailable";

export type RestoreFailureCounts = Partial<Record<RestoreFailureKind, number>>;

/**
 * Classify a failed restore read.
 *
 * `exists` is the result of a definitive existence probe, or `null` when that
 * probe could not answer. An unanswered probe means "unavailable", never
 * "missing" — guessing missing there would discard a tab whose file is intact.
 */
export function classifyRestoreFailure(
  error: unknown,
  exists: boolean | null,
): RestoreFailureKind {
  if (isPathAuthorizationError(error)) return "unauthorized";
  if (isPathUnavailableError(error)) return "unavailable";
  return exists === false ? "missing" : "unavailable";
}

function fileNoun(count: number): string {
  return count === 1 ? "file" : "files";
}

function subject(count: number): string {
  return `${count} previously opened ${fileNoun(count)} `;
}

/**
 * Build the single startup notice covering every restore failure, or null when
 * nothing failed. One dialog is shown at most; each class gets its own accurate
 * sentence and its own remedy.
 */
export function restoreFailureNotice(
  counts: RestoreFailureCounts,
): { title: string; message: string } | null {
  const missing = counts.missing ?? 0;
  const unauthorized = counts.unauthorized ?? 0;
  const unavailable = counts.unavailable ?? 0;
  if (missing + unauthorized + unavailable === 0) return null;

  const sentences: string[] = [];
  if (missing > 0) {
    sentences.push(
      `${subject(missing)}${missing === 1 ? "is" : "are"} no longer on disk, so ${
        missing === 1 ? "its tab was" : "their tabs were"
      } closed.`,
    );
  }
  if (unauthorized > 0) {
    sentences.push(
      `${subject(unauthorized)}${unauthorized === 1 ? "is" : "are"} no longer authorized. ` +
        `Reopen ${unauthorized === 1 ? "it" : "them"} from Recent Files or File > Open to authorize access again.`,
    );
  }
  if (unavailable > 0) {
    sentences.push(
      `${subject(unavailable)}could not be read right now — the drive or share may be offline. ` +
        `${unavailable === 1 ? "Its tab is" : "Their tabs are"} still open and will reload when you select ${
          unavailable === 1 ? "it" : "them"
        }.`,
    );
  }
  sentences.push("On-disk contents were left unchanged.");

  return { title: "Reopen Files", message: sentences.join(" ") };
}
