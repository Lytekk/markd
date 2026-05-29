import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const css: string = readFileSync(
  resolve(process.cwd(), "src/styles/base.css"),
  "utf8",
);

function ruleBody(selector: string): string | null {
  const idx = css.indexOf(selector);
  if (idx === -1) return null;
  const open = css.indexOf("{", idx);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

describe("base.css layout", () => {
  test("#write table gets a horizontal scroll block so wide tables don't escape the 860px column", () => {
    const body = ruleBody("#write table");
    expect(body, "missing `#write table` rule").not.toBeNull();
    expect(body).toMatch(/display:\s*block/);
    expect(body).toMatch(/overflow-x:\s*auto/);
    expect(body).toMatch(/max-width:\s*100%/);
  });

  test(".markd-editor-scroll shows a horizontal scrollbar when content exceeds width", () => {
    const body = ruleBody(".markd-editor-scroll");
    expect(body).not.toBeNull();
    expect(body).toMatch(/overflow-x:\s*auto/);
  });

  test("#write max-width is driven by --editor-max-width so Full Width can swap it", () => {
    const body = ruleBody("#write");
    expect(body).not.toBeNull();
    expect(body).toMatch(/max-width:\s*var\(--editor-max-width/);
    expect(body).toMatch(/transition:\s*max-width/);
  });

  test("[data-full-width=\"true\"] #write removes the 860px cap", () => {
    const body = ruleBody('[data-full-width="true"] #write');
    expect(body).not.toBeNull();
    expect(body).toMatch(/max-width:\s*100%/);
  });

  test("Source textarea fills the width with a padding-centered column so its scrollbar sits at the window edge like rendered mode", () => {
    const body = ruleBody(".markd-source-textarea");
    expect(body, "missing `.markd-source-textarea` rule").not.toBeNull();
    expect(body).toMatch(/width:\s*100%/);
    // Reading column comes from adaptive horizontal padding, not a hard
    // max-width clamp — so the vertical scrollbar lands at the window edge.
    expect(body).toMatch(/padding:[^;]*max\(/);
    expect(body).toMatch(/var\(--editor-max-width/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  test('[data-full-width="true"] .markd-source-textarea collapses the centering padding so Source view fills the width like #write', () => {
    const body = ruleBody('[data-full-width="true"] .markd-source-textarea');
    expect(body, "Source view ignores Full Width").not.toBeNull();
    expect(body).toMatch(/padding-left:\s*60px/);
  });

  test("keyboard focus rings are restored for chrome controls (button resets strip the UA outline)", () => {
    expect(css).toMatch(/button:focus-visible/);
    expect(css).toMatch(/:focus-visible[^}]*\{[^}]*outline:\s*2px/);
  });

  test("#write pre is positioned so the code toolbar can anchor to its corner", () => {
    const body = ruleBody("#write pre");
    expect(body, "missing `#write pre` rule").not.toBeNull();
    expect(body).toMatch(/position:\s*relative/);
  });

  test("the code-block toolbar floats over the block and reveals on hover/focus", () => {
    const bar = ruleBody(".markd-code-toolbar");
    expect(bar, "missing `.markd-code-toolbar` rule").not.toBeNull();
    expect(bar).toMatch(/position:\s*absolute/);

    const copy = ruleBody(".markd-code-copy");
    expect(copy, "missing `.markd-code-copy` rule").not.toBeNull();
    expect(copy).toMatch(/cursor:\s*pointer/);
    expect(copy).toMatch(/opacity:\s*0/); // hidden until the block is hovered/focused
  });

  test("the code toolbar is screen-only — hidden in print", () => {
    expect(css).toMatch(/@media print[\s\S]*\.markd-code-toolbar[\s\S]*display:\s*none/);
  });
});
