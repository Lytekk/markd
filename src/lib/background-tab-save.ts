import type { FileTab } from "@/hooks/use-file-tabs";
import { queueFileWrite } from "./file-write-queue";
import { resolveSaveContent } from "./markdown-fidelity";
import type { SaveAsResult } from "./file-system";
import type { SaveOutcome } from "./save-outcome";

type BackgroundTab = Pick<FileTab, "fileName" | "filePath" | "content" | "savedContent">;

export interface BackgroundTabSaveDeps {
  saveToFile: (path: string, content: string) => Promise<boolean>;
  saveFileAs: (content: string, suggestedName: string) => Promise<SaveAsResult>;
}

export interface SavedBackgroundTab {
  filePath: string;
  fileName: string;
  savedContent: string;
}

/**
 * What a background save did, and — only when it wrote — the tab's new identity.
 *
 * A bare `null` for "did not write" collapsed a disk-full or permission failure
 * into the same value as a superseded write and a cancelled dialog, so Close All
 * and the quit guard aborted on a REAL failure with nothing shown to the user.
 */
export interface BackgroundTabSaveResult {
  outcome: SaveOutcome;
  saved?: SavedBackgroundTab;
}

/**
 * Persist an inactive dirty tab without ever claiming it is safe to close when
 * its write or Save As dialog failed. Inactive tabs already hold their own
 * authoritative snapshot, unlike the active editor buffer.
 */
export async function saveBackgroundTab(
  tab: BackgroundTab,
  { saveToFile, saveFileAs }: BackgroundTabSaveDeps,
  shouldWrite: () => boolean = () => true,
): Promise<BackgroundTabSaveResult> {
  const savedContent = resolveSaveContent(true, tab.savedContent, () => tab.content);

  if (tab.filePath) {
    const ok = await queueFileWrite(tab.filePath, async () => (
      shouldWrite() ? saveToFile(tab.filePath!, savedContent) : null
    ));
    if (ok === null) return { outcome: "superseded" };
    if (!ok) return { outcome: "failed" };
    return {
      outcome: "written",
      saved: { filePath: tab.filePath, fileName: tab.fileName, savedContent },
    };
  }

  if (!shouldWrite()) return { outcome: "superseded" };
  const result = await saveFileAs(savedContent, tab.fileName);
  if (!shouldWrite()) return { outcome: "superseded" };
  if (result.status === "cancelled") return { outcome: "cancelled" };
  if (result.status === "failed") return { outcome: "failed" };
  return {
    outcome: "written",
    saved: { filePath: result.path, fileName: result.name, savedContent },
  };
}
