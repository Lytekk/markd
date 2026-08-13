import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");

describe("application save shortcuts", () => {
  it("routes Ctrl+Shift+S exclusively to Save As", () => {
    const saveShortcut = app.slice(
      app.indexOf('case "s":'),
      app.indexOf('case "r":'),
    );

    expect(saveShortcut).toContain("if (e.shiftKey)");
    expect(saveShortcut).toContain("void saveActiveTabAs()");
    expect(saveShortcut).toContain("void saveActiveTab()");
    expect(saveShortcut).not.toContain("saveAllDirtyTabs");
  });
});
