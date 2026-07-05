import type { SearchOptions } from "@/lib/search-and-replace";

/**
 * Plain-string search core, shared with the ProseMirror extension: ONE regex
 * builder (case / whole-word / user-regex semantics) drives both the rendered
 * editor's findMatches and the source-mode textarea backend, so the two modes
 * can never drift on what "a match" means.
 */

export interface TextRange {
  start: number;
  end: number;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSearchRegex(
  opts: SearchOptions,
): { regex: RegExp | null; error: string | null } {
  try {
    const flags = opts.caseSensitive ? "g" : "gi";
    if (opts.useRegex) return { regex: new RegExp(opts.searchTerm, flags), error: null };
    if (opts.wholeWord) {
      return { regex: new RegExp(`\\b${escapeRegex(opts.searchTerm)}\\b`, flags), error: null };
    }
    return { regex: new RegExp(escapeRegex(opts.searchTerm), flags), error: null };
  } catch (e) {
    return { regex: null, error: e instanceof Error ? e.message : "Invalid regex" };
  }
}

export function findTextRanges(
  text: string,
  opts: SearchOptions,
): { results: TextRange[]; error: string | null } {
  if (!opts.searchTerm) return { results: [], error: null };
  const { regex, error } = buildSearchRegex(opts);
  if (!regex) return { results: [], error };

  const results: TextRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      // Zero-length match (e.g. /a*/): step past it or exec loops forever.
      regex.lastIndex++;
      continue;
    }
    results.push({ start: match.index, end: match.index + match[0].length });
  }
  return { results, error: null };
}

/** Replace every range (assumed sorted ascending, non-overlapping) in one pass. */
export function replaceAllRanges(
  text: string,
  ranges: TextRange[],
  replacement: string,
): string {
  let out = "";
  let cursor = 0;
  for (const r of ranges) {
    out += text.slice(cursor, r.start) + replacement;
    cursor = r.end;
  }
  return out + text.slice(cursor);
}

/** The \w-word under `index`, for Ctrl+F3 search-word-under-caret seeding. */
export function wordAt(text: string, index: number): string {
  let start = Math.min(index, text.length);
  let end = start;
  while (start > 0 && /\w/.test(text[start - 1]!)) start--;
  while (end < text.length && /\w/.test(text[end]!)) end++;
  return text.slice(start, end);
}
