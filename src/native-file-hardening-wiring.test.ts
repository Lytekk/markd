import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const native = readFileSync("src-tauri/src/lib.rs", "utf8");
const fileOps = readFileSync("src-tauri/src/file_ops.rs", "utf8");
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
const fileSystem = readFileSync("src/lib/file-system.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

/**
 * Extract a Rust function body, counting braces only in real code.
 *
 * Naive brace counting stops early on a `{` inside a string literal or a
 * comment, and a truncated body makes every `.not.toContain` assertion below
 * pass for the wrong reason — the guard silently stops guarding. Skip strings,
 * chars, raw strings and comments so the depth count reflects the source.
 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`fn ${name}(`);
  expect(start, `missing ${name}`).toBeGreaterThanOrEqual(0);
  const openingBrace = source.indexOf("{", start);
  expect(openingBrace, `missing body for ${name}`).toBeGreaterThan(start);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const char = source[index];

    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index);
      if (index === -1) break;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      if (close === -1) break;
      index = close + 1;
      continue;
    }
    // Raw string: r"...", r#"..."#, r##"..."## — the hash count delimits it.
    if (char === "r" && (source[index + 1] === '"' || source[index + 1] === "#")) {
      let hashes = 0;
      while (source[index + 1 + hashes] === "#") hashes += 1;
      if (source[index + 1 + hashes] === '"') {
        const terminator = `"${"#".repeat(hashes)}`;
        const close = source.indexOf(terminator, index + 2 + hashes);
        if (close === -1) break;
        index = close + terminator.length - 1;
        continue;
      }
    }
    if (char === '"' || char === "'") {
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== char) {
        cursor += source[cursor] === "\\" ? 2 : 1;
      }
      // A lone `'` is a lifetime (`&'a str`), not a char literal — leave it be.
      if (char === "'" && cursor - index > 3) continue;
      index = cursor;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `missing ${startMarker}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start);
  expect(end, `missing ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("wiring-guard extraction", () => {
  // If this harness truncates a body, every `.not.toContain` guard below starts
  // passing vacuously — the guards would report success while guarding nothing.
  it("counts braces in code only, not in strings or comments", () => {
    const sample = [
      "fn sample(path: &Path) -> String {",
      '    let a = "an unbalanced { brace in a string";',
      "    // an unbalanced { brace in a line comment",
      "    /* an unbalanced { brace in a block comment */",
      '    let b = r#"a raw string with { and "quotes""#;',
      "    let c: &'static str = \"lifetime above must not open a char literal\";",
      "    if path.is_absolute() { return String::new(); }",
      "    SENTINEL",
      "}",
      "fn after() { NOT_PART_OF_SAMPLE }",
    ].join("\n");

    const body = functionBody(sample, "sample");
    expect(body).toContain("SENTINEL");
    expect(body).not.toContain("NOT_PART_OF_SAMPLE");
    expect(body.endsWith("}")).toBe(true);
  });

  it("reports a missing function instead of silently returning nothing", () => {
    expect(() => functionBody("fn other() {}", "absent")).toThrow();
  });
});

describe("native filesystem hardening wiring", () => {
  it("routes atomic writes through an unpredictable same-directory temporary file without a direct-write fallback", () => {
    expect(fileOps).toContain("NamedTempFile::new_in");
    expect(fileOps).not.toContain("std::fs::write(target, bytes)");
  });

  it("uses no-follow directory inspection and skips symlink entries", () => {
    expect(functionBody(fileOps, "read_directory")).toContain("file_type()");
    expect(functionBody(fileOps, "read_directory")).toContain("is_symlink()");
    expect(functionBody(fileOps, "read_directory")).not.toContain("metadata()");
  });

  it("uses no-clobber primitives for create and rename operations", () => {
    expect(functionBody(fileOps, "create_file")).toContain("create_new(true)");
    expect(functionBody(fileOps, "create_folder")).toContain("fs::create_dir(");
    expect(functionBody(fileOps, "rename_without_overwrite")).toContain("renamore::rename_exclusive");
  });

  it("enforces Tauri's user-mediated filesystem scope for every renderer-controlled path command", () => {
    for (const command of [
      "read_file",
      "write_file",
      "read_dir",
      "create_file",
      "create_folder",
      "rename_path",
      "trash_path",
      "path_exists",
      "watch_file",
    ]) {
      expect(functionBody(native, command)).toContain("ensure_allowed_path");
    }
  });

  it("checks a canonical existing parent before authorizing a new child path", () => {
    const authorization = functionBody(native, "ensure_allowed_path");
    expect(authorization).toContain("canonical_new_child_path");
    expect(authorization).toContain("app.fs_scope().is_allowed(path)");
    expect(authorization).toContain("app.fs_scope().is_allowed(&canonical_path)");
    expect(native).toContain("MARKD_PATH_NOT_AUTHORIZED");
  });

  it("persists dialog-granted scopes before restoring file-backed tabs", () => {
    expect(cargo).toContain('tauri-plugin-persisted-scope = { version = "2", features = ["protocol-asset"] }');
    expect(native.indexOf("tauri_plugin_fs::init()")).toBeLessThan(
      native.indexOf("tauri_plugin_persisted_scope::init()"),
    );
  });

  it("does not bypass a failed atomic native write and recursively grants an opened directory", () => {
    expect(fileSystem).not.toContain("writeTextFile");
    expect(fileSystem).toContain("open({ directory: true, recursive: true })");
  });

  it("requires an explicit chooser confirmation to recover an unauthorized recent path", () => {
    expect(fileSystem).toContain("tauriOpenFile(defaultPath?: string)");
    expect(fileSystem).toContain("openFile(defaultPath?: string)");
    const recentHandler = section(app, "const handleRecentFileSelect", "// File-tree CRUD");
    expect(recentHandler).toContain("isPathAuthorizationError(error)");
    expect(recentHandler).toContain("await handleOpenFile(file.path)");
  });

  it("classifies a failed restore instead of blaming authorization for every read error", () => {
    const startup = section(app, "const startupDone", "// Single-instance listener");
    // The copy itself lives in restore-failure.ts and is unit-tested there. What
    // must be pinned here is that App asks WHY the read failed: the previous
    // blanket catch told a user whose file had been deleted to re-authorize it.
    expect(startup).toContain("classifyRestoreFailure");
    expect(startup).toContain("restoreFailureNotice");
    expect(startup).toContain("pathExists");
  });

  it("keeps a tab whose file is only temporarily unreachable", () => {
    const startup = section(app, "const startupDone", "// Single-instance listener");
    // An offline share must not delete the session, so closeTab has to be gated
    // on a non-transient verdict in both the active- and background-tab arms.
    expect(startup).toContain('if (kind === "unavailable")');
    expect(startup).toContain('!== "unavailable") {');
    // ...and no catch arm may close unconditionally.
    expect(startup).not.toMatch(/catch\s*\{[^}]*?\bft\.closeTab\(/s);
  });

  it("never binds the editor to a tab whose file has not been read", () => {
    // A tab can name a real file and hold no bytes at all. Restoring one puts a
    // blank buffer and an empty savedContent behind that path, and the next
    // Ctrl+S truncates the file — so every restore goes through the helper that
    // reads it first, and no startup path calls restoreState on a raw tab.
    const helper = section(app, "const restoreTabIntoEditor", "// Startup owner:");
    expect(helper).toContain("if (tab.isHydrated || !tab.filePath)");
    expect(helper).toContain("await readFileByPath(tab.filePath)");
    expect(helper).toContain("hydrateTab(tab.id, content, revision)");

    const startup = section(app, "const startupDone", "// Single-instance listener");
    expect(startup).toContain("await restoreTabIntoEditor(switchTo, isCurrent)");
    expect(startup).not.toContain("fs.restoreState(switchTo)");

    // The unavailable active tab must not be left active over a foreign buffer.
    expect(startup).toContain(
      "ft.getTabsSnapshot().find((t) => t.id !== activeTab.id && t.isHydrated)",
    );

    // Hydration state is a flag, never inferred from an empty string: a document
    // the user emptied on purpose is not an unloaded one.
    const tabs = readFileSync("src/hooks/use-file-tabs.ts", "utf8");
    expect(tabs).toContain("isHydrated: boolean;");
    expect(tabs).toContain("if (current && !current.isHydrated) return current.content;");
    expect(app).toContain("(t) => t.filePath && !t.isHydrated");
    // Read through the LIVE accessors. The captured hook object's `tabs` and
    // `activeTabId` are useState values frozen into the render the effect fired
    // in, so reading them after the launch-file open returned pre-open state —
    // and the restore then loaded a different document over the user's file.
    expect(startup).toContain("const activeId = ft.getActiveTabId();");
    expect(startup).toContain("ft.getTabsSnapshot().filter((t) => t.filePath && !t.isHydrated)");
    expect(startup).not.toMatch(/const activeId = ft\.activeTabId/);
    expect(startup).not.toMatch(/ft\.tabs\.filter/);
    expect(app).toContain("if (!target.isHydrated && target.filePath) {");
    expect(app).not.toMatch(/!target\.content && target\.filePath/);
  });

  it("reaches the OS file-association open on every startup path", () => {
    const startup = section(app, "const startupDone", "// Single-instance listener");
    // One owner holds one buffer-load request. Two effects each taking their own
    // request meant the later one invalidated the earlier, and the double-clicked
    // file was fetched and then dropped.
    expect(app).not.toContain("const hydrationDone");
    expect(app).not.toContain("const initialLoadDone");
    expect(startup.match(/bufferLoadGuardRef\.current\.begin\(\)/g)?.length).toBe(1);
    expect(startup).toContain('invoke<{ path: string; name: string; content: string } | null>("get_opened_file")');
    // No early return may sit between the start of the effect and that call.
    const beforeOpen = startup.slice(0, startup.indexOf('"get_opened_file"'));
    expect(beforeOpen).not.toContain("if (needsHydration.length === 0) return;");
  });

  it("opens the OS-handed file before restoring the rest of the session", () => {
    const startup = section(app, "const startupDone", "// Single-instance listener");
    // The document the user double-clicked must not wait behind a disk read and
    // a full ProseMirror render of every persisted tab.
    const openAt = startup.indexOf('"get_opened_file"');
    const hydrateAt = startup.indexOf("const needsHydration");
    expect(openAt).toBeGreaterThan(-1);
    expect(hydrateAt).toBeGreaterThan(-1);
    expect(openAt).toBeLessThan(hydrateAt);

    // activeId must be read AFTER that open, and through the live accessor. It
    // is what makes the launch file drop out of needsHydration, which is what
    // stops the restore — and its failure-recovery branches — from pushing
    // another document over it.
    expect(startup.indexOf("const activeId = ft.getActiveTabId();")).toBeGreaterThan(openAt);

    // A matched existing tab is activated without content, so it must be given
    // the launch bytes or it stays unhydrated behind a real path.
    expect(startup).toContain("if (!tab.isHydrated) ft.hydrateTab(tab.id, file.content);");

    // A modal in front of the editor would undo the whole point of going first.
    expect(startup.indexOf("Open Failed")).toBeGreaterThan(hydrateAt);
  });

  it("does not mirror the initial empty file state onto a restored tab", () => {
    // The mount pass of this effect carries INITIAL_FILE_STATE. Applying it wiped
    // the restored tab's identity, bumped its revision so hydration aborted, and
    // re-persisted a session with no file-backed tabs.
    const mirror = section(app, "const mirroringUntouchedInitialState", "ft.markTabSaved(ft.activeTabId, {");
    // Must test the VALUE. A "skip the first run" ref is defeated by StrictMode's
    // dev double-invoke, which arms on pass one and applies the initial state on
    // pass two — the same bug, on every dev launch.
    expect(app).not.toContain("fileStateMirrorArmed");
    expect(mirror).toContain("fileState.filePath === null");
    expect(mirror).toContain('fileState.fileName === "Untitled"');
    expect(mirror).toContain('fileState.savedContent === ""');
    expect(mirror).toContain("fileState.openCount === 0");
    expect(mirror).toContain("if (mirroringUntouchedInitialState) return;");
    // A dirty buffer whose path changed has not been saved — mirroring it
    // through markTabSaved would clear isDirty and disarm the close guard.
    expect(mirror).toContain("if (fileStateRef.current.isDirty) {");
    expect(mirror).toContain("ft.updateTabPath(ft.activeTabId, fileState.filePath, fileState.fileName)");
  });

  it("reads tab state live wherever a handler continues past an await", () => {
    // useFileTabs returns a plain object literal: `tabs` and `activeTabId` on it
    // are useState VALUES frozen into the render that produced it, while the
    // function members are ref-backed. Anything that captures the hook object
    // and then awaits must ask through the accessors, or it acts on state from
    // before its own mutations — which shipped once as the startup restore
    // loading a different document over the one the user opened, and lurks in
    // every save path that writes tab.content.
    const saveAll = section(app, "const saveAllDirtyTabs", "const handleCloseAllTabs");
    expect(saveAll).toContain("ft.getActiveTabId()");
    expect(saveAll).toContain("ft\n      .getTabsSnapshot()\n      .filter((tab) => tab.isDirty");
    expect(saveAll).not.toMatch(/ft\.tabs\.filter/);
    expect(saveAll).not.toMatch(/const activeTabId = ft\.activeTabId/);

    const startup = section(app, "const startupDone", "// Single-instance listener");
    expect(startup).not.toMatch(/ft\.tabs\b/);
    expect(startup).not.toMatch(/ft\.activeTabId\b/);
  });

  it("compares file paths by identity so one file cannot become two tabs", () => {
    // The native layer canonicalizes and a dialog does not, so `===` on the raw
    // strings split one file into two tabs, two Recent Files rows and two write
    // queues.
    expect(app).not.toMatch(/\.filePath === (filePath|opened\.path|entry\.path|file\.path)\b/);
    expect(readFileSync("src/hooks/use-file-tabs.ts", "utf8")).toContain(
      "currentTabs.find((t) => samePath(t.filePath, filePath))",
    );
    expect(readFileSync("src/hooks/use-recent-files.ts", "utf8")).toContain(
      "prev.filter((f) => !samePath(f.path, path))",
    );
    expect(readFileSync("src/lib/file-write-queue.ts", "utf8")).toContain(
      "const key = normalizePathKey(filePath);",
    );
  });

  it("gives the renderer a distinct code for an unreachable path", () => {
    // A transient share failure is not a revoked grant. Reporting it as one told
    // the user to re-authorize an intact grant and discarded their tab.
    expect(native).toContain("MARKD_PATH_UNAVAILABLE");
    expect(functionBody(native, "path_inspection_error")).toContain(
      "std::io::ErrorKind::InvalidInput => path_authorization_error()",
    );
    expect(functionBody(native, "ensure_allowed_path")).not.toContain(
      "Err(_) => return Err(path_authorization_error())",
    );
    expect(readFileSync("src/lib/file-system.ts", "utf8")).toContain(
      "export function isPathUnavailableError",
    );
  });

  it("hands the renderer the same path spelling a file dialog would produce", () => {
    // canonicalize() yields \\?\ paths on Windows; dialogs do not. Returning the
    // canonical form made one file arrive under two names.
    expect(functionBody(native, "get_opened_file_from_args")).toContain(
      "file_ops::display_path(&canonical_path)",
    );
    expect(fileOps).toContain("fn display_path(");
    expect(fileOps).toContain("fn simplify_verbatim_unc(");
  });

  it("resolves a relative launch argument against the launching process's directory", () => {
    expect(fileOps).toContain("fn resolve_launch_path(");
    // Both entry points share the rule; single-instance previously ignored cwd.
    expect(native).toContain("file_ops::resolve_launch_path(arg, std::path::Path::new(&cwd))");
    expect(functionBody(native, "get_file_path_from_args")).toContain("file_ops::resolve_launch_path");
  });

  it("surfaces manual native save and export failures without a renderer write fallback", () => {
    const save = section(app, "const saveActiveTab", "const saveActiveTabAs");
    expect(save).toContain("Save Failed");
    // The message text lives in save-outcome.ts, which is what decides that a
    // cancelled dialog and a superseded (already-written) save stay silent while
    // a genuine write failure speaks up — including for an untitled document,
    // which the old `beforeSave.filePath` gate excluded.
    expect(save).toContain("saveOutcomeMessage(outcome, beforeSave.fileName)");
    const nonWrittenBranch = save.slice(
      save.indexOf('if (outcome !== "written")'),
      save.indexOf("if (ft.getActiveTabId() !== tabId)"),
    );
    expect(nonWrittenBranch).not.toContain("beforeSave.filePath");
    expect(readFileSync("src/lib/save-outcome.ts", "utf8")).toContain("contents remain unsaved");
    const exportHandler = section(app, "const handleExportHtml", "// Sync tab state");
    expect(exportHandler).toContain("Export Failed");
  });

  it("does not retain a global asset-protocol filesystem grant", () => {
    expect(tauriConfig.app.security.assetProtocol.scope).toEqual([]);
    expect(cargo).toContain('tauri-plugin-persisted-scope = { version = "2", features = ["protocol-asset"] }');
  });

  it("lets an authorized document's folder serve that document's images", () => {
    // Relative image sources resolve against the document's folder, so granting
    // only the .md file left every ![](./img/x.png) broken. The grant is
    // asset-protocol (display) scope only and is taken solely after the
    // filesystem gate has already authorized the document.
    const grant = functionBody(native, "allow_document_assets");
    expect(grant).toContain("asset_protocol_scope()");
    expect(grant).toContain("allow_directory(parent, true)");
    expect(grant).not.toContain("fs_scope()");
    for (const entryPoint of ["grant_file_access", "read_file"]) {
      expect(functionBody(native, entryPoint)).toContain("allow_document_assets");
    }
    // read_file must authorize before it widens anything.
    const readFile = functionBody(native, "read_file");
    expect(readFile.indexOf("ensure_allowed_path")).toBeLessThan(
      readFile.indexOf("allow_document_assets"),
    );
    // ...and must not pay for the canonical path twice. ensure_allowed_path
    // already walks every component and canonicalizes; re-deriving it for the
    // asset grant doubled the authorization cost of every open, which is
    // measurable on a network path where each component stat is a round trip.
    expect(readFile).not.toContain("file_ops::canonical_existing_path");
    expect(functionBody(native, "ensure_allowed_path")).toContain("Ok(canonical_path)");
    // Re-granting a folder already in the asset scope fires a scope event, and
    // persisted-scope rewrites its whole state file per event — an unbounded
    // ratchet that the NEXT startup pays for before the window exists.
    expect(grant).toContain("if app.asset_protocol_scope().is_allowed(parent)");
  });

  it("asks the scope the same question once for a path that exists", () => {
    // is_allowed canonicalizes its argument, so for an existing path
    // is_allowed(path) and is_allowed(canonical_path) are the same query — and
    // each canonicalize is a round trip per component on a network share. A
    // missing leaf cannot be canonicalized and still needs both forms checked.
    const authorization = functionBody(native, "ensure_allowed_path");
    expect(authorization).toContain("let allowed = if path_exists_for_scope {");
    expect(authorization).toContain("app.fs_scope().is_allowed(&canonical_path)");
    expect(authorization).toContain(
      "app.fs_scope().is_allowed(path) && app.fs_scope().is_allowed(&canonical_path)",
    );
  });
});
