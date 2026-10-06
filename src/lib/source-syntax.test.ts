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
