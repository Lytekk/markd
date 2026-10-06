import { expect, it } from "vitest";
import { sourceSyntax } from "./source-syntax";
it("colors Markdown constructs without changing a single source character", () => {
  const text = '# Heading\n\n**bold** and *emphasis* [label](https://example.com)\n\n- item\n> quote\n\n```ts\nconst x = 1;\n```\n<script>alert(1)</script>';
  const tokens = sourceSyntax(text);
  expect(tokens.map(t => text.slice(t.start, t.end)).join("")).toBe(text);
  expect(tokens.some(t => t.className.includes("section"))).toBe(true);
  expect(tokens.some(t => t.className.includes("strong"))).toBe(true);
  expect(tokens.some(t => t.className.includes("code"))).toBe(true);
});

it("distinguishes link labels, URLs and code instead of painting labels as code strings", () => {
  const text = '[Markdown](https://example.com) and `code`';
  const tokens = sourceSyntax(text);
  const at = (content: string) => tokens.find(t => text.slice(t.start, t.end) === content)?.className;
  expect(at('Markdown')).toContain('source-link-label');
  expect(at('https://example.com')).toContain('source-link-url');
  expect(at('`code`')).toContain('source-code');
});

it("keeps nested emphasis distinct from headings and leaves ordinary prose neutral", () => {
  const text = '# The *Markdown* package\n\nPlain prose';
  const tokens = sourceSyntax(text);
  const emphasis = tokens.find(t => text.slice(t.start, t.end) === '*Markdown*')!;
  expect(emphasis.className).toContain('source-heading');
  expect(emphasis.className).toContain('source-emphasis');
  expect(tokens.find(t => text.slice(t.start, t.end).includes('Plain prose'))?.className).toBe('');
});

it("does not mistake YAML string values for Markdown link labels", () => {
  const text = '---\ntitle: "a title"\n---\n\n[label](./doc.md)';
  const tokens = sourceSyntax(text);
  expect(tokens.find(t => text.slice(t.start, t.end) === '"a title"')?.className).not.toContain('source-link-label');
  expect(tokens.find(t => text.slice(t.start, t.end) === 'label')?.className).toContain('source-link-label');
  expect(tokens.map(t => text.slice(t.start, t.end)).join('')).toBe(text);
});

it("does not interpret a wildcard inside quoted code as emphasis across later blocks", () => {
  const text = '> Read `docs/state-as-of-*.md` for context. **Important.**\n\n## Working approach\n\nOrdinary prose stays neutral.\n\n- Read `src/*.ts` first.';
  const spans = sourceSyntax(text);
  const at = (word: string) => spans.find(s => s.start <= text.indexOf(word) && s.end > text.indexOf(word))!.className;
  expect(at('docs/state-as-of-')).toContain('source-code');
  expect(at('Working approach')).toContain('source-heading');
  expect(at('Working approach')).not.toContain('source-emphasis');
  expect(at('Ordinary prose')).toBe('');
  expect(spans.map(s => text.slice(s.start, s.end)).join('')).toBe(text);
});

it("leaves unmatched and escaped emphasis markers neutral", () => {
  const text = 'An unfinished *phrase\n\n## Next heading\n\nPlain \\*literal\\* prose.';
  const spans = sourceSyntax(text);
  const at = (word: string) => spans.find(s => s.start <= text.indexOf(word) && s.end > text.indexOf(word))!.className;
  expect(at('unfinished')).toBe('');
  expect(at('phrase')).toBe('');
  expect(at('Next heading')).toContain('source-heading');
  expect(at('literal')).toBe('');
});

it("respects code, nested emphasis, links, lists and quote boundaries", () => {
  const text = '# Heading `*.md`\n\n> quote **bold** and *italic*\n\nPlain prose.\n\n- [x] task\n- **strong with *emphasis***\n\n~~removed~~\n\n```md\n# not a heading\n*not emphasis\n```\n\n[**label**](./doc.md)';
  const spans = sourceSyntax(text);
  const at = (word: string) => spans.find(s => s.start <= text.indexOf(word) && s.end > text.indexOf(word))!.className;
  expect(at('*.md')).toContain('source-code');
  expect(at('bold')).toContain('source-strong');
  expect(at('italic')).toContain('source-emphasis');
  expect(at('Plain prose')).toBe('');
  expect(at('task')).toBe('');
  expect(at('removed')).toContain('source-emphasis');
  expect(at('not a heading')).toContain('source-code');
  expect(at('not a heading')).not.toContain('source-heading');
  expect(at('not emphasis')).not.toContain('source-emphasis');
  expect(at('label')).toContain('source-strong');
  expect(at('./doc.md')).toContain('source-link-url');
  expect(spans.map(s => text.slice(s.start, s.end)).join('')).toBe(text);
  expect(spans.every((s, i) => s.start === (i ? spans[i - 1]!.end : 0))).toBe(true);
});
