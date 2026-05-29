// Pure path/name helpers for file-tree CRUD. No Tauri/fs access here — this is
// the WSL-unit-testable surface; the actual create/rename/trash go through Rust
// commands (file-system.ts). Paths may be Windows (`\`) or POSIX (`/`) depending
// on where the tree was read, so every helper handles both separators.

const RESERVED_CHARS = /[<>:"|?*]/;
const TEXT_EXTENSION = /\.(md|markdown|mdx|txt)$/i;
const HAS_EXTENSION = /\.[^.\\/]+$/;

/** Validate a user-entered file/folder name. Returns an error message, or null
    if the name is safe to use as a single path segment. */
export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required";
  if (/[\\/]/.test(name)) return "Name can't contain slashes";
  if (RESERVED_CHARS.test(name)) return 'Name contains an invalid character (< > : " | ? *)';
  if (name === "." || name === "..") return "Name can't be . or ..";
  // Windows strips trailing dots/spaces, which silently changes the name and can
  // collide with an existing file — reject up front.
  if (/[ .]$/.test(name)) return "Name can't end with a space or a dot";
  if (name.length > 255) return "Name is too long";
  return null;
}

/** Append `.md` to an extensionless name. A name the user gave an explicit
    extension (even a non-text one) is left as typed — non-text extensions just
    won't appear in the (filtered) tree, a documented v1 limitation. */
export function ensureMdExtension(name: string): string {
  if (TEXT_EXTENSION.test(name)) return name;
  if (HAS_EXTENSION.test(name)) return name;
  return `${name}.md`;
}

/** The directory containing `path` (everything before the last separator), or
    "" when `path` has no separator. Trailing separators are ignored. */
export function parentPath(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return idx < 0 ? "" : cleaned.slice(0, idx);
}

/** Join `dir` and `name` using whichever separator `dir` already uses (so a
    Windows tree stays `\` and a POSIX tree stays `/`). */
export function joinPath(dir: string, name: string): string {
  const cleaned = dir.replace(/[\\/]+$/, "");
  const sep = cleaned.includes("\\") && !cleaned.includes("/") ? "\\" : "/";
  return `${cleaned}${sep}${name}`;
}

/** Where a newly created file/folder should land, given the right-clicked entry:
    inside a folder entry, alongside a file entry, or at the root for an
    empty-area click. */
export function targetDirForEntry(
  entry: { path: string; isDirectory: boolean } | null,
  rootPath: string,
): string {
  if (!entry) return rootPath;
  return entry.isDirectory ? entry.path : parentPath(entry.path);
}
