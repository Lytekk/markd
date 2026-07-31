import { useState, useCallback } from "react";
import { samePath } from "@/lib/path-identity";

export interface RecentFile {
  name: string;
  path: string;
  timestamp: number;
}

const STORAGE_KEY = "markd-recent-files";
const MAX_RECENT = 10;

function loadRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentFile[];
    return parsed.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function persistRecentFiles(files: RecentFile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
}

export function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(loadRecentFiles);

  const addRecentFile = useCallback((name: string, path: string) => {
    setRecentFiles((prev) => {
      // Dedup by file identity, not by spelling: the native layer and a file
      // dialog name one file differently, which used to add a second row.
      const filtered = prev.filter((f) => !samePath(f.path, path));
      const updated = [{ name, path, timestamp: Date.now() }, ...filtered].slice(0, MAX_RECENT);
      persistRecentFiles(updated);
      return updated;
    });
  }, []);

  // Drop a single entry — used by the Recent Files × button and to auto-prune
  // an entry whose file we discover is gone on open/existence-check.
  const removeRecentFile = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const updated = prev.filter((f) => !samePath(f.path, path));
      persistRecentFiles(updated);
      return updated;
    });
  }, []);

  const getRecentFiles = useCallback((): RecentFile[] => {
    return recentFiles;
  }, [recentFiles]);

  const clearRecentFiles = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setRecentFiles([]);
  }, []);

  return { recentFiles, addRecentFile, removeRecentFile, getRecentFiles, clearRecentFiles };
}
