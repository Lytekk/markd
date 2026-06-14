// Reveal a file in the OS file manager (Windows Explorer / Finder), selecting it.
//
// Routed through the Tauri opener plugin's revealItemInDir (needs the
// `opener:allow-reveal-item-in-dir` capability). No-op in the dev server, where
// there is no OS file manager to open.

import { isTauri } from "@/lib/file-system";

/** Open the OS file manager with `path` selected. No-op outside Tauri. */
export async function revealInFileManager(path: string): Promise<void> {
  if (!isTauri()) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}
