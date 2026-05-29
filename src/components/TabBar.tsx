import type { FileTab } from "@/hooks/use-file-tabs";
import { tabDisplayInfo } from "@/lib/tab-display";

interface TabBarProps {
  tabs: FileTab[];
  activeTabId: string;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onNewTab,
}: TabBarProps) {
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
              className={`markd-tab ${tab.id === activeTabId ? "active" : ""}`}
              onClick={() => onSwitchTab(tab.id)}
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
                {tab.isDirty ? `${tab.fileName} •` : tab.fileName}
              </span>
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
    </div>
  );
}
