/**
 * Resolve the active heading index from the scroll-spy candidate, forcing the
 * first heading at the very top of the document and the last at the very
 * bottom. Pure (no DOM) so the edge behavior is unit-tested independently of
 * layout. `candidate` is the index chosen by the 40%-viewport-line rule.
 *
 * Lives in its own module (not OutlinePanel.tsx) so that the component file is a
 * single-component export — a mixed component + function export breaks React
 * Fast Refresh, which silently stops applying HMR edits to OutlinePanel.
 */
export function clampActiveHeading(
  candidate: number,
  count: number,
  atTop: boolean,
  atBottom: boolean,
): number {
  if (count === 0) return 0;
  if (atTop) return 0;
  if (atBottom) return count - 1;
  return candidate;
}
