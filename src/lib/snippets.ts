// Customizable text snippets ("typed shortcuts"). A snippet is a {trigger,label,
// body} where the markdown `body` is inserted at the caret. An optional single
// `$1` marks where the caret lands afterward; the dynamic tokens {{date}},
// {{time}}, {{datetime}} are resolved at insert time.
//
// Persistence is a versioned localStorage envelope ({v,snippets}); loadSnippets
// NEVER throws — it falls back to the defaults on any corruption, the same
// fail-to-safe lesson as the swallowed-updater incident. Insertion mechanics
// live in snippet-insert.ts (kept separate so this stays pure + trivially
// testable). DEFAULT_SNIPPETS deliberately keeps every $1 in a TEXT position:
// $1 as a link href / image attr / code-fence language becomes an HTML attribute
// the insert sentinel can't recover, and a leading `---` (frontmatter) corrupts
// into <hr> + a Setext <h2> when inserted mid-document — both verified.

export interface Snippet {
  id: string;
  /** Short searchable handle shown as the row hint. */
  trigger: string;
  /** Primary picker label. */
  label: string;
  /** Markdown inserted at the caret; one optional `$1` caret marker. */
  body: string;
}

export const SNIPPETS_VERSION = 1;
export const SNIPPETS_KEY = "markd-snippets";

export const DEFAULT_SNIPPETS: Snippet[] = [
  { id: "h1", trigger: "h1", label: "Heading 1", body: "# $1" },
  { id: "h2", trigger: "h2", label: "Heading 2", body: "## $1" },
  {
    id: "table",
    trigger: "table",
    label: "Table (3×3)",
    body: "| $1 | Column | Column |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |",
  },
  { id: "todo", trigger: "todo", label: "Task item", body: "- [ ] $1" },
  { id: "note", trigger: "note", label: "Note callout", body: "> **Note:** $1" },
  { id: "code", trigger: "code", label: "Code block", body: "```\n$1\n```" },
  // No $1 here: $1 as the SOLE link text collapses to an empty (caret-less) mark
  // in ProseMirror. Ship visible placeholder text the user types over instead.
  { id: "link", trigger: "link", label: "Link", body: "[text](https://)" },
  { id: "date", trigger: "date", label: "Today's date", body: "{{date}}" },
  { id: "now", trigger: "now", label: "Date + time", body: "{{datetime}}" },
  { id: "sig", trigger: "sig", label: "Signature", body: "*— {{date}}*" },
];

/** Resolve dynamic tokens. `now` is injectable for deterministic tests. */
export function resolveTokens(body: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  // datetime first so its inner {{date}}/{{time}} aren't double-substituted.
  return body
    .replace(/\{\{datetime\}\}/g, `${date} ${time}`)
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{time\}\}/g, time);
}

/** Returns an error message, or null if the snippet is valid. Body may be empty. */
export function validateSnippet(s: { trigger: string; label: string; body: string }): string | null {
  if (!s.trigger.trim()) return "Trigger is required.";
  if (s.trigger.length > 24) return "Trigger must be 24 characters or fewer.";
  if (!s.label.trim()) return "Label is required.";
  return null;
}

interface SnippetEnvelope {
  v: number;
  snippets: Snippet[];
}

function isSnippet(x: unknown): x is Snippet {
  const s = x as Snippet;
  return (
    !!s &&
    typeof s === "object" &&
    typeof s.id === "string" &&
    typeof s.trigger === "string" &&
    typeof s.label === "string" &&
    typeof s.body === "string"
  );
}

/**
 * Load snippets, never throwing. Key absent → defaults (first run). Present but
 * empty → [] (the user intentionally cleared them; do NOT resurrect defaults).
 * Corrupt / non-array → defaults. Malformed entries are dropped.
 */
export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(SNIPPETS_KEY);
    if (raw == null) return DEFAULT_SNIPPETS.slice();
    const parsed: unknown = JSON.parse(raw);
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as SnippetEnvelope | null)?.snippets;
    if (!Array.isArray(arr)) return DEFAULT_SNIPPETS.slice();
    return arr.filter(isSnippet);
  } catch {
    return DEFAULT_SNIPPETS.slice();
  }
}

/** Persist snippets in a versioned envelope. Fails to console, never throws. */
export function saveSnippets(snippets: Snippet[]): void {
  try {
    const env: SnippetEnvelope = { v: SNIPPETS_VERSION, snippets };
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(env));
  } catch (err) {
    console.error("markd: failed to persist snippets", err);
  }
}
