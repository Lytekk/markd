import type { HeadingEntry } from "@/lib/section-commands";

/**
 * Headings parsed from RAW markdown for the source-mode outline (the PM doc
 * is stale there — see source-truth.ts). ATX only, CommonMark-flavored:
 * up to 3 leading spaces, 1-6 hashes, fenced code blocks skipped (a closing
 * fence must match the opening char and be at least as long), closing hash
 * sequences stripped, empty headings dropped (extractHeadings parity).
 * `pos` is the heading line's START offset in the given body — the textarea
 * jump target. Ids are offset-based like PM's `heading-${pos}` scheme.
 */
export function extractSourceHeadings(body: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  let offset = 0;
  let fence: { char: string; len: number } | null = null;
  // Previous plain-text line — the candidate text for a setext underline.
  // Reset by blanks, ATX headings, fences, underline-shaped lines and a
  // consumed setext, so `---` reads as an hr unless real text precedes it.
  let prev: { text: string; offset: number } | null = null;

  for (const line of body.split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const char = fenceMatch[1]![0]!;
      const len = fenceMatch[1]!.length;
      if (!fence) {
        fence = { char, len };
      } else if (char === fence.char && len >= fence.len && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) {
        fence = null;
      }
      prev = null;
    } else if (!fence) {
      const atx = /^ {0,3}(#{1,6})(?:\s+(.*))?$/.exec(line);
      const underline = /^ {0,3}(=+|-+)\s*$/.exec(line);
      if (atx) {
        const text = (atx[2] ?? "").replace(/\s+#+\s*$/, "").trim();
        if (text) {
          headings.push({ id: `src-${offset}`, level: atx[1]!.length, text, pos: offset });
        }
        prev = null;
      } else if (underline && prev) {
        // Setext: `=` underline → h1, `-` underline → h2, anchored at the
        // TEXT line (jump target parity with the rendered outline).
        const text = prev.text.trim();
        if (text) {
          headings.push({
            id: `src-${prev.offset}`,
            level: underline[1]![0] === "=" ? 1 : 2,
            text,
            pos: prev.offset,
          });
        }
        prev = null;
      } else {
        prev = !underline && line.trim() ? { text: line, offset } : null;
      }
    }
    offset += line.length + 1;
  }
  return headings;
}
