import { useState, useCallback, useRef, useEffect } from "react";
import type { JSONContent } from "@tiptap/core";
import { resolveSaveContent } from "@/lib/markdown-fidelity";
import {
  FileEntry,
  openFile,
  openDirectory,
  readDirTree,
  saveToFile,
  saveFileAs,
  readFileByPath,
} from "@/lib/file-system";
import { queueFileWrite } from "@/lib/file-write-queue";
import type { SaveOutcome } from "@/lib/save-outcome";

function dirname(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSep >= 0 ? filePath.slice(0, lastSep) : "";
}

const AUTO_SAVE_DELAY_MS = 30_000;
const AUTO_SAVE_RETRY_DELAY_MS = 5_000;
const AUTO_SAVE_MAX_RETRIES = 3;

export interface FileState {
  fileName: string;
  filePath: string | null;
  isDirty: boolean;
  dirTree: FileEntry[];
  /** The opened folder's root path, for refreshing the tree after CRUD. */
  dirRoot: string | null;
  savedContent: string;
  lastSaved: number | null;
  /**
   * Bumped on every open-class load (open / open-by-path / file-select / new)
   * and NEVER on tab-switch restores. App.tsx uses it as the reset signal for
   * the word/char-count baseline, which tracks "since the file was opened",
   * not "since the last save".
   */
  openCount: number;
}

const INITIAL_FILE_STATE: FileState = {
  fileName: "Untitled",
  filePath: null,
  isDirty: false,
  dirTree: [],
  dirRoot: null,
  savedContent: "",
  lastSaved: null,
  openCount: 0,
};

export function useFileState() {
  const stateRef = useRef<FileState>(INITIAL_FILE_STATE);
  const [state, setState] = useState<FileState>(() => stateRef.current);
  const updateState = useCallback((updater: (current: FileState) => FileState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  // Every buffer replacement and editor mutation advances this generation. A
  // filesystem write is allowed to settle state only if it still owns the exact
  // buffer revision it captured; otherwise it wrote an older snapshot and the
  // visible buffer must stay dirty for a later save.
  const contentRevisionRef = useRef(0);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAutoSaveRef = useRef<(revision: number, filePath: string | null, attempt?: number) => void>(
    () => {},
  );
  const clearAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const getMarkdownRef = useRef<(() => string) | null>(null);
  const setContentRef = useRef<
    ((md: string, fileDir: string, docJSON?: JSONContent, isDirty?: boolean) => void) | null
  >(null);

  const registerGetMarkdown = useCallback((fn: () => string) => {
    getMarkdownRef.current = fn;
  }, []);

  const registerSetContent = useCallback(
    (fn: (md: string, fileDir: string, docJSON?: JSONContent, isDirty?: boolean) => void) => {
      setContentRef.current = fn;
    },
    [],
  );

  const getCurrentState = useCallback(() => stateRef.current, []);

  const scheduleAutoSave = useCallback(
    (revision: number, filePath: string | null, attempt = 0) => {
      clearAutoSave();
      if (!filePath) return;

      autoSaveTimerRef.current = setTimeout(() => {
        void (async () => {
          const current = stateRef.current;
          if (
            contentRevisionRef.current !== revision ||
            !current.isDirty ||
            current.filePath !== filePath
          ) {
            return;
          }
          const md = resolveSaveContent(
            true,
            current.savedContent,
            () => getMarkdownRef.current?.() ?? "",
          );
          const ok = await queueFileWrite(filePath, async () => {
            if (
              contentRevisionRef.current !== revision ||
              stateRef.current.filePath !== filePath
            ) {
              return null;
            }
            return saveToFile(filePath, md);
          });
          if (ok === null) return;
          if (
            contentRevisionRef.current !== revision ||
            stateRef.current.filePath !== filePath
          ) {
            return;
          }
          if (!ok) {
            if (attempt < AUTO_SAVE_MAX_RETRIES && stateRef.current.isDirty) {
              scheduleAutoSaveRef.current(revision, filePath, attempt + 1);
            } else {
              console.error("[autosave] failed; document remains unsaved");
            }
            return;
          }
          contentRevisionRef.current += 1;
          clearAutoSave();
          updateState((prev) => ({
            ...prev,
            isDirty: false,
            savedContent: md,
            lastSaved: Date.now(),
          }));
        })();
      }, attempt === 0 ? AUTO_SAVE_DELAY_MS : AUTO_SAVE_RETRY_DELAY_MS);
    },
    [clearAutoSave, updateState],
  );
  scheduleAutoSaveRef.current = scheduleAutoSave;

  const markDirty = useCallback(() => {
    const revision = ++contentRevisionRef.current;
    const filePath = stateRef.current.filePath;
    updateState((prev) => (prev.isDirty ? prev : { ...prev, isDirty: true }));
    // Reset the debounce on EVERY edit. Depending only on isDirty would arm it
    // once, then save a stale mid-typing snapshot 30 seconds later.
    scheduleAutoSave(revision, filePath);
  }, [scheduleAutoSave, updateState]);

  // Inverse of markDirty — used when the buffer returns to the saved state
  // (Ctrl+Z back to the last save), so the dirty indicator can clear without
  // an actual save.
  const markClean = useCallback(() => {
    contentRevisionRef.current += 1;
    clearAutoSave();
    updateState((prev) => (prev.isDirty ? { ...prev, isDirty: false } : prev));
  }, [clearAutoSave, updateState]);

  const handleOpen = useCallback(async () => {
    const result = await openFile();
    if (!result) return;

    contentRevisionRef.current += 1;
    clearAutoSave();
    setContentRef.current?.(result.content, dirname(result.path));
    updateState((prev) => ({
      ...prev,
      fileName: result.name,
      filePath: result.path,
      isDirty: false,
      savedContent: result.content,
      openCount: prev.openCount + 1,
    }));
  }, [clearAutoSave, updateState]);

  const handleOpenFolder = useCallback(async () => {
    const result = await openDirectory();
    if (!result) return;
    updateState((prev) => ({
      ...prev,
      dirTree: result.tree,
      dirRoot: result.path,
    }));
  }, [updateState]);

  const handleSave = useCallback(async (): Promise<SaveOutcome> => {
    // Round-trip fidelity: a clean buffer writes savedContent VERBATIM (no
    // re-serialization → no normalization churn on untouched files); a dirty
    // buffer serializes with the source's trailing-newline convention.
    const snapshot = stateRef.current;
    const revision = contentRevisionRef.current;
    const md = resolveSaveContent(
      snapshot.isDirty,
      snapshot.savedContent,
      () => getMarkdownRef.current?.() ?? "",
    );
    clearAutoSave();

    const filePath = snapshot.filePath;
    if (filePath) {
      const ok = await queueFileWrite(filePath, async () => {
        if (
          contentRevisionRef.current !== revision ||
          stateRef.current.filePath !== filePath
        ) {
          return null;
        }
        return saveToFile(filePath, md);
      });
      // The queue skipped this write because a newer one owns the path.
      if (ok === null) return "superseded";
      if (!ok) {
        if (stateRef.current.isDirty) scheduleAutoSave(revision, filePath);
        return "failed";
      }
      // The bytes are on disk. If the buffer moved on while the write was in
      // flight, this call may no longer settle the saved state — but it must not
      // report a failure for a write that succeeded.
      if (
        contentRevisionRef.current !== revision ||
        stateRef.current.filePath !== filePath
      ) {
        return "superseded";
      }
      contentRevisionRef.current += 1;
      updateState((prev) => ({ ...prev, isDirty: false, savedContent: md, lastSaved: Date.now() }));
      return "written";
    }

    // No path yet — save as
    const result = await saveFileAs(md, snapshot.fileName);
    if (result.status !== "saved") {
      if (snapshot.filePath && stateRef.current.isDirty) {
        scheduleAutoSave(revision, snapshot.filePath);
      }
      return result.status;
    }
    if (
      contentRevisionRef.current !== revision ||
      stateRef.current.filePath !== snapshot.filePath
    ) {
      return "superseded";
    }
    contentRevisionRef.current += 1;
    updateState((prev) => ({
      ...prev,
      filePath: result.path,
      fileName: result.name,
      isDirty: false,
      savedContent: md,
      lastSaved: Date.now(),
    }));
    return "written";
  }, [clearAutoSave, scheduleAutoSave, updateState]);

  const handleSaveAs = useCallback(async (): Promise<SaveOutcome> => {
    const snapshot = stateRef.current;
    const revision = contentRevisionRef.current;
    const md = resolveSaveContent(
      snapshot.isDirty,
      snapshot.savedContent,
      () => getMarkdownRef.current?.() ?? "",
    );
    clearAutoSave();
    const result = await saveFileAs(md, snapshot.fileName);
    if (result.status !== "saved") {
      if (snapshot.filePath && stateRef.current.isDirty) {
        scheduleAutoSave(revision, snapshot.filePath);
      }
      return result.status;
    }
    if (
      contentRevisionRef.current !== revision ||
      stateRef.current.filePath !== snapshot.filePath
    ) {
      return "superseded";
    }
    contentRevisionRef.current += 1;
    updateState((prev) => ({
      ...prev,
      filePath: result.path,
      fileName: result.name,
      isDirty: false,
      savedContent: md,
      lastSaved: Date.now(),
    }));
    return "written";
  }, [clearAutoSave, scheduleAutoSave, updateState]);

  const handleFileSelect = useCallback(async (entry: FileEntry) => {
    if (entry.kind !== "file") return;
    const content = await readFileByPath(entry.path);

    contentRevisionRef.current += 1;
    clearAutoSave();
    setContentRef.current?.(content, dirname(entry.path));
    updateState((prev) => ({
      ...prev,
      fileName: entry.name,
      filePath: entry.path,
      isDirty: false,
      savedContent: content,
      openCount: prev.openCount + 1,
    }));
  }, [clearAutoSave, updateState]);

  const handleNew = useCallback(() => {
    contentRevisionRef.current += 1;
    clearAutoSave();
    setContentRef.current?.("", "");
    updateState((prev) => ({
      fileName: "Untitled",
      filePath: null,
      isDirty: false,
      dirTree: prev.dirTree,
      dirRoot: prev.dirRoot,
      savedContent: "",
      lastSaved: null,
      openCount: prev.openCount + 1,
    }));
  }, [clearAutoSave, updateState]);

  const handleOpenByPath = useCallback(async (filePath: string, preloadedContent?: string) => {
    const content = preloadedContent ?? await readFileByPath(filePath);
    const name = filePath.split(/[/\\]/).pop() ?? "untitled.md";

    contentRevisionRef.current += 1;
    clearAutoSave();
    setContentRef.current?.(content, dirname(filePath));
    updateState((prev) => ({
      ...prev,
      fileName: name,
      filePath,
      isDirty: false,
      savedContent: content,
      openCount: prev.openCount + 1,
    }));
  }, [clearAutoSave, updateState]);

  // Restore state from a tab snapshot — sets editor content + file state without FS reads.
  const restoreState = useCallback(
    (snapshot: {
      fileName: string;
      filePath: string | null;
      content: string;
      isDirty: boolean;
      savedContent: string;
      lastSaved?: number | null;
      /** Cached PM JSON of content's body — restore via this (fast) when present. */
      docJSON?: JSONContent;
    }) => {
      const revision = ++contentRevisionRef.current;
      clearAutoSave();
      setContentRef.current?.(
        snapshot.content,
        snapshot.filePath ? dirname(snapshot.filePath) : "",
        snapshot.docJSON,
        // The arriving buffer's dirty flag — the setContent callback needs it
        // to seed source mode's entry-dirty baseline (a dirty tab arriving in
        // source mode must not inherit the previous tab's entry flag).
        snapshot.isDirty,
      );
      updateState((prev) => ({
        ...prev,
        fileName: snapshot.fileName,
        filePath: snapshot.filePath,
        isDirty: snapshot.isDirty,
        savedContent: snapshot.savedContent,
        lastSaved: snapshot.lastSaved ?? null,
      }));
      if (snapshot.isDirty) scheduleAutoSave(revision, snapshot.filePath);
    },
    [clearAutoSave, scheduleAutoSave, updateState],
  );

  // Re-read the opened folder into the tree (after a create/rename/trash).
  const refreshTree = useCallback(async () => {
    const root = stateRef.current.dirRoot;
    if (!root) return;
    const tree = await readDirTree(root);
    if (stateRef.current.dirRoot !== root) return;
    updateState((prev) => ({ ...prev, dirTree: tree }));
  }, [updateState]);

  // Rename of the ACTIVE file: point state (and the autosave target) at the new
  // path so autosave writes to the new file, never resurrecting a ghost at the
  // old path.
  const updateActiveFilePath = useCallback((newPath: string, newName: string) => {
    const revision = ++contentRevisionRef.current;
    const wasDirty = stateRef.current.isDirty;
    clearAutoSave();
    updateState((prev) => ({ ...prev, filePath: newPath, fileName: newName }));
    if (wasDirty) scheduleAutoSave(revision, newPath);
  }, [clearAutoSave, scheduleAutoSave, updateState]);

  // Trash of the ACTIVE file: detach from disk (filePath -> null) so the autosave
  // effect (gated on filePath) clears its timer and can't recreate the trashed
  // file. Content stays in the editor as an unsaved buffer.
  const detachActiveFile = useCallback(() => {
    contentRevisionRef.current += 1;
    clearAutoSave();
    updateState((prev) => ({ ...prev, filePath: null, isDirty: true }));
  }, [clearAutoSave, updateState]);

  useEffect(() => clearAutoSave, [clearAutoSave]);

  return {
    ...state,
    markDirty,
    markClean,
    handleOpen,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    handleFileSelect,
    handleNew,
    handleOpenByPath,
    registerGetMarkdown,
    registerSetContent,
    getCurrentState,
    restoreState,
    refreshTree,
    updateActiveFilePath,
    detachActiveFile,
  };
}
