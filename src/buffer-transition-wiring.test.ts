import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");

describe("buffer-transition wiring (src/App.tsx)", () => {
  it("gates async active-buffer loads through a latest-intent guard", () => {
    expect(app).toContain("createLatestRequestGuard");
    expect(app).toMatch(/bufferLoadGuardRef\.current\.begin\(\)/);
    expect(app).toMatch(/bufferLoadGuardRef\.current\.isCurrent\(request\)/);
    // Startup hydration, OS single-instance opens, reloads, and watcher reloads
    // must all take ownership through the same guard—not merely tab clicks.
    expect((app.match(/bufferLoadGuardRef\.current\.begin\(\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(10);
  });

  it("routes destructive New and Open actions through tab-safe handlers", () => {
    expect(app).toMatch(/case "o":\s*e\.preventDefault\(\);\s*void handleOpenFile\(\);/);
    expect(app).toMatch(/case "n":\s*e\.preventDefault\(\);\s*handleNewTab\(\);/);
    expect(app).toContain("onNew={handleNewTab}");
    expect(app).toContain("onOpen={handleOpenFile}");
  });

  it("uses the checked background-save chokepoint before Close All resets tabs", () => {
    expect(app).toContain("saveBackgroundTab");
    expect(app).toMatch(/const saved = await saveBackgroundTab\(/);
    expect(app).toMatch(/if \(!saved\) return;/);
    expect(app).toContain("expectedRevision");
    expect(app).toContain("getTabRevision");
  });

  it("re-reads live tab state after Save All settles writes", () => {
    // markTabSaved updates a synchronous hook ref, not the immutable hook
    // snapshot captured at the start of saveAllDirtyTabs.
    expect(app).toContain("return !fileTabsRef.current.tabs.some((tab) => tab.isDirty)");
  });

  it("lets an owning active save settle its captured tab before the generic mirror", () => {
    expect(app).toContain("const activeSaveOwnerRef");
    expect(app).toContain("const saveActiveTab");
    expect(app).toContain("expectedRevision: revision");
    expect(app).toContain("if (activeSaveOwnerRef.current?.tabId === ft.activeTabId) return;");
  });

  it("routes every Command Palette save entrypoint through active-tab ownership", () => {
    expect(app).toContain('run: saveActiveTab');
    expect(app).toContain('run: saveActiveTabAs');
    expect(app).not.toContain('run: fileState.handleSave');
    expect(app).not.toContain('run: fileState.handleSaveAs');
  });

  it("routes Menubar save actions through active-tab ownership", () => {
    expect(app).toContain("onSave={saveActiveTab}");
    expect(app).toContain("onSaveAs={saveActiveTabAs}");
    expect(app).not.toContain("onSave={fileState.handleSave}");
    expect(app).not.toContain("onSaveAs={fileState.handleSaveAs}");
  });
});
