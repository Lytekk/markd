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
    expect(app).toMatch(/const result = await saveBackgroundTab\(/);
    // Only a write that actually happened may advance the tab; and a write that
    // FAILED must say so. Collapsing failed/superseded/cancelled into one falsy
    // value made a real disk failure abort Close All with nothing shown.
    expect(app).toMatch(/if \(!result\.saved\) \{/);
    expect(app).toContain("saveOutcomeMessage(result.outcome, tab.fileName)");
    expect(app).toContain("{ ...result.saved, expectedRevision: revision }");
    expect(app).toContain("expectedRevision");
    expect(app).toContain("getTabRevision");
    expect(readFileSync("src/lib/background-tab-save.ts", "utf8")).toContain(
      "outcome: SaveOutcome;",
    );
  });

  it("re-reads live tab state after Save All settles writes", () => {
    // markTabSaved settles `tabsRef` synchronously and only QUEUES a render, so
    // `fileTabsRef.current.tabs` — the rendered array — still carries the
    // pre-save dirty flags when the await resumes. Verifying against it reported
    // failure for a Save All that had saved everything, and Close All then
    // aborted with no explanation. getTabsSnapshot() reads the settled ref.
    expect(app).toContain(
      "return !fileTabsRef.current.getTabsSnapshot().some((tab) => tab.isDirty)",
    );
    expect(app).not.toContain("return !fileTabsRef.current.tabs.some((tab) => tab.isDirty)");
    expect(readFileSync("src/hooks/use-file-tabs.ts", "utf8")).toContain(
      "const getTabsSnapshot = useCallback(() => tabsRef.current, []);",
    );
  });

  it("uses synchronous active-buffer dirtiness for every destructive close path", () => {
    expect(app).toContain("tabIsLiveDirty(tab, activeTabId, activeBufferDirty)");
    expect((app.match(/liveDirtyTabs\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(app).toContain("fileStateRef.current.getCurrentState().isDirty");
  });

  it("guards every post-confirm active reload with the per-edit content token", () => {
    expect((app.match(/getContentRevision\(\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(
      (app.match(/contentRevision: fileStateRef\.current\.getContentRevision\(\)/g) ?? [])
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(app).toContain("fs.getContentRevision() !== contentRevision");
  });

  it("does not let post-confirm edits slip through Close All or native quit", () => {
    const closeAll = app.slice(
      app.indexOf("const handleCloseAllTabs"),
      app.indexOf("// Desktop quit guard"),
    );
    expect(closeAll).toContain("bufferLoadGuardRef.current.begin()");
    expect(closeAll).toContain("closingContentRevision");
    expect(closeAll).toMatch(/getContentRevision\(\) !== closingContentRevision/);

    const quit = app.slice(
      app.indexOf("// Desktop quit guard"),
      app.indexOf("const handleNewTab", app.indexOf("// Desktop quit guard")),
    );
    expect(quit).toContain("bufferLoadGuardRef.current.begin()");
    expect(quit).toContain("closingContentRevision");
    expect(quit).toMatch(/getContentRevision\(\) !== closingContentRevision/);
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
