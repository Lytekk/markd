import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Wiring guard for the content-truth accessors — same static-assertion class as
// tauri-capabilities.test.ts. The registration effect in App.tsx is untested
// integration glue (no App-level harness), and a revert to reading the
// ProseMirror editor directly would compile, pass every unit test, and silently
// re-open the source-mode data-loss bug: tab snapshots, Ctrl+S, Save As, the 30s
// autosave and the closed-tab stack would again capture the STALE editor doc
// instead of the SourceEditor textarea. These assertions fail loudly in CI.
const app = readFileSync("src/App.tsx", "utf8");

describe("source-truth wiring (src/App.tsx)", () => {
  it("registers BOTH getMarkdown accessors (save path + tab snapshots) through currentMarkdown", () => {
    const wired = app.match(/registerGetMarkdown\(\(\) =>\s*currentMarkdown\(/g) ?? [];
    expect(wired).toHaveLength(2);
    // No registration may bypass the wrapper.
    const all = app.match(/registerGetMarkdown\(/g) ?? [];
    expect(all).toHaveLength(wired.length);
  });

  it("registers the tab PM-JSON cache through currentDocJSON (no stale cache in source mode)", () => {
    expect(app).toMatch(/registerGetJSON\(\(\) =>\s*currentDocJSON\(/);
    expect(app.match(/registerGetJSON\(/g) ?? []).toHaveLength(1);
  });

  it("registers the clean-skip gate through editorBufferIsClean (never clean in source mode)", () => {
    expect(app).toMatch(/registerIsClean\(\(\) =>\s*editorBufferIsClean\(/);
    expect(app.match(/registerIsClean\(/g) ?? []).toHaveLength(1);
  });

  it("keeps exactly one bare editor.commands.setContent (the source-exit toggle)", () => {
    // Content loads go through loadEditorContent (undo-bleed class, v0.3.17);
    // source-mode capture goes through the accessors above. New bare setContent
    // calls are how both bug classes re-enter — justify any addition here.
    expect(app.match(/editor\.commands\.setContent\(/g) ?? []).toHaveLength(1);
  });
});
