// Quick-switch overlay (Ctrl+Shift+E): a fuzzy list of open tabs for fast
// switching when many are open. It reuses CommandPalette as a generic fuzzy-list
// shell (renderItem decorates each row with a dirty dot + disambiguating parent
// dir). Tabs are ordered most-recently-active first with the current/previous
// pair swapped, so a bare open + Enter toggles to the previous tab (Alt-Tab).
//
// Switching MUST route through the caller's onSwitch (App.tsx handleSwitchTab) —
// never useFileTabs.switchTab directly — so disk-hydration, scroll restore, and
// the source-mode commit all run.

import { useMemo } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import type { Command } from "@/lib/command-palette";
import type { FileTab } from "@/hooks/use-file-tabs";
import { tabDisplayInfo, switcherOrder } from "@/lib/tab-display";

interface TabSwitcherProps {
  open: boolean;
  tabs: FileTab[];
  /** Reads the session MRU id list (most-recent first) at open time. */
  getMru: () => string[];
  onSwitch: (id: string) => void;
  onClose: () => void;
}

export function TabSwitcher({ open, tabs, getMru, onSwitch, onClose }: TabSwitcherProps) {
  const display = useMemo(() => tabDisplayInfo(tabs), [tabs]);
  // MRU is read only when the overlay opens, so the order reflects the moment of
  // invocation (not stale render-time state).
  const ordered = useMemo(
    () => (open ? switcherOrder(tabs, getMru()) : []),
    [open, tabs, getMru],
  );

  const commands: Command[] = ordered.map((t) => ({
    id: t.id,
    label: t.fileName,
    // Parent dir goes into the search haystack (keywords), not the label, so the
    // fuzzy matcher scores against names + dirs without polluting the visible row.
    keywords: display.get(t.id)?.parentDir ?? "",
    run: () => onSwitch(t.id),
  }));

  const renderItem = (command: Command) => {
    const d = display.get(command.id);
    return (
      <>
        <span className="markd-tab-switcher-main">
          <span className={`markd-tab-switcher-dot${d?.isDirty ? " dirty" : ""}`} aria-hidden="true" />
          <span className="markd-command-label">{command.label}</span>
        </span>
        {d?.parentDir && <span className="markd-tab-switcher-dir">{d.parentDir}</span>}
      </>
    );
  };

  return (
    <CommandPalette
      open={open}
      commands={commands}
      onClose={onClose}
      renderItem={renderItem}
      placeholder="Search tabs by name…"
      label="Switch tab"
    />
  );
}
