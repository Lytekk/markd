import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const native = readFileSync("src-tauri/src/lib.rs", "utf8");
const fileOps = readFileSync("src-tauri/src/file_ops.rs", "utf8");
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
const fileSystem = readFileSync("src/lib/file-system.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`fn ${name}(`);
  expect(start, `missing ${name}`).toBeGreaterThanOrEqual(0);
  const openingBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
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
    // Both the active-tab and background-tab catch arms must gate closeTab on a
    // non-transient verdict. An offline share must not delete the session.
    const closeGuards = startup.match(/!== "unavailable"\) \{/g) ?? [];
    expect(closeGuards.length).toBe(2);
    expect(startup).not.toMatch(/catch\s*\{\s*if \(isCurrent\(\)\) \{\s*ft\.closeTab/);
  });

  it("puts the successor tab in the editor when a failed active tab is closed", () => {
    const startup = section(app, "const startupDone", "// Single-instance listener");
    expect(startup).toContain("const { switchTo } = ft.closeTab(activeTab.id)");
    expect(startup).toContain("fs.restoreState(switchTo)");
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

  it("does not mirror the initial empty file state onto a restored tab", () => {
    // The mount pass of this effect carries INITIAL_FILE_STATE. Applying it wiped
    // the restored tab's identity, bumped its revision so hydration aborted, and
    // re-persisted a session with no file-backed tabs.
    const mirror = section(app, "const fileStateMirrorArmed", "useEffect(() => {\n    const ft = fileTabsRef.current;\n    if (fileState.isDirty)");
    expect(mirror).toContain("if (!fileStateMirrorArmed.current) {");
    expect(mirror).toContain("fileStateMirrorArmed.current = true;");
    expect(mirror).toContain("ft.markTabSaved(ft.activeTabId, {");
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
    expect(save).not.toContain("beforeSave.filePath");
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
  });
});
