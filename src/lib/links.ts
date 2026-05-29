// URL normalization for the link editor (Ctrl+K).
//
// Turns user-typed input into a canonical href, or null when it should not
// become a link. The Link extension applies its own protocol allowlist on
// setLink, but we refuse obvious XSS schemes here too as a first line of
// defense and add the conveniences (bare domain → https, bare email → mailto).

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
