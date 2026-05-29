// Pure tab-display helpers shared by the tab strip (TabBar) and the quick-switch
// overlay (TabSwitcher). Keeping the dedup / parent-dir / MRU-ordering logic here
// (rather than inline in each component) is the single source of truth the
// critique called for — TabBar and the switcher must disambiguate identically.

import type { FileTab } from "@/hooks/use-file-tabs";

export interface TabDisplay {
  fileName: string;
  /** Last path segment's parent dir, shown ONLY to disambiguate same-named tabs. */
  parentDir: string | null;
  isDirty: boolean;
}

/**
 * Per-tab display info. `parentDir` is populated only when another open tab
 * shares the same `fileName` AND this tab has a real path — mirroring TabBar's
 * existing rule so the two surfaces stay consistent.
 */
export function tabDisplayInfo(tabs: FileTab[]): Map<string, TabDisplay> {
  const nameCounts = new Map<string, number>();
  for (const t of tabs) {
    nameCounts.set(t.fileName, (nameCounts.get(t.fileName) ?? 0) + 1);
  }
  const out = new Map<string, TabDisplay>();
  for (const t of tabs) {
    const isDuplicate = (nameCounts.get(t.fileName) ?? 0) > 1 && !!t.filePath;
    const parentDir = isDuplicate
      ? (t.filePath!.replace(/\\/g, "/").split("/").slice(-2, -1)[0] ?? null)
      : null;
    out.set(t.id, { fileName: t.fileName, parentDir, isDirty: t.isDirty });
  }
  return out;
}

/**
 * Order tabs most-recently-active first using `mruIds` (most-recent first). Tabs
 * absent from the MRU list keep their original tab order at the end; stale MRU
 * ids with no matching tab are ignored.
 */
export function orderTabsByMru(tabs: FileTab[], mruIds: string[]): FileTab[] {
  const rank = new Map<string, number>();
  mruIds.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const seen = tabs
    .filter((t) => rank.has(t.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const unseen = tabs.filter((t) => !rank.has(t.id));
  return [...seen, ...unseen];
}

/**
 * Ordering for the quick-switch list: the current and previously-active tabs are
 * swapped so opening the switcher and pressing Enter immediately toggles to the
 * previous tab (Alt-Tab semantics). The remaining tabs stay in MRU order.
 */
export function switcherOrder(tabs: FileTab[], mruIds: string[]): FileTab[] {
  const mru = orderTabsByMru(tabs, mruIds);
  if (mru.length < 2) return mru;
  return [mru[1]!, mru[0]!, ...mru.slice(2)];
}
