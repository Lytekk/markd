// File system abstraction — uses Tauri APIs when available, falls back to browser File System Access API

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: FileEntry[];
  depth: number;
}

const MD_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt"];

function isMarkdownFile(name: string): boolean {
  return MD_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

export function isTauri(): boolean {
  // Tauri v2 exposes the IPC bridge as __TAURI_INTERNALS__ by default;
  // __TAURI__ only exists when withGlobalTauri is enabled in tauri.conf.json.
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

// ── Tauri implementations ──────────────────────────────────────────

async function tauriOpenFile(): Promise<{
  content: string;
  path: string;
  name: string;
} | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");

  const selected = await open({
    multiple: false,
    filters: [
      { name: "Markdown & Text", extensions: ["md", "markdown", "mdx", "txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (!selected) return null;
  const path = typeof selected === "string" ? selected : String(selected);
  const content = await readTextFile(path);
  const name = path.split(/[/\\]/).pop() ?? "untitled.md";
  return { content, path, name };
}

async function tauriSaveFile(path: string, content: string): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_file", { path, content });
    return true;
  } catch {
    // Fallback to plugin
    try {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, content);
      return true;
    } catch {
      return false;
    }
  }
}

async function tauriSaveFileAs(
  content: string,
  suggestedName = "untitled.md",
): Promise<{ path: string; name: string } | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");

  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });

  if (!path) return null;
  // Route through tauriSaveFile so the write goes via the atomic write_file
  // command (temp + rename), with the same plugin fallback.
  const ok = await tauriSaveFile(path, content);
  if (!ok) return null;
  const name = path.split(/[/\\]/).pop() ?? suggestedName;
  return { path, name };
}

async function tauriOpenDirectory(): Promise<{
  path: string;
  tree: FileEntry[];
} | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");

  const selected = await open({ directory: true });
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
      if (children.length > 0) {
        entries.push({
          name: item.name,
          path: item.path,
          kind: "directory",
          children,
          depth,
        });
      }
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
  // Use custom Rust command to bypass FS scope restrictions
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("read_file", { path });
  } catch {
    // Fallback to plugin (works for scoped paths)
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(path);
  }
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
): Promise<{ path: string; name: string } | null> {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return { path: handle.name, name: handle.name };
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────

export async function openFile() {
  return isTauri() ? tauriOpenFile() : browserOpenFile();
}

export async function saveToFile(
  path: string,
  content: string,
  handle?: FileSystemFileHandle,
): Promise<boolean> {
  return isTauri() ? tauriSaveFile(path, content) : browserSaveFile(path, content, handle);
}

export async function saveFileAs(content: string, suggestedName?: string) {
  return isTauri() ? tauriSaveFileAs(content, suggestedName) : browserSaveFileAs(content, suggestedName);
}

export async function openDirectory() {
  if (!isTauri()) return null; // Browser doesn't have a good equivalent for file trees
  return tauriOpenDirectory();
}

export async function readFileByPath(path: string): Promise<string> {
  if (!isTauri()) throw new Error("readFileByPath requires Tauri");
  return tauriReadFileByPath(path);
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
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${baseName}</title>
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
    try {
      await invoke("write_file", { path, content: fullHtml });
    } catch {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, fullHtml);
    }
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
