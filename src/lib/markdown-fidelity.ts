import Text from "@tiptap/extension-text";
import Code from "@tiptap/extension-code";
import { MarkdownSerializerState } from "prosemirror-markdown";

/**
 * Round-trip fidelity layer over the tiptap-markdown serialize pipeline.
 *
 * A markdown editor's save must not rewrite source it didn't touch. Two
 * upstream behaviors broke that (user-reported, reproduced in
 * markdown-fidelity.test.ts):
 *
 * 1. tiptap-markdown's text rule HTML-entity-escapes every `<`/`>` in plain
 *    text (`a < b` → `a &lt; b`) — see its src/extensions/nodes/text.js.
 * 2. prosemirror-markdown's `esc()` escapes every `` ` * \ ~ [ ] _ ``
 *    occurrence whether or not it could re-parse as markup (`~30` → `\~30`,
 *    `5 * 3` → `5 \* 3`).
 *
 * The policy here escapes only what would actually change meaning on the
 * next parse (CommonMark flanking rules); over-escaping is the diff-churn
 * we're eliminating, under-escaping would be semantic drift — the tests
 * pin both directions.
 */

/** Minimal context-aware markdown escaping (replaces prosemirror-markdown esc). */
export function minimalMarkdownEscape(
  str: string,
  startOfLine = false,
  extra: RegExp | null = null,
): string {
  let out = str.replace(/[`*\\~\[\]_]/g, (m, i: number) =>
    shouldEscape(str, i) ? "\\" + m : m,
  );
  if (startOfLine) {
    // Same line-start rules as prosemirror-markdown: bullets, blockquotes,
    // headings and ordered-list markers ARE markup at column 0.
    out = out
      .replace(/^(\+[ ]|[\-*>])/, "\\$&")
      .replace(/^(\s*)(#{1,6})(\s|$)/, "$1\\$2$3")
      .replace(/^(\s*\d+)\.\s/, "$1\\. ");
  }
  if (extra) out = out.replace(extra, "\\$&");
  return out;
}

function shouldEscape(str: string, i: number): boolean {
  const ch = str[i]!;
  // Backtick opens code anywhere; backslash starts an escape. Always escape.
  if (ch === "`" || ch === "\\") return true;
  // `[` opens a link/reference ONLY when a later `]` is immediately followed by
  // `(` (inline link) or `[` (reference). Bare prose brackets — `[F#282]`,
  // `[[wiki]]`, `[1.981,4.039]` — render literally, so escaping every `[` was
  // pure diff-churn that damaged journal/spec docs on every save. (markd
  // round-trip damage, repaired 2026-06-15.)
  if (ch === "[") return /\]\(|\]\[/.test(str.slice(i));
  // `]` stays inert: any link-OPENING `[` is escaped above, so no `]` can close
  // a link.
  if (ch === "]") return false;
  // A single `~` is plain text; only `~~` opens strikethrough.
  if (ch === "~") return str[i - 1] === "~" || str[i + 1] === "~";
  // `*` / `_`: per CommonMark a delimiter followed/preceded by whitespace on
  // both sides can never open or close emphasis. String edges count as
  // unknown (the adjacent inline node could supply a flank) → escape.
  const prev = i > 0 ? str[i - 1]! : null;
  const next = i + 1 < str.length ? str[i + 1]! : null;
  if (ch === "_" && prev?.match(/\w/) && next?.match(/\w/)) return false; // intraword _
  const prevWs = prev !== null && /\s/.test(prev);
  const nextWs = next !== null && /\s/.test(next);
  return !(prevWs && nextWs);
}

let escapingApplied = false;

/**
 * Swap prosemirror-markdown's esc() for the minimal policy. A prototype
 * patch (not a subclass) because tiptap-markdown instantiates its own state
 * class internally and exports neither it nor its serializer; pnpm resolves
 * a single shared prosemirror-markdown instance (verified), so the patch
 * reaches tiptap-markdown's subclass via inheritance. Idempotent.
 */
export function applyMinimalEscaping(): void {
  if (escapingApplied) return;
  escapingApplied = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (MarkdownSerializerState.prototype as any).esc = function (
    this: { options?: { escapeExtraCharacters?: RegExp } },
    str: string,
    startOfLine = false,
  ): string {
    return minimalMarkdownEscape(str, startOfLine, this.options?.escapeExtraCharacters ?? null);
  };
}

/**
 * Text node whose markdown serialize rule does NOT HTML-entity-escape.
 * Overrides tiptap-markdown's default via getMarkdownSpec's
 * `{...default, ...extensionStorage}` precedence. Writing `<` literally is
 * correct for source fidelity: `< ` in prose isn't a valid tag start, and
 * actual raw tags were already dropped at parse time (separate known issue).
 */
export const FaithfulText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: { text: string }) {
          state.text(node.text);
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});

/**
 * Code mark that can coexist with bold/italic. The stock tiptap Code mark
 * `excludes` everything, making `**bold `code` bold**` unrepresentable —
 * parsing it dropped bold around the code span and serialization split the
 * strong mark into alternating spans.
 */
export const FaithfulCode = Code.extend({
  excludes: "",
});

/**
 * Preserve the source file's trailing-newline convention (the serializer
 * always emits none). Never-saved buffers default to the POSIX trailing
 * newline; an empty buffer stays a genuinely empty file.
 */
export function ensureTrailingNewline(md: string, reference: string): string {
  if (md === "") return "";
  const wantsNewline = reference === "" || reference.endsWith("\n");
  if (wantsNewline && !md.endsWith("\n")) return md + "\n";
  return md;
}

/**
 * Preserve the source file's line-ending convention. The serializer emits LF
 * only; a CRLF-authored file would otherwise have every line ending rewritten
 * on its first dirty save.
 */
export function matchLineEndings(md: string, reference: string): string {
  if (!reference.includes("\r\n")) return md;
  // Normalize first so pre-existing CRLF isn't doubled, then convert.
  return md.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

/**
 * What save should write. A clean buffer means the doc still equals
 * savedContent — write those bytes VERBATIM and never re-serialize (the
 * serializer normalizes markdown; an untouched file must produce an empty
 * diff). Only a dirty buffer serializes, conformed to the source file's
 * trailing-newline and line-ending conventions.
 */
export function resolveSaveContent(
  isDirty: boolean,
  savedContent: string,
  serialize: () => string,
): string {
  if (!isDirty) return savedContent;
  return matchLineEndings(ensureTrailingNewline(serialize(), savedContent), savedContent);
}
