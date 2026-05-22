export interface OutlineHeading {
  id: string;
  level: number;
}

export function hasChildren(headings: OutlineHeading[], index: number): boolean {
  const current = headings[index];
  const next = headings[index + 1];
  if (!current || !next) return false;
  return next.level > current.level;
}

export function computeHiddenSet(
  headings: OutlineHeading[],
  collapsedIds: Set<string>,
): Set<number> {
  const hidden = new Set<number>();
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    if (!collapsedIds.has(heading.id)) continue;
    // Hide every following heading until we reach one at heading.level or shallower
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level <= heading.level) break;
      hidden.add(j);
    }
  }
  return hidden;
}
