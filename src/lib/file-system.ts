// File system abstraction — uses Tauri APIs when available, falls back to browser File System Access API

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: FileEntry[];
  depth: number;
}

const MD_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt"];
const PATH_AUTHORIZATION_ERROR_CODE = "MARKD_PATH_NOT_AUTHORIZED";
const PATH_UNAVAILABLE_ERROR_CODE = "MARKD_PATH_UNAVAILABLE";

function isMarkdownFile(name: string): boolean {
  return MD_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

/**
 * A Save As either wrote, was dismissed by the user, or failed. Collapsing the
 * last two into `null` made a failed write look exactly like a cancel, so a save
 * that never happened was reported to the user as nothing at all.
 */
export type SaveAsResult =
  | { status: "saved"; path: string; name: string }
  | { status: "cancelled" }
  | { status: "failed" };

export function isTauri(): boolean {
  // Tauri v2 exposes the IPC bridge as __TAURI_INTERNALS__ by default;
  // __TAURI__ only exists when withGlobalTauri is enabled in tauri.conf.json.
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

/** True only for the stable, user-safe error emitted by the native scope gate. */
export function isPathAuthorizationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(PATH_AUTHORIZATION_ERROR_CODE);
}

/**
 * True when the native side could not inspect the path at all — a disconnected
 * share, a sleeping VM filesystem, or a device error. Distinct from an
 * authorization denial: the grant is intact and a later attempt can succeed, so
 * callers must not discard the user's tab or ask them to re-authorize.
 */
export function isPathUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(PATH_UNAVAILABLE_ERROR_CODE);
}

// ── Tauri implementations ──────────────────────────────────────────

async function tauriOpenFile(defaultPath?: string): Promise<{
  content: string;
  path: string;
  name: string;
} | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");

  const selected = await open({
    multiple: false,
    defaultPath,
    filters: [
      { name: "Markdown & Text", extensions: ["md", "markdown", "mdx", "txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (!selected) return null;
  const path = typeof selected === "string" ? selected : String(selected);
  const { invoke } = await import("@tauri-apps/api/core");
  const content = await invoke<string>("read_file", { path });
  const name = path.split(/[/\\]/).pop() ?? "untitled.md";
  return { content, path, name };
}

async function tauriSaveFile(path: string, content: string): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_file", { path, content });
    return true;
  } catch {
    return false;
  }
}

async function tauriSaveFileAs(
  content: string,
  suggestedName = "untitled.md",
): Promise<SaveAsResult> {
  const { save } = await import("@tauri-apps/plugin-dialog");

  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });

  if (!path) return { status: "cancelled" };
  // Route through tauriSaveFile so every desktop write uses the hardened native
  // atomic command after the dialog has granted this selected path's scope.
  const ok = await tauriSaveFile(path, content);
  if (!ok) return { status: "failed" };
  const name = path.split(/[/\\]/).pop() ?? suggestedName;
  return { status: "saved", path, name };
}

async function tauriOpenDirectory(): Promise<{
  path: string;
  tree: FileEntry[];
} | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");

  const selected = await open({ directory: true, recursive: true });
  if (!selected) return null;
  const dirPath = typeof selected === "string" ? selected : String(selected);
  const tree = await tauriReadDir(dirPath, 0);
  return { path: dirPath, tree };
}

async function tauriReadDir(
  dirPath: string,
  depth: number,
): Promise<FileEntry[]> {
  const { invoke } = await import("@tauri-apps/api/core");

  interface RustDirEntry {
    name: string;
    path: string;
    is_directory: boolean;
  }

  const entries: FileEntry[] = [];
  const items = await invoke<RustDirEntry[]>("read_dir", { path: dirPath });

  for (const item of items) {
    if (item.name.startsWith(".")) continue;

    if (item.is_directory) {
      const children = await tauriReadDir(item.path, depth + 1);
      // Show directories even when empty: the tree is now editable (CRUD), so a
      // freshly-created folder must appear immediately rather than be hidden
      // until it gains a markdown child.
      entries.push({
        name: item.name,
        path: item.path,
        kind: "directory",
        children,
        depth,
      });
    } else if (isMarkdownFile(item.name)) {
      entries.push({
        name: item.name,
        path: item.path,
        kind: "file",
        depth,
      });
    }
  }

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function tauriReadFileByPath(path: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("read_file", { path });
}

// ── Browser File System Access API implementations ─────────────────

async function browserOpenFile(): Promise<{
  content: string;
  path: string;
  name: string;
} | null> {
  try {
    const handles = await window.showOpenFilePicker({
      types: [
        {
          description: "Markdown & Text",
          accept: {
            "text/markdown": [".md", ".markdown", ".mdx"],
            "text/plain": [".txt"],
          },
        },
      ],
    });
    const handle = handles[0];
    if (!handle) return null;
    const file = await handle.getFile();
    const content = await file.text();
    return { content, path: file.name, name: file.name };
  } catch {
    return null;
  }
}

async function browserSaveFile(
  _path: string,
  content: string,
  handle?: FileSystemFileHandle,
): Promise<boolean> {
  if (!handle) return false;
  try {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

async function browserSaveFileAs(
  content: string,
  suggestedName = "untitled.md",
): Promise<SaveAsResult> {
  if (typeof window.showSaveFilePicker !== "function") {
    // Firefox and Safari have no File System Access API at all.
    return { status: "failed" };
  }
  let handle: FileSystemFileHandle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
    });
  } catch (error) {
    // AbortError is the user dismissing the picker. SecurityError (no user
    // gesture, insecure origin) and TypeError are real failures, and reporting
    // them as a cancel meant Ctrl+S did nothing at all with no explanation.
    const name = error instanceof DOMException ? error.name : "";
    return name === "AbortError" ? { status: "cancelled" } : { status: "failed" };
  }
  try {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return { status: "saved", path: handle.name, name: handle.name };
  } catch {
    return { status: "failed" };
  }
}

// ── Public API ─────────────────────────────────────────────────────

export async function openFile(defaultPath?: string) {
  return isTauri() ? tauriOpenFile(defaultPath) : browserOpenFile();
}

export async function saveToFile(
  path: string,
  content: string,
  handle?: FileSystemFileHandle,
): Promise<boolean> {
  return isTauri() ? tauriSaveFile(path, content) : browserSaveFile(path, content, handle);
}

export async function saveFileAs(
  content: string,
  suggestedName?: string,
): Promise<SaveAsResult> {
  return isTauri() ? tauriSaveFileAs(content, suggestedName) : browserSaveFileAs(content, suggestedName);
}

export async function openDirectory() {
  if (!isTauri()) return null; // Browser doesn't have a good equivalent for file trees
  return tauriOpenDirectory();
}

/** Re-read a known directory into a tree (no folder picker) — used to refresh
    the sidebar after a create/rename/trash. */
export async function readDirTree(rootPath: string): Promise<FileEntry[]> {
  if (!isTauri()) return [];
  return tauriReadDir(rootPath, 0);
}

/** Create an empty file at `path` through the native scope gate. */
export async function createFile(path: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("create_file", { path });
}

/** Create a directory at `path` through the native scope gate. */
export async function createFolder(path: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("create_folder", { path });
}

/** Rename/move `from` -> `to` (Rust rename_path; fails if `to` exists). */
export async function renamePath(from: string, to: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("rename_path", { from, to });
}

/** Move `path` to the OS recycle bin (Rust trash_path; recoverable). */
export async function trashPath(path: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("trash_path", { path });
}

export async function readFileByPath(path: string): Promise<string> {
  if (!isTauri()) throw new Error("readFileByPath requires Tauri");
  return tauriReadFileByPath(path);
}

/**
 * True if `path` currently exists on disk. Definitive (a metadata check, not a
 * content read), so it distinguishes a real deletion from a transient mid
 * atomic-save read failure, and flags stale Recent Files. The browser dev server
 * has no filesystem, so it reports true there (nothing is treated as missing).
 */
export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri()) return true;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("path_exists", { path });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function exportAsHtml(html: string, title: string): Promise<void> {
  const styles = Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((r) => r.cssText);
      } catch {
        return [];
      }
    })
    .join("\n");

  const baseName = title.replace(/\.md$/, "");
  // File names may legally contain < and > on macOS/Linux. The rest of the
  // export pipeline routes through the ProseMirror serializer precisely to keep
  // markup escaped; this interpolation must not be the hole in it.
  const escapedTitle = escapeHtml(baseName);
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style>${styles}</style>
</head>
<body>
  <div id="write">${html}</div>
</body>
</html>`;

  if (isTauri()) {
    // WebView2 blocks the blob-URL + <a download> trick. Use the native save
    // dialog + write_file command to produce a real file the user can open.
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: `${baseName}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!path) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_file", { path, content: fullHtml });
    return;
  }

  // Browser fallback
  const blob = new Blob([fullHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportAsPdf(): void {
  window.print();
}
