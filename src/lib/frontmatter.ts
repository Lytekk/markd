// YAML frontmatter is invisible to tiptap-markdown's markdown-it (it runs with
// no plugins), so a leading ---\nkey: val\n--- block parses as a thematic break
// plus headings and getMarkdown() re-emits it as garbled "## key: val" — silently
// corrupting every Obsidian/Hugo/Jekyll file on first save.
//
// We keep frontmatter out of the editor entirely: strip it on load, store it
// verbatim, and re-prepend it byte-for-byte on serialize. The editor never sees
// it, so it can never be normalized or corrupted.

export interface SplitMarkdown {
  /** The frontmatter block including both `---` fences and the trailing newline, or "". */
  frontmatter: string;
  /** Everything after the frontmatter block (unchanged if there was none). */
  body: string;
}

// Opening `---` on line 1, lazy content, then a closing `---` or `...` line.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Split a leading YAML frontmatter block off the markdown, preserving it verbatim. */
export function splitFrontmatter(md: string): SplitMarkdown {
  const match = FRONTMATTER_RE.exec(md);
  if (!match || match.index !== 0) return { frontmatter: "", body: md };
  return {
    frontmatter: md.slice(0, match[0].length),
    body: md.slice(match[0].length),
  };
}

/** Re-attach previously-stripped frontmatter to serialized body markdown. */
export function joinFrontmatter(frontmatter: string, body: string): string {
  return frontmatter ? frontmatter + body : body;
}
