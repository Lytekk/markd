import { normalizePathKey } from "./path-identity";

/**
 * True when `path` is `root` itself or lives underneath it.
 *
 * Compares on normalized keys, so the two spellings the app produces for one
 * file agree, and on whole segments, so `/notes-archive` is not treated as
 * living inside `/notes` the way a bare `startsWith` would.
 */
export function isPathInside(
  path: string | null | undefined,
  root: string | null | undefined,
): boolean {
  if (!path || !root) return false;
  const target = normalizePathKey(path);
  const base = normalizePathKey(root).replace(/[\\/]+$/, "");
  if (!target || !base) return false;
  if (target === base) return true;
  return target.startsWith(base) && /[\\/]/.test(target.charAt(base.length));
}
