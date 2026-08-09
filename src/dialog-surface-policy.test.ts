import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "src");
const rustRoot = join(process.cwd(), "src-tauri", "src");

function productionSources(dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

function rustSources(dir = rustRoot): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return rustSources(path);
    return entry.name.endsWith(".rs") ? [path] : [];
  });
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function ownerName(node: ts.Node): string {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) &&
      current.name
    ) {
      return current.name.text;
    }
  }
  return "<module>";
}

function nativeBrowserDialogCalls(): string[] {
  const names = new Set(["alert", "confirm", "prompt"]);
  const found: string[] = [];
  for (const path of productionSources()) {
    const source = parse(path);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : ts.isElementAccessExpression(callee) &&
                ts.isStringLiteral(callee.argumentExpression)
              ? callee.argumentExpression.text
              : null;
        if (name && names.has(name)) {
          found.push(`${relative(process.cwd(), path)}:${ownerName(node)}:${name}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

interface DialogBinding {
  path: string;
  owner: string;
  imported: string;
}

function tauriDialogBindings(): DialogBinding[] {
  const found: DialogBinding[] = [];
  for (const path of productionSources()) {
    const source = parse(path);
    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "@tauri-apps/plugin-dialog"
      ) {
        found.push({
          path: relative(process.cwd(), path),
          owner: "<static-import>",
          imported: node.importClause?.getText(source) ?? "<side-effect>",
        });
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === "@tauri-apps/plugin-dialog"
      ) {
        const declaration = node.parent.parent;
        const binding = ts.isVariableDeclaration(declaration)
          ? declaration.name
          : undefined;
        if (!binding || !ts.isObjectBindingPattern(binding)) {
          found.push({
            path: relative(process.cwd(), path),
            owner: ownerName(node),
            imported: "<namespace>",
          });
        } else {
          for (const element of binding.elements) {
            found.push({
              path: relative(process.cwd(), path),
              owner: ownerName(node),
              imported: element.propertyName?.getText(source) ?? element.name.getText(source),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe("user-facing dialog surface policy", () => {
  it("contains no browser-native alert, confirm, or prompt calls", () => {
    expect(nativeBrowserDialogCalls()).toEqual([]);
  });

  it("uses the Tauri dialog plugin for exactly the four native open/save pickers", () => {
    expect(tauriDialogBindings()).toEqual([
      { path: "src/lib/file-system.ts", owner: "tauriOpenFile", imported: "open" },
      { path: "src/lib/file-system.ts", owner: "tauriSaveFileAs", imported: "save" },
      { path: "src/lib/file-system.ts", owner: "tauriOpenDirectory", imported: "open" },
      { path: "src/lib/file-system.ts", owner: "exportAsHtml", imported: "save" },
    ]);
    expect(readFileSync("src/lib/file-system.ts", "utf8")).toMatch(
      /export function exportAsPdf\(\): void \{\s*window\.print\(\);\s*\}/,
    );
    expect(
      rustSources()
        .filter((path) =>
          /\bMessageDialogBuilder\b|\.dialog\s*\(\s*\)[\s\S]{0,80}\.(?:message|ask|confirm)\s*\(/.test(
            readFileSync(path, "utf8"),
          ),
        )
        .map((path) => relative(process.cwd(), path)),
    ).toEqual([]);
  });

  it("keeps beforeunload as a browser-only data-loss fallback, never a desktop popup", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const start = app.indexOf("// Browser beforeunload");
    const end = app.indexOf("const handleThemeToggle", start);
    const block = app.slice(start, end);
    expect(block).toContain("if (isTauri()) return;");
    expect(block).toContain('window.addEventListener("beforeunload"');
    expect(
      productionSources()
        .filter((path) => readFileSync(path, "utf8").includes('"beforeunload"'))
        .map((path) => relative(process.cwd(), path)),
    ).toEqual(["src/App.tsx"]);
  });

  it("gives file-change confirmations explicit safe in-app defaults", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).not.toMatch(/\baskDialog\b/);
    expect(app).toMatch(/title:\s*"File Deleted"[\s\S]{0,700}defaultValue:\s*"keep"/);
    expect(app).toMatch(/title:\s*"File Changed on Disk"[\s\S]{0,700}defaultValue:\s*"keep"/);
  });

  it("binds file-change continuations to their original tab and reloads fresh bytes", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const start = app.indexOf("// Detect external file modifications");
    const end = app.indexOf("// Check for updates", start);
    const watcher = app.slice(start, end);
    expect(watcher).not.toContain("fileChangePromptOpen");
    expect(watcher).toMatch(/fileChangePromptCoordinatorRef\.current\.acquire\(watcherOwner,/);
    expect(watcher).toMatch(/fileChangePromptCoordinatorRef\.current\.release\(watcherOwner\)/);
    expect(watcher).toMatch(
      /async function check\(\) \{[\s\S]{0,360}pauseWatcherAutoSave\(\);[\s\S]{0,500}await readFileByPath\(filePath\)/,
    );
    expect(watcher).toMatch(
      /shouldValidateAfterKeep[\s\S]{0,900}pathExists\(filePath\)[\s\S]{0,700}resumeWatcherAutoSave\(\)/,
    );
    expect(watcher).toContain("resolveExternalChangeChoice(");
    expect(watcher).toContain('resolution === "recheck"');
    expect(watcher).toMatch(
      /const promptTabId = fileTabsRef\.current\.getActiveTabId\(\);\s*const promptTarget = \{\s*tabId: promptTabId,/,
    );
    expect(watcher).toMatch(/fileChangeTargetIsCurrent\(\s*promptTarget,/);
    expect(watcher).toContain("fileChangeTargetOwnsActivePath(");
    expect((watcher.match(/promptTargetOwnsActivePath\(/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);
    expect(watcher).not.toMatch(/\b(?:fileTabsRef\.current|ft)\.activeTabId\b/);
    expect(watcher).not.toMatch(
      /fileStateRef\.current\.(?:filePath|fileName|savedContent|isDirty)\b/,
    );
    expect(watcher).toMatch(/latestOnDisk = await readFileByPath\(filePath\)/);
    expect(watcher).toMatch(
      /hydrateTab\(promptTarget\.tabId, latestOnDisk, promptTarget\.tabRevision\)/,
    );
    expect(watcher).toMatch(/fileChangePromptCoordinatorRef\.current\.release\(watcherOwner\);[\s\S]{0,500}shouldRecheckAfterReload[\s\S]{0,80}void check\(\)/);
    expect(watcher).toMatch(/stillDeleted = !\(await pathExists\(filePath\)\)/);
    expect(watcher).toMatch(/shouldRecheckAfterDeletion[\s\S]{0,220}void check\(\)/);
    expect(watcher).toMatch(
      /fileStateRef\.current\.detachActiveFile\(\);[\s\S]{0,260}await handleCloseTabRef\.current\(promptTarget\.tabId/,
    );
    const transientReadFailure = watcher.slice(
      watcher.indexOf("if (!shouldPromptForDeletion"),
      watcher.indexOf("const promptTabId", watcher.indexOf("if (!shouldPromptForDeletion")),
    );
    expect(transientReadFailure).toContain("scheduleReadRetry();");
    expect(transientReadFailure).not.toContain("resumeWatcherAutoSave();");
    expect(watcher).toMatch(/clearTimeout\(readRetryTimer\)/);
  });

  it("makes automatic update offers replaceable and defaults Enter to Later", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const start = app.indexOf("const checkForUpdates");
    const end = app.indexOf("// Auto-update check on startup", start);
    const updateBlock = app.slice(start, end);
    expect(updateBlock).not.toContain("@tauri-apps/plugin-dialog");
    expect(updateBlock).toMatch(/defaultValue:\s*"later"/);
    expect(updateBlock).toMatch(
      /policy:\s*offerIsManual\s*\?\s*"normal"\s*:\s*"replaceable"/,
    );
    expect(updateBlock).toMatch(/installWasChosen = true;[\s\S]{0,100}downloadAndInstall\(\)/);
    expect(updateBlock).toMatch(
      /shouldShowUpdateError\(isManualRequested\(\), installWasChosen\)/,
    );
  });

  it("gates global keyboard and wheel shortcuts while an in-app modal is pending", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(
      /const handleKeyDown = \(e: KeyboardEvent\) => \{\s*if \(isModalOpen\(\)\) return;/,
    );
    expect(app).toMatch(
      /const handleWheel = \(e: WheelEvent\) => \{\s*if \(isModalOpen\(\)\) return;/,
    );
  });

  it("keeps an awaited link prompt bound to its original editor document and range", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const start = app.indexOf("const handleEditLink");
    const end = app.indexOf("// Keyboard shortcuts", start);
    const linkBlock = app.slice(start, end);
    expect(linkBlock).toMatch(/const ownerDoc = editor\.state\.doc;/);
    expect(linkBlock).toMatch(/const ownerSelection = \{ from: ownerFrom, to: ownerTo \};/);
    expect(linkBlock).toMatch(/await promptModal\(/);
    expect(linkBlock).toMatch(/isCurrent:\s*\(\) => editor\.state\.doc === ownerDoc/);
    expect(linkBlock).toMatch(/if \(editor\.state\.doc !== ownerDoc\) return;/);
    expect(linkBlock).toMatch(/setTextSelection\(ownerSelection\)/);
  });

  it("reconciles file-tree modal results against live buffer and tab ownership", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const start = app.indexOf("const handleFileAction");
    const end = app.indexOf("const handleCloseFindReplace", start);
    const fileActions = app.slice(start, end);
    expect(fileActions).toContain("fileStateRef.current.getCurrentState()");
    expect(fileActions).toContain("ft.getActiveTabId()");
    expect(fileActions).toContain("fileTabsRef.current.getTabsSnapshot()");
    expect(fileActions).not.toMatch(/\bfileState\.(?:filePath|updateActiveFilePath|detachActiveFile)\b/);
    expect(fileActions).not.toMatch(/\bfileTabs\.(?:activeTabId|tabs|updateTabPath)\b/);
  });

  it("serializes desktop quit and every overlapping update request", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const closeStart = app.indexOf("// Desktop quit guard");
    const closeEnd = app.indexOf("const handleNewTab", closeStart);
    const closeBlock = app.slice(closeStart, closeEnd);
    expect(closeBlock).toMatch(
      /if \(quitFlowInFlightRef\.current\) \{\s*event\.preventDefault\(\);\s*return;/,
    );
    expect(closeBlock).toMatch(/quitFlowInFlightRef\.current = true;[\s\S]*finally \{[\s\S]{0,160}quitFlowInFlightRef\.current = false;/);

    const updateStart = app.indexOf("const checkForUpdates");
    const updateEnd = app.indexOf("// Auto-update check on startup", updateStart);
    const updateBlock = app.slice(updateStart, updateEnd);
    expect(updateBlock).toMatch(/updateCheckCoordinatorRef\.current\.run\(manual,/);
    expect(updateBlock).toContain("isManualRequested()");
    expect(updateBlock).not.toContain("manualUpdateCheckRef");
  });
});
