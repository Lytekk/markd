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

// CommonMark delimiter-run flanking. ASCII punctuation only — treating Unicode
// punctuation as non-punct merely makes flanking MORE permissive (errs toward
// escaping), which is the safe direction; it never under-escapes.
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const isWs = (c: string | null): boolean => c !== null && /\s/.test(c);
const isPunct = (c: string | null): boolean => c !== null && ASCII_PUNCT.test(c);

/** Left-flanking: not followed by ws, and (not followed by punct OR preceded by ws/punct/edge). */
function leftFlanking(prev: string | null, next: string | null): boolean {
  if (next === null || isWs(next)) return false;
  return !isPunct(next) || prev === null || isWs(prev) || isPunct(prev);
}
/** Right-flanking: not preceded by ws, and (not preceded by punct OR followed by ws/punct/edge). */
function rightFlanking(prev: string | null, next: string | null): boolean {
  if (prev === null || isWs(prev)) return false;
  return !isPunct(prev) || next === null || isWs(next) || isPunct(next);
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
  // `*` / `_`: a LITERAL delimiter in a text node only re-parses as emphasis if
  // it can flank (CommonMark) AND a matching partner delimiter exists to pair
  // with. A lone glob/path/math delimiter — `r3-*.md`, `entry*(1-pct)`, `a_b`
  // — has no partner, so escaping it was pure churn that damaged spec/journal
  // docs on every save. (markd round-trip damage, repaired 2026-06-15.) esc()
  // only ever sees text-node content; real emphasis the user typed is stored
  // as an Em node (its delimiters gone), so any `*`/`_` here is a literal whose
  // escape exists solely to block accidental re-parse.
  const prev = i > 0 ? str[i - 1]! : null;
  const next = i + 1 < str.length ? str[i + 1]! : null;
  const lf = leftFlanking(prev, next);
  const rf = rightFlanking(prev, next);
  // `_` carries CommonMark's intraword exception (open needs a non-right-flank
  // or leading punct; close needs a non-left-flank or trailing punct) so
  // `snake_case` never escapes; `*` opens/closes on bare flanking.
  const canOpen = ch === "_" ? lf && (!rf || isPunct(prev)) : lf;
  const canClose = ch === "_" ? rf && (!lf || isPunct(next)) : rf;
  if (!canOpen && !canClose) return false; // cannot participate in emphasis
  // At a string edge the partner could live in the adjacent inline node — be
  // safe and escape (cross-node emphasis must not silently form on re-parse).
  if (prev === null || next === null) return true;
  // Interior delimiter: escape only if a real partner of the same char exists
  // that flanks the complementary way (i.e. a genuine emphasis pair). O(n) scan
  // over a text node's content — bounded, never the whole document.
  for (let j = 0; j < str.length; j++) {
    if (j === i || str[j] !== ch) continue;
    const p = j > 0 ? str[j - 1]! : null;
    const n = j + 1 < str.length ? str[j + 1]! : null;
    if (canOpen && rightFlanking(p, n)) return true;
    if (canClose && leftFlanking(p, n)) return true;
  }
  return false;
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
