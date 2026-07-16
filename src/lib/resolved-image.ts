import Image, { type ImageOptions } from "@tiptap/extension-image";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface ResolvedImageOptions extends ImageOptions {
  getFileDir: () => string;
}

/**
 * Image node that resolves relative `src` paths against the current markdown
 * file's directory and rewrites them to Tauri's asset protocol so the webview
 * can load local files. Keeps the node's `src` attribute unchanged, so saving
 * writes the original relative path back to disk.
 *
 * Requires `app.security.assetProtocol.enable = true` in tauri.conf.json.
 * Local assets are available only when their file or containing folder was
 * explicitly authorized through a native dialog or OS file-open event.
 */
export const ResolvedImage = Image.extend<ResolvedImageOptions>({
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      getFileDir: () => "",
    };
  },
  renderHTML({ HTMLAttributes, node }) {
    const src = (node.attrs.src as string | undefined) ?? "";
    const resolved = resolveImageSrc(src, this.options.getFileDir());
    return ["img", { ...HTMLAttributes, src: resolved }];
  },
});

export function resolveImageSrc(src: string, fileDir: string): string {
  if (!src) return src;
  // Never let markdown provide a local-protocol URL directly: that would make
  // the document content an ambient filesystem authority. Generated asset URLs
  // come only from convertFileSrc below after Tauri has checked its scope.
  if (/^(asset:|file:|tauri:)/i.test(src)) return "";
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  if (!fileDir) return src;

  const absolute = isAbsolute(src) ? src : joinPath(fileDir, src);
  try {
    return convertFileSrc(absolute);
  } catch {
    return src;
  }
}

function isAbsolute(p: string): boolean {
  return (
    p.startsWith("/") ||
    p.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/.test(p)
  );
}

function joinPath(dir: string, rel: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const cleanDir = dir.replace(/[\\/]+$/, "");
  const normalizedRel = rel.replace(/\//g, sep);
  return `${cleanDir}${sep}${normalizedRel}`;
}
