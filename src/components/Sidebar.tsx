import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Editor } from "@tiptap/react";
import type { FileEntry } from "@/lib/file-system";
import { pathExists } from "@/lib/file-system";
import type { RecentFile } from "@/hooks/use-recent-files";
import type { HeadingEntry } from "@/lib/section-commands";
import { OutlinePanel } from "@/components/OutlinePanel";

type SidebarTab = "files" | "outline";

export type FileTreeAction = "new-file" | "new-folder" | "rename" | "delete" | "copy-path" | "reveal";

interface SidebarProps {
  tree: FileEntry[];
  activeFile: string;
  activeFilePath: string | null;
  collapsed: boolean;
  editor: Editor | null;
  recentFiles: RecentFile[];
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  heldModifier: "ctrl" | "alt" | null;
  onFileSelect: (entry: FileEntry) => void;
  onOpenFolder: () => void;
  onToggle: () => void;
  onRecentFileSelect: (file: RecentFile) => void;
  /** Remove a single entry from the Recent Files list (× button / auto-prune). */
  onRecentFileRemove: (path: string) => void;
  /** True when the tree is editable (a folder is open in a Tauri build). */
  canEditTree?: boolean;
  onFileAction?: (action: FileTreeAction, entry: FileEntry | null) => void;
  /** Source mode: live headings from the textarea (see OutlinePanel). */
  sourceHeadings?: HeadingEntry[] | null;
  onSourceHeadingClick?: (pos: number) => void;
}

export function Sidebar({
  tree,
  activeFile,
  activeFilePath,
  collapsed,
  editor,
  recentFiles,
  activeTab,
  onTabChange,
  heldModifier,
  onFileSelect,
  onOpenFolder,
  onToggle,
  onRecentFileSelect,
  onRecentFileRemove,
  canEditTree,
  onFileAction,
  sourceHeadings,
  onSourceHeadingClick,
}: SidebarProps) {
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);

  // Flag Recent Files whose target no longer exists on disk (deleted/moved out
  // from under us) so they read as stale; the × button removes any entry. In the
  // browser dev server pathExists() returns true, so nothing is flagged there.
  const [missingRecent, setMissingRecent] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (recentFiles.length === 0) {
      setMissingRecent(new Set());
      return;
    }
    let cancelled = false;
    void (async () => {
      const checks = await Promise.all(
        recentFiles.map(async (f) => [f.path, await pathExists(f.path)] as const),
      );
      if (cancelled) return;
      setMissingRecent(new Set(checks.filter(([, exists]) => !exists).map(([p]) => p)));
    })();
    return () => {
      cancelled = true;
    };
  }, [recentFiles]);
  const openTreeMenu = useCallback(
    (e: ReactMouseEvent, entry: FileEntry | null) => {
      if (!canEditTree) return;
      e.preventDefault();
      e.stopPropagation();
      setTreeMenu({ x: e.clientX, y: e.clientY, entry });
    },
    [canEditTree],
  );
  const runTreeAction = useCallback(
    (action: FileTreeAction) => {
      const entry = treeMenu?.entry ?? null;
      setTreeMenu(null);
      onFileAction?.(action, entry);
    },
    [treeMenu, onFileAction],
  );
  useEffect(() => {
    if (!treeMenu) return;
    const dismiss = () => setTreeMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTreeMenu(null);
    };
    document.addEventListener("click", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, [treeMenu]);

  return (
    <aside className={`markd-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="markd-sidebar-header">
        <div className="markd-sidebar-tabs">
          <button
            className={`markd-sidebar-tab ${activeTab === "files" ? "active" : ""}`}
            onClick={() => onTabChange("files")}
          >
            Recent
            {heldModifier === "alt" && <span className="markd-hotkey-hint">Alt+1</span>}
          </button>
          <button
            className={`markd-sidebar-tab ${activeTab === "outline" ? "active" : ""}`}
            onClick={() => onTabChange("outline")}
          >
            Outline
            {heldModifier === "alt" && <span className="markd-hotkey-hint">Alt+2</span>}
          </button>
        </div>
        <div className="markd-sidebar-actions">
          {activeTab === "files" && (
            <button onClick={onOpenFolder} title="Open Folder">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3H3a1 1 0 0 0-1 1z" />
              </svg>
            </button>
          )}
          <button onClick={onToggle} title="Toggle Sidebar">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10 3L5 8l5 5V3z" />
            </svg>
          </button>
        </div>
      </div>

      {activeFilePath && (
        <div className="markd-sidebar-filepath" title={activeFilePath}>
          {truncatePath(activeFilePath)}
        </div>
      )}

      {activeTab === "files" ? (
        <div className="markd-file-tree" onContextMenu={(e) => openTreeMenu(e, null)}>
          {tree.length === 0 ? (
            recentFiles.length > 0 ? (
              <RecentFilesList
                files={recentFiles}
                onSelect={onRecentFileSelect}
                onRemove={onRecentFileRemove}
                missing={missingRecent}
              />
            ) : (
              <div style={{ padding: "16px", opacity: 0.5, fontSize: 13 }}>
                Open a folder to browse files
              </div>
            )
          ) : (
            <FileTree
              entries={tree}
              activeFile={activeFile}
              onFileSelect={onFileSelect}
              onContext={openTreeMenu}
            />
          )}
        </div>
      ) : (
        <div className="markd-file-tree">
          <OutlinePanel editor={editor} sourceHeadings={sourceHeadings} onSourceHeadingClick={onSourceHeadingClick} />
        </div>
      )}
      {treeMenu && (
        <div
          className="markd-context-menu"
          style={{ left: treeMenu.x, top: treeMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="markd-context-item" onClick={() => runTreeAction("new-file")}>
            New File…
          </button>
          <button className="markd-context-item" onClick={() => runTreeAction("new-folder")}>
            New Folder…
          </button>
          {treeMenu.entry && (
            <>
              <div className="markd-context-separator" />
              <button className="markd-context-item" onClick={() => runTreeAction("copy-path")}>
                Copy Path
              </button>
              <button className="markd-context-item" onClick={() => runTreeAction("reveal")}>
                Reveal in File Explorer
              </button>
              <div className="markd-context-separator" />
              <button className="markd-context-item" onClick={() => runTreeAction("rename")}>
                Rename…
              </button>
              <button className="markd-context-item" onClick={() => runTreeAction("delete")}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function truncatePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length <= 3) return normalized;
  return "…/" + parts.slice(-3).join("/");
}

/* ── Recent Files List ───────────────────────────────────────────── */

export function RecentFilesList({
  files,
  onSelect,
  onRemove,
  missing,
}: {
  files: RecentFile[];
  onSelect: (file: RecentFile) => void;
  onRemove: (path: string) => void;
  /** Paths whose file no longer exists on disk — rendered as stale. */
  missing?: Set<string>;
}) {
  return (
    <div className="markd-recent-files">
      <div className="markd-recent-header">Recent Files</div>
      {files.map((file) => {
        const isMissing = missing?.has(file.path) ?? false;
        return (
          <div
            key={file.path}
            className={`markd-file-item${isMissing ? " markd-recent-missing" : ""}`}
            onClick={() => onSelect(file)}
            title={isMissing ? `${file.path} — file not found (deleted or moved)` : file.path}
            style={{ paddingLeft: 16 }}
          >
            <span className="icon">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 1h7l3 3v11H3V1z" />
                <path d="M10 1v3h3" />
              </svg>
            </span>
            <span className="name">{file.name}</span>
            <span className="markd-file-path-hint">
              {truncatePath(file.path)}
            </span>
            <button
              className="markd-recent-remove"
              aria-label="Remove from recent files"
              title="Remove from recent files"
              onClick={(e) => {
                // Don't let the × bubble to the row's open-on-click handler.
                e.stopPropagation();
                onRemove(file.path);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ── File Tree ───────────────────────────────────────────────────── */

function FileTree({
  entries,
  activeFile,
  onFileSelect,
  onContext,
}: {
  entries: FileEntry[];
  activeFile: string;
  onFileSelect: (entry: FileEntry) => void;
  onContext?: (e: ReactMouseEvent, entry: FileEntry) => void;
}) {
  return (
    <>
      {entries.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          activeFile={activeFile}
          onFileSelect={onFileSelect}
          onContext={onContext}
        />
      ))}
    </>
  );
}

function FileTreeItem({
  entry,
  activeFile,
  onFileSelect,
  onContext,
}: {
  entry: FileEntry;
  activeFile: string;
  onFileSelect: (entry: FileEntry) => void;
  onContext?: (e: ReactMouseEvent, entry: FileEntry) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const handleClick = useCallback(() => {
    if (entry.kind === "directory") {
      setExpanded((e) => !e);
    } else {
      onFileSelect(entry);
    }
  }, [entry, onFileSelect]);

  const isActive = entry.kind === "file" && entry.name === activeFile;

  return (
    <>
      <div
        className={`markd-file-item ${isActive ? "active" : ""}`}
        onClick={handleClick}
        onContextMenu={(e) => onContext?.(e, entry)}
        style={{ paddingLeft: 16 + entry.depth * 16 }}
      >
        <span className="icon">
          {entry.kind === "directory" ? (expanded ? "▾" : "▸") : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 1h7l3 3v11H3V1z" />
              <path d="M10 1v3h3" />
            </svg>
          )}
        </span>
        <span className="name">{entry.name}</span>
      </div>
      {entry.kind === "directory" && expanded && entry.children && (
        <FileTree
          entries={entry.children}
          activeFile={activeFile}
          onFileSelect={onFileSelect}
          onContext={onContext}
        />
      )}
    </>
  );
}
