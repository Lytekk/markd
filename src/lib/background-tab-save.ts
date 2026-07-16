import type { FileTab } from "@/hooks/use-file-tabs";
import { queueFileWrite } from "./file-write-queue";
import { resolveSaveContent } from "./markdown-fidelity";

type BackgroundTab = Pick<FileTab, "fileName" | "filePath" | "content" | "savedContent">;

export interface BackgroundTabSaveDeps {
  saveToFile: (path: string, content: string) => Promise<boolean>;
  saveFileAs: (content: string, suggestedName: string) => Promise<{ path: string; name: string } | null>;
}

export interface SavedBackgroundTab {
  filePath: string;
  fileName: string;
  savedContent: string;
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
): Promise<SavedBackgroundTab | null> {
  const savedContent = resolveSaveContent(true, tab.savedContent, () => tab.content);

  if (tab.filePath) {
    const ok = await queueFileWrite(tab.filePath, async () => (
      shouldWrite() ? saveToFile(tab.filePath!, savedContent) : null
    ));
    return ok
      ? { filePath: tab.filePath, fileName: tab.fileName, savedContent }
      : null;
  }

  if (!shouldWrite()) return null;
  const result = await saveFileAs(savedContent, tab.fileName);
  if (!shouldWrite()) return null;
  return result
    ? { filePath: result.path, fileName: result.name, savedContent }
    : null;
}
