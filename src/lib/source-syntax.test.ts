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
