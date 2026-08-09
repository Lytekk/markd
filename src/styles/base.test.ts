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
  test("wide tables contribute their full width to the editor's single horizontal scrollbar", () => {
    const editor = ruleBody(".markd-editor-scroll");
    const wrapper = ruleBody(".markd-editor-scroll #write .tableWrapper");
    const table = ruleBody(".markd-editor-scroll #write table");

    expect(editor, "missing editor scroll-owner rule").not.toBeNull();
    expect(wrapper, "missing live non-scrolling TipTap table-wrapper rule").not.toBeNull();
    expect(table, "missing live table overflow rule").not.toBeNull();
    expect(editor!).toMatch(/overflow-x:\s*auto/);
    expect(wrapper!).toMatch(/overflow-x:\s*visible/);
    expect(table!).toMatch(/display:\s*table/);
    expect(table!).toMatch(/width:\s*max-content/);
    expect(table!).toMatch(/max-width:\s*none/);
    expect(table!).toMatch(/overflow-x:\s*visible/);
    expect(table!).not.toMatch(/overflow-x:\s*(?:auto|scroll)/);
  });

  test("standalone HTML exports retain their prior fallback without the live editor shell", () => {
    const table = ruleBody("#write table");
    expect(table, "missing standalone `#write table` fallback").not.toBeNull();
    expect(table!).toMatch(/display:\s*block/);
    expect(table!).toMatch(/max-width:\s*100%/);
    expect(table!).toMatch(/overflow-x:\s*auto/);
  });

  test("print restores the prior bounded fallback outside the live scroll owner", () => {
    expect(css).toMatch(
      /@media print[\s\S]*\.markd-editor-scroll #write table\s*\{[^}]*display:\s*block[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/,
    );
  });

  test(".markd-editor-scroll shows a horizontal scrollbar when content exceeds width", () => {
    const body = ruleBody(".markd-editor-scroll");
    expect(body).not.toBeNull();
    expect(body).toMatch(/overflow-x:\s*auto/);
  });

  test("the tab list owns horizontal overflow while the outer bar keeps New Tab fixed", () => {
    const bar = ruleBody(".markd-tab-bar");
    const list = ruleBody(".markd-tab-list");
    expect(bar, "missing `.markd-tab-bar` rule").toMatch(/overflow:\s*hidden/);
    expect(list, "missing `.markd-tab-list` rule").toMatch(/overflow-x:\s*auto/);
    expect(list).toMatch(/position:\s*relative/);
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

  test("the command palette sits near the top (Spotlight-style) with a bounded, scrollable list", () => {
    const palette = ruleBody(".markd-command-palette");
    expect(palette, "missing `.markd-command-palette` rule").not.toBeNull();
    expect(palette).toMatch(/align-self:\s*flex-start/);
    expect(palette).toMatch(/max-height:/);

    const list = ruleBody(".markd-command-list");
    expect(list, "missing `.markd-command-list` rule").not.toBeNull();
    expect(list).toMatch(/overflow-y:\s*auto/);
  });

  test("the highlighted command row is visually distinct", () => {
    const selected = ruleBody(".markd-command-item.selected");
    expect(selected, "missing `.markd-command-item.selected` rule").not.toBeNull();
    expect(selected).toMatch(/background:/);
  });

  test("the slash menu is a caret-anchored popup with a highlighted selection", () => {
    const menu = ruleBody(".markd-slash-menu");
    expect(menu, "missing `.markd-slash-menu` rule").not.toBeNull();
    expect(menu).toMatch(/position:\s*fixed/);

    const selected = ruleBody(".markd-slash-item.selected");
    expect(selected, "missing `.markd-slash-item.selected` rule").not.toBeNull();
    expect(selected).toMatch(/background:/);
  });

  // Source-mode line numbers must track their lines exactly. The gutter number
  // block height has to equal the textarea ROW height (--line-height ×
  // --font-size), not the smaller 12px number glyph's em — otherwise a fixed
  // per-line deficit accumulates and the numbers slide off after scrolling.
  test("the gutter cell follows the logical line while its label centers in the first visual row", () => {
    const cell = ruleBody(".markd-line-number");
    expect(cell, "missing `.markd-line-number` rule").not.toBeNull();
    expect(cell).toMatch(/height:\s*calc\(var\(--line-height\)\s*\*\s*var\(--font-size\)\)/);

    const label = ruleBody(".markd-line-number-label");
    expect(label, "missing `.markd-line-number-label` rule").not.toBeNull();
    expect(label).toMatch(/height:\s*calc\(var\(--line-height\)\s*\*\s*var\(--font-size\)\)/);
    expect(label).toMatch(/align-items:\s*center/);
  });

  // With wrapping on, one logical line spans N textarea rows but only one gutter
  // number — drift. When line numbers are on we turn wrapping off so a logical
  // line is exactly one row (long lines scroll horizontally, code-editor style).
  test("line-numbered source KEEPS soft-wrap — gutter rows are measured per line, not fixed", () => {
    // User-reported (2026-07-05): source mode must wrap like the rendered
    // view even with line numbers on. The old wrap-off rule is gone; gutter
    // alignment now comes from measured variable-height rows (SourceEditor +
    // textarea-metrics measureLineHeights), so no rule may reintroduce nowrap.
    const body = ruleBody(".markd-source-editor.with-line-numbers .markd-source-textarea");
    if (body !== null) {
      expect(body).not.toMatch(/white-space:\s*pre\s*;/);
    }
    const backdrop = ruleBody(".markd-source-editor.with-line-numbers .markd-source-backdrop");
    if (backdrop !== null) {
      expect(backdrop).not.toMatch(/white-space:\s*pre\s*;/);
    }
  });

  test("rendered mode never presents top-level block counters as line numbers", () => {
    expect(css).not.toMatch(/\[data-line-numbers="true"\]\s+#write\s*>\s*\*/);
    expect(css).not.toMatch(/counter\((?:line-number)\)/);
  });

  test("footer export actions carry a VISIBLE button border so they don't read as toggles", () => {
    const body = ruleBody(".markd-status-action");
    expect(body, "missing `.markd-status-action` rule").not.toBeNull();
    // A real width — not `border: none` — is what makes them read as buttons.
    expect(body).toMatch(/border:\s*1px/);
  });

  test("a VISIBLE divider fences the footer toggle group off from the export actions", () => {
    const body = ruleBody(".markd-status-divider");
    expect(body, "missing `.markd-status-divider` rule").not.toBeNull();
    // Existence alone isn't enough — an emptied rule renders nothing. Pin the
    // properties that actually draw the 1px rule.
    expect(body).toMatch(/width:\s*1px/);
    expect(body).toMatch(/background:/);
  });

  test("the footer uses fixed tracks and invisible placeholders so state cannot move siblings", () => {
    const bar = ruleBody(".markd-status-bar");
    const left = ruleBody(".markd-status-left");
    const right = ruleBody(".markd-status-right");
    const filename = ruleBody(".markd-status-filename");
    const stats = ruleBody(".markd-status-stat");
    const empty = ruleBody(".is-slot-empty");

    expect(bar, "missing status-bar layout rule").toMatch(/display:\s*flex/);
    expect(bar, "wide footer contents must not scroll the editor shell").toMatch(
      /overflow:\s*hidden/,
    );
    expect(left, "missing fixed left status region").toMatch(/display:\s*grid/);
    expect(left).toMatch(/flex:\s*1\s+1\s+12rem/);
    expect(left).toMatch(/min-width:\s*12ch/);
    expect(right, "missing fixed right status tracks").toMatch(/display:\s*grid/);
    expect(right).toMatch(/position:\s*relative/);
    expect(right).toMatch(/grid-template-columns:/);
    expect(right, "narrow windows must scroll only the fixed footer tracks").toMatch(
      /overflow-x:\s*auto/,
    );
    expect(right).toMatch(/min-width:\s*0/);
    expect(filename, "filename must be bounded instead of pushing controls").toMatch(/overflow:\s*hidden/);
    expect(filename).toMatch(/text-overflow:\s*ellipsis/);
    expect(stats, "numeric status cells need stable digit geometry").toMatch(
      /font-variant-numeric:\s*tabular-nums/,
    );
    expect(empty, "inactive content must retain its slot").toMatch(/visibility:\s*hidden/);
    expect(empty).not.toMatch(/display:\s*none/);
  });

  test("first-class confirmations sit above other in-app overlays", () => {
    const host = ruleBody(".markd-modal-host-backdrop");
    expect(host, "missing dedicated ModalHost layer").toMatch(/z-index:\s*1100/);
  });

  // Day/Night swap cross-fades colors via a transient `.theme-transition` class
  // (use-theme adds it only during the swap) so the change doesn't shock the eyes.
  test("theme swap cross-fades colors via a .theme-transition rule that transitions background-color", () => {
    expect(css).toMatch(/html\.theme-transition\b/);
    // The color transition must be present (the whole point), guarded for reduced-motion users.
    expect(css).toMatch(/\.theme-transition[\s\S]{0,260}transition:[\s\S]{0,120}background-color/);
    expect(css).toMatch(/prefers-reduced-motion/);
  });

  test("paints the page background from the cascade, never from an inline style", () => {
    // index.html applies data-theme before first paint so the first frame is
    // already themed. It must NOT also set an inline background: an inline style
    // outranks every author rule, so the boot-time color would survive a theme
    // switch and the page would keep the old background forever.
    expect(css).toMatch(/html\s*\{[^}]*background-color:\s*var\(--bg-color\)/);
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toContain("style.backgroundColor");
  });

  test("boots dark and hands the real theme to useTheme", () => {
    // The window is revealed before WebView2 paints, so the first frames come
    // from the native layer — which tauri.conf.json paints dark. The document
    // must boot dark too, or the hand-off is exactly the white flash the dark
    // window exists to prevent.
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('root.dataset.theme = "night";');
    expect(html).toContain("root.dataset.bootTheme = theme;");

    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const win = conf.app.windows[0];
    expect(win.backgroundColor).toBe("#1e1e2e");
    // Must match the night theme's own --bg-color, or the native frame and the
    // first painted frame are different colours.
    const night = readFileSync("src/styles/themes/night.css", "utf8");
    expect(night).toMatch(/--bg-color:\s*#1e1e2e/);

    // useTheme only cross-fades when index.html actually recorded a target.
    const theme = readFileSync("src/hooks/use-theme.ts", "utf8");
    expect(theme).toContain("const bootTarget = html.dataset.bootTheme;");
    expect(theme).toContain("if (!bootTarget || bootedOn === activeTheme)");
    expect(theme).toContain("requestAnimationFrame(applyWithCrossFade)");
  });
});
