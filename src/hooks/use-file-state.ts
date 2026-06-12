import { useState, useCallback, useRef, useEffect } from "react";
import {
  FileEntry,
  openFile,
  openDirectory,
  readDirTree,
  saveToFile,
  saveFileAs,
  readFileByPath,
} from "@/lib/file-system";

function dirname(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSep >= 0 ? filePath.slice(0, lastSep) : "";
}

const AUTO_SAVE_DELAY_MS = 30_000;

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

export function useFileState() {
  const [state, setState] = useState<FileState>({
    fileName: "Untitled",
    filePath: null,
    isDirty: false,
    dirTree: [],
    dirRoot: null,
    savedContent: "",
    lastSaved: null,
    openCount: 0,
  });

  const getMarkdownRef = useRef<(() => string) | null>(null);
  const setContentRef = useRef<((md: string, fileDir: string) => void) | null>(null);

  const registerGetMarkdown = useCallback((fn: () => string) => {
    getMarkdownRef.current = fn;
  }, []);

  const registerSetContent = useCallback(
    (fn: (md: string, fileDir: string) => void) => {
      setContentRef.current = fn;
    },
    [],
  );

  const markDirty = useCallback(() => {
    setState((prev) => (prev.isDirty ? prev : { ...prev, isDirty: true }));
  }, []);

  // Inverse of markDirty — used when the buffer returns to the saved state
  // (Ctrl+Z back to the last save), so the dirty indicator can clear without
  // an actual save.
  const markClean = useCallback(() => {
    setState((prev) => (prev.isDirty ? { ...prev, isDirty: false } : prev));
  }, []);

  const handleOpen = useCallback(async () => {
    const result = await openFile();
    if (!result) return;

    setContentRef.current?.(result.content, dirname(result.path));
    setState((prev) => ({
      ...prev,
      fileName: result.name,
      filePath: result.path,
      isDirty: false,
      savedContent: result.content,
      openCount: prev.openCount + 1,
    }));
  }, []);

  const handleOpenFolder = useCallback(async () => {
    const result = await openDirectory();
    if (!result) return;
    setState((prev) => ({
      ...prev,
      dirTree: result.tree,
      dirRoot: result.path,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    const md = getMarkdownRef.current?.() ?? "";

    if (state.filePath) {
      const ok = await saveToFile(state.filePath, md);
      if (ok) setState((prev) => ({ ...prev, isDirty: false, savedContent: md, lastSaved: Date.now() }));
      return ok;
    }

    // No path yet — save as
    const result = await saveFileAs(md, state.fileName);
    if (result) {
      setState((prev) => ({
        ...prev,
        filePath: result.path,
        fileName: result.name,
        isDirty: false,
        savedContent: md,
        lastSaved: Date.now(),
      }));
      return true;
    }
    return false;
  }, [state.filePath, state.fileName]);

  const handleSaveAs = useCallback(async () => {
    const md = getMarkdownRef.current?.() ?? "";
    const result = await saveFileAs(md, state.fileName);
    if (result) {
      setState((prev) => ({
        ...prev,
        filePath: result.path,
        fileName: result.name,
        isDirty: false,
        savedContent: md,
        lastSaved: Date.now(),
      }));
    }
  }, [state.fileName]);

  const handleFileSelect = useCallback(async (entry: FileEntry) => {
    if (entry.kind !== "file") return;
    const content = await readFileByPath(entry.path);

    setContentRef.current?.(content, dirname(entry.path));
    setState((prev) => ({
      ...prev,
      fileName: entry.name,
      filePath: entry.path,
      isDirty: false,
      savedContent: content,
      openCount: prev.openCount + 1,
    }));
  }, []);

  const handleNew = useCallback(() => {
    setContentRef.current?.("", "");
    setState((prev) => ({
      fileName: "Untitled",
      filePath: null,
      isDirty: false,
      dirTree: prev.dirTree,
      dirRoot: prev.dirRoot,
      savedContent: "",
      lastSaved: null,
      openCount: prev.openCount + 1,
    }));
  }, []);

  const handleOpenByPath = useCallback(async (filePath: string, preloadedContent?: string) => {
    const content = preloadedContent ?? await readFileByPath(filePath);
    const name = filePath.split(/[/\\]/).pop() ?? "untitled.md";

    setContentRef.current?.(content, dirname(filePath));
    setState((prev) => ({
      ...prev,
      fileName: name,
      filePath,
      isDirty: false,
      savedContent: content,
      openCount: prev.openCount + 1,
    }));
  }, []);

  // Restore state from a tab snapshot — sets editor content + file state without FS reads.
  const restoreState = useCallback(
    (snapshot: {
      fileName: string;
      filePath: string | null;
      content: string;
      isDirty: boolean;
      savedContent: string;
      lastSaved?: number | null;
    }) => {
      setContentRef.current?.(snapshot.content, snapshot.filePath ? dirname(snapshot.filePath) : "");
      setState((prev) => ({
        ...prev,
        fileName: snapshot.fileName,
        filePath: snapshot.filePath,
        isDirty: snapshot.isDirty,
        savedContent: snapshot.savedContent,
        lastSaved: snapshot.lastSaved ?? null,
      }));
    },
    [],
  );

  // Re-read the opened folder into the tree (after a create/rename/trash).
  const refreshTree = useCallback(async () => {
    if (!state.dirRoot) return;
    const tree = await readDirTree(state.dirRoot);
    setState((prev) => ({ ...prev, dirTree: tree }));
  }, [state.dirRoot]);

  // Rename of the ACTIVE file: point state (and the autosave target) at the new
  // path so autosave writes to the new file, never resurrecting a ghost at the
  // old path.
  const updateActiveFilePath = useCallback((newPath: string, newName: string) => {
    setState((prev) => ({ ...prev, filePath: newPath, fileName: newName }));
  }, []);

  // Trash of the ACTIVE file: detach from disk (filePath -> null) so the autosave
  // effect (gated on filePath) clears its timer and can't recreate the trashed
  // file. Content stays in the editor as an unsaved buffer.
  const detachActiveFile = useCallback(() => {
    setState((prev) => ({ ...prev, filePath: null, isDirty: true }));
  }, []);

  // Auto-save: debounce 30s after last edit, only if file has a path
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    if (state.isDirty && state.filePath) {
      autoSaveTimerRef.current = setTimeout(async () => {
        const md = getMarkdownRef.current?.() ?? "";
        const ok = await saveToFile(state.filePath!, md);
        if (ok) {
          setState((prev) => ({
            ...prev,
            isDirty: false,
            savedContent: md,
            lastSaved: Date.now(),
          }));
        }
      }, AUTO_SAVE_DELAY_MS);
    }

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [state.isDirty, state.filePath]);

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
    restoreState,
    refreshTree,
    updateActiveFilePath,
    detachActiveFile,
  };
}
