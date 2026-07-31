/**
 * One file, one identity.
 *
 * Markd learns a file's path from two sources that spell it differently: the
 * native layer canonicalizes (which on Windows can yield an extended-length
 * `\\?\` path), while a file dialog returns whatever the picker produced. When
 * those spellings are compared with `===`, one file becomes two tabs with two
 * divergent buffers over one disk file, two Recent Files rows, and two
 * independent write queues. Compare through {@link samePath} instead.
 *
 * This is a *comparison* key only. Never send a normalized key to the native
 * layer or write it to disk — it is lower-cased on Windows and therefore lossy.
 */

const WINDOWS_VERBATIM_UNC = /^[\\/]{2}[?][\\/]UNC[\\/]/i;
const WINDOWS_VERBATIM_DISK = /^[\\/]{2}[?][\\/](?=[a-z]:)/i;
const WINDOWS_SHAPED = /^(?:[a-z]:|[\\/]{2})/i;

/**
 * Reduce a path to a stable key for equality checks.
 *
 * Windows paths lose their extended-length prefix, separator style and case;
 * POSIX paths keep their case because POSIX filesystems are case-sensitive.
 */
export function normalizePathKey(path: string): string {
  if (!path) return "";

  // `\\?\UNC\host\share` and `\\host\share` name the same share; `\\?\D:` and
  // `D:` name the same volume. Strip the prefix before anything else so the
  // Windows-shape test below sees the plain form.
  let normalized = path
    .replace(WINDOWS_VERBATIM_UNC, "\\\\")
    .replace(WINDOWS_VERBATIM_DISK, "");

  if (!WINDOWS_SHAPED.test(normalized)) {
    // POSIX: collapse repeated separators and drop a trailing one, but keep case.
    const collapsed = normalized.replace(/\/{2,}/g, "/");
    return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
  }

  const leadingUnc = /^[\\/]{2}/.test(normalized);
  normalized = normalized.replace(/[\\/]+/g, "\\");
  if (leadingUnc) normalized = `\\${normalized}`;
  normalized = normalized.length > 1 ? normalized.replace(/\\+$/, "") : normalized;

  if (!leadingUnc) return normalized.toLowerCase();

  // `\\server\share\rest`: Windows resolves the server and share names
  // case-insensitively, but everything below them belongs to the remote
  // filesystem — a WSL or Samba export can hold both Notes.md and notes.md, and
  // folding their case would merge two different files into one tab.
  const match = /^(\\\\[^\\]*\\[^\\]*)(\\.*)?$/.exec(normalized);
  if (!match) return normalized.toLowerCase();
  return `${match[1]!.toLowerCase()}${match[2] ?? ""}`;
}

/**
 * True when both arguments name the same file. A missing or empty path names no
 * file, so it matches nothing — not even another missing path.
 */
export function samePath(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return normalizePathKey(a) === normalizePathKey(b);
}
