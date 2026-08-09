import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const css: string = readFileSync(
  resolve(process.cwd(), "src/styles/base.css"),
  "utf8",
);
const dayCss: string = readFileSync(
  resolve(process.cwd(), "src/styles/themes/day.css"),
  "utf8",
);

function themeHex(cssText: string, variable: string): string {
  const value = cssText.match(new RegExp(`--${variable}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing six-digit --${variable} theme color`);
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(a: string, b: string): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

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

  test("a persistent sidebar toggle occupies the fixed slot immediately left of the tab bar", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
    const stripStart = app.indexOf('className="markd-tab-strip"');
    const toggleStart = app.indexOf('className="markd-tab-sidebar-toggle"', stripStart);
    const tabBarStart = app.indexOf("<TabBar", stripStart);
    const stripEnd = app.indexOf("</div>", tabBarStart);

    expect(stripStart).toBeGreaterThan(-1);
    expect(toggleStart, "sidebar toggle must be the first fixed item in the strip").toBeGreaterThan(stripStart);
    expect(toggleStart).toBeLessThan(tabBarStart);
    expect(tabBarStart).toBeLessThan(stripEnd);
    expect(app.match(/className="markd-tab-sidebar-toggle"/g)).toHaveLength(1);
    expect(app).not.toContain('className="markd-sidebar-toggle"');
    expect(sidebar).not.toContain('title="Toggle Sidebar"');

    const strip = ruleBody(".markd-tab-strip");
    const toggle = ruleBody(".markd-tab-sidebar-toggle");
    const nestedBar = ruleBody(".markd-tab-strip .markd-tab-bar");
    expect(strip).toMatch(/display:\s*flex/);
    expect(strip).toMatch(/height:\s*35px/);
    expect(toggle).toMatch(/flex:\s*0\s+0\s+35px/);
    expect(nestedBar).toMatch(/flex:\s*1/);
    expect(nestedBar).toMatch(/min-width:\s*0/);
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
    const delta = ruleBody(".markd-stat-delta");
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
    expect(stats, "compact signed deltas need enough room for a value such as +1.2m").toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+6ch/,
    );
    expect(delta, "large deltas must stay inside their reserved subtrack").toMatch(/overflow:\s*hidden/);
    expect(delta).toMatch(/text-overflow:\s*ellipsis/);
    expect(delta).toMatch(/white-space:\s*nowrap/);
    expect(empty, "inactive content must retain its slot").toMatch(/visibility:\s*hidden/);
    expect(empty).not.toMatch(/display:\s*none/);
  });

  test("first-class confirmations sit above other in-app overlays", () => {
    const host = ruleBody(".markd-modal-host-backdrop");
    expect(host, "missing dedicated ModalHost layer").toMatch(/z-index:\s*1100/);
  });

  // Day/Night swaps use a compositor snapshot where supported and a bounded
  // staged CSS fallback elsewhere, so the change stays smooth on large docs.
  test("theme swap uses a root snapshot with a bounded color-transition fallback", () => {
    expect(css).toMatch(/::view-transition-old\(root\)/);
    expect(css).toMatch(/::view-transition-new\(root\)/);
    expect(css).toMatch(/html\.theme-transition\b/);
    // Modern webviews cross-fade one root snapshot; the fallback is deliberately
    // bounded so a long table never creates thousands of per-cell animations.
    expect(css).not.toMatch(/html\.theme-transition\s+\*/);
    expect(css).toMatch(
      /animation-duration:\s*0\.5s[\s\S]{0,100}animation-timing-function:\s*cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/,
    );
    expect(css).toMatch(/background-color\s+0\.5s\s+cubic-bezier/);
    expect(css).toMatch(/prefers-reduced-motion/);
  });

  test("day theme uses the requested parchment surface with readable text and controls", () => {
    const background = themeHex(dayCss, "bg-color");
    const sidebar = themeHex(dayCss, "side-bar-bg-color");
    const codeBlock = themeHex(dayCss, "code-block-bg-color");
    const text = themeHex(dayCss, "text-color");
    const controls = themeHex(dayCss, "control-text-color");

    expect(background.toLowerCase(), "the canvas should read as warm parchment, not sterile white").toBe("#fcf5e5");
    expect(relativeLuminance(sidebar)).toBeLessThan(relativeLuminance(background));
    expect(relativeLuminance(codeBlock)).toBeLessThan(relativeLuminance(background));
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(controls, background)).toBeGreaterThanOrEqual(4.5);
    for (const token of [
      "code-comment",
      "code-keyword",
      "code-string",
      "code-number",
      "code-builtin",
      "code-function",
      "code-variable",
    ]) {
      expect(contrastRatio(themeHex(dayCss, token), codeBlock), token).toBeGreaterThanOrEqual(4.5);
    }
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
    expect(win.minWidth, "the native default is the collapsed-sidebar footer floor").toBe(640);
    expect(win.backgroundColor).toBe("#1e1e2e");
    // Must match the night theme's own --bg-color, or the native frame and the
    // first painted frame are different colours.
    const night = readFileSync("src/styles/themes/night.css", "utf8");
    expect(night).toMatch(/--bg-color:\s*#1e1e2e/);

    // useTheme only cross-fades when index.html actually recorded a target.
    const theme = readFileSync("src/hooks/use-theme.ts", "utf8");
    expect(theme).toContain("const bootTarget = html.dataset.bootTheme;");
    expect(theme).toContain("if (!bootTarget || bootedOn === activeTheme)");
    expect(theme).toContain("frame = requestAnimationFrame(() => {");
    expect(theme).toContain("void html.offsetWidth;");
  });

  test("the native minimum width follows the collapsible sidebar instead of imposing its open width", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));

    expect(app).toContain("const COLLAPSED_WINDOW_MIN_WIDTH = 640;");
    expect(app).toContain("const EXPANDED_WINDOW_MIN_WIDTH = 900;");
    expect(app).toMatch(
      /sidebarCollapsed\s*\?\s*COLLAPSED_WINDOW_MIN_WIDTH\s*:\s*EXPANDED_WINDOW_MIN_WIDTH/,
    );
    expect(app).toContain("await appWindow.setMinSize");
    expect(app).toContain("appWindow.innerSize()");
    expect(app).toContain("await appWindow.setSize");
    expect(capability.permissions).toContain("core:window:allow-set-min-size");
    expect(capability.permissions).toContain("core:window:allow-set-size");
  });
});
