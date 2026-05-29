// URL normalization for the link editor (Ctrl+K).
//
// Turns user-typed input into a canonical href, or null when it should not
// become a link. The Link extension applies its own protocol allowlist on
// setLink, but we refuse obvious XSS schemes here too as a first line of
// defense and add the conveniences (bare domain → https, bare email → mailto).

import { Node as PmNode } from "@tiptap/pm/model";

const SAFE_SCHEME = /^(https?|mailto|tel|ftp):/i;
const DANGEROUS_SCHEME = /^(javascript|data|vbscript|file):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @returns a canonical href, or null if the input is empty or an unsafe scheme.
 */
export function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (DANGEROUS_SCHEME.test(v)) return null; // refuse javascript:/data:/etc.
  if (/^(#|\/|\.\/|\.\.\/)/.test(v)) return v; // anchors + relative paths
  if (SAFE_SCHEME.test(v)) return v; // already an absolute, safe URL
  if (EMAIL.test(v)) return `mailto:${v}`;
  // Bare domain (has a dot, no scheme, no whitespace) → assume https.
  if (!HAS_SCHEME.test(v) && v.includes(".") && !/\s/.test(v)) return `https://${v}`;
  return v;
}

/**
 * The document range of the word containing `pos`, or null if the caret sits in
 * whitespace / an empty block. Lets Ctrl+K link the word under the caret when
 * there's no selection, instead of inserting the URL as literal text.
 */
export function wordRangeAt(doc: PmNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  const text = $pos.parent.textContent;
  const offset = $pos.parentOffset;
  let start = offset;
  let end = offset;
  while (start > 0 && /\w/.test(text[start - 1]!)) start--;
  while (end < text.length && /\w/.test(text[end]!)) end++;
  if (start === end) return null;
  const base = $pos.start();
  return { from: base + start, to: base + end };
}
