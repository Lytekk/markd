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

  it("tells users when persisted tabs cannot be restored instead of failing silently", () => {
    const hydration = section(app, "const hydrationDone", "// Single-instance listener");
    expect(hydration).toContain("could not be restored");
    expect(hydration).toContain("Reopen Files");
  });

  it("surfaces manual native save and export failures without a renderer write fallback", () => {
    const save = section(app, "const saveActiveTab", "const saveActiveTabAs");
    expect(save).toContain("Save Failed");
    expect(save).toContain("contents remain unsaved");
    const exportHandler = section(app, "const handleExportHtml", "// Sync tab state");
    expect(exportHandler).toContain("Export Failed");
  });

  it("does not retain a global asset-protocol filesystem grant", () => {
    expect(tauriConfig.app.security.assetProtocol.scope).toEqual([]);
    expect(cargo).toContain('tauri-plugin-persisted-scope = { version = "2", features = ["protocol-asset"] }');
  });
});
