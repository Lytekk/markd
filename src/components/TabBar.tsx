import { useState, useEffect, useCallback } from "react";
import type { FileTab } from "@/hooks/use-file-tabs";
import { tabDisplayInfo } from "@/lib/tab-display";

export type TabAction = "copy-path" | "copy-name" | "reveal" | "close";

interface TabBarProps {
  tabs: FileTab[];
  activeTabId: string;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  /** Right-click context-menu actions (copy path / name, reveal, close). */
  onTabAction?: (action: TabAction, tab: FileTab) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onNewTab,
  onTabAction,
}: TabBarProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; tab: FileTab } | null>(null);

  // Dismiss the context menu on any outside click / another right-click / Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const run = useCallback(
    (action: TabAction) => {
      if (menu) onTabAction?.(action, menu.tab);
      setMenu(null);
    },
    [menu, onTabAction],
  );

  if (tabs.length <= 1 && !tabs[0]?.filePath && !tabs[0]?.isDirty) return null;

  // Shared with the quick-switch overlay so both disambiguate same-named tabs
  // identically (single source of truth — see src/lib/tab-display.ts).
  const display = tabDisplayInfo(tabs);

  return (
    <div className="markd-tab-bar">
      <div className="markd-tab-list">
        {tabs.map((tab) => {
          const parentDir = display.get(tab.id)?.parentDir ?? null;

          return (
            <div
              key={tab.id}
              className={`markd-tab ${tab.id === activeTabId ? "active" : ""} ${tab.isDirty ? "dirty" : ""}`}
              onClick={() => onSwitchTab(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, tab });
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              title={tab.filePath ?? tab.fileName}
            >
              <span className="markd-tab-name">
                {parentDir && (
                  <span className="markd-tab-dir">{parentDir}/</span>
                )}
                {tab.fileName}
              </span>
              {tab.isDirty && (
                <span
                  className="markd-tab-dirty-dot"
                  title="Unsaved changes"
                  aria-label="Unsaved changes"
                />
              )}
              <button
                className="markd-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                title="Close"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="markd-tab-new"
        onClick={onNewTab}
        title="New Tab"
      >
        +
      </button>

      {menu && (
        <div
          className="markd-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.tab.filePath && (
            <button className="markd-context-item" onClick={() => run("copy-path")}>
              Copy Full Path
            </button>
          )}
          <button className="markd-context-item" onClick={() => run("copy-name")}>
            Copy File Name
          </button>
          {menu.tab.filePath && (
            <button className="markd-context-item" onClick={() => run("reveal")}>
              Reveal in File Explorer
            </button>
          )}
          <div className="markd-context-separator" />
          <button className="markd-context-item" onClick={() => run("close")}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
