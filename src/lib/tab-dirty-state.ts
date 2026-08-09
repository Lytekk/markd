export interface DirtyTabLike {
  id: string;
  isDirty: boolean;
}

/**
 * React mirrors active-buffer dirtiness into the tab snapshot in an effect.
 * Destructive actions can arrive before that render/effect; the synchronous
 * file-state ref is therefore authoritative for the active tab.
 */
export function tabIsLiveDirty(
  tab: DirtyTabLike,
  activeTabId: string,
  activeBufferDirty: boolean,
): boolean {
  return tab.isDirty || (tab.id === activeTabId && activeBufferDirty);
}

export function liveDirtyTabs<T extends DirtyTabLike>(
  tabs: readonly T[],
  activeTabId: string,
  activeBufferDirty: boolean,
): T[] {
  return tabs.filter((tab) => tabIsLiveDirty(tab, activeTabId, activeBufferDirty));
}
