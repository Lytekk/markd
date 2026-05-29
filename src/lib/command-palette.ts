// Command palette model + matching.
//
// The palette is a fuzzy-searchable overlay over actions that already exist as
// handlers in App.tsx (new/open/save, theme, source view, headings, …). The
// registry is assembled there so there is a single source of truth for each
// action; this module only owns the Command shape and the pure ranking used to
// filter it. Keeping the matcher pure makes it directly unit-testable.

export interface Command {
  id: string;
  label: string;
  /** Extra search terms not shown in the label (synonyms, mode names). */
  keywords?: string;
  /** Short right-aligned hint, e.g. a keyboard shortcut. */
  hint?: string;
  // `void` return so chain commands (boolean) and async handlers (Promise)
  // both assign here via TS's void-return rule, without per-command wrapping.
  run: () => void;
}

/**
 * Score `text` against `query`. Higher is better; null means no match.
 * A contiguous substring beats an in-order subsequence; an earlier match
 * beats a later one; fewer skipped characters beats more.
 */
function scoreMatch(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;

  const idx = t.indexOf(q);
  if (idx !== -1) return 1000 - idx; // substring: earlier position ranks higher

  // Fall back to an in-order subsequence match, penalised by skipped chars.
  let ti = 0;
  let qi = 0;
  let skipped = 0;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) qi++;
    else skipped++;
    ti++;
  }
  return qi === q.length ? 500 - skipped : null;
}

/**
 * Filter + rank commands for the given query. An empty/whitespace query
 * returns the full list in its original order. Ties preserve original order
 * (stable) so the registry's intentional ordering shows through.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim();
  if (!q) return commands.slice();

  const scored: { command: Command; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const haystack = command.keywords ? `${command.label} ${command.keywords}` : command.label;
    const score = scoreMatch(haystack, q);
    if (score !== null) scored.push({ command, score, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.command);
}
