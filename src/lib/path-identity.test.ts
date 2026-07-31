import { describe, expect, it } from "vitest";
import { normalizePathKey, samePath } from "./path-identity";

describe("normalizePathKey", () => {
  it("collapses the Windows extended-length disk prefix", () => {
    expect(normalizePathKey("\\\\?\\D:\\notes\\a.md")).toBe(normalizePathKey("D:\\notes\\a.md"));
  });

  it("collapses the Windows extended-length UNC prefix", () => {
    expect(normalizePathKey("\\\\?\\UNC\\host\\share\\a.md")).toBe(
      normalizePathKey("\\\\host\\share\\a.md"),
    );
  });

  it("treats Windows paths case-insensitively", () => {
    expect(normalizePathKey("D:\\Notes\\A.md")).toBe(normalizePathKey("d:\\notes\\a.md"));
  });

  it("keeps the path below a UNC share case-sensitive", () => {
    // Windows resolves the server and share names case-insensitively, but what
    // the remote filesystem does below them is its own business — a WSL or Samba
    // export really can hold both Notes.md and notes.md.
    expect(normalizePathKey("\\\\host\\share\\A.md")).not.toBe(
      normalizePathKey("\\\\host\\share\\a.md"),
    );
    expect(normalizePathKey("\\\\HOST\\SHARE\\a.md")).toBe(
      normalizePathKey("\\\\host\\share\\a.md"),
    );
  });

  it("keeps POSIX paths case-sensitive", () => {
    expect(normalizePathKey("/home/me/A.md")).not.toBe(normalizePathKey("/home/me/a.md"));
  });

  it("ignores separator style and duplicate separators within a Windows path", () => {
    expect(normalizePathKey("D:/notes//a.md")).toBe(normalizePathKey("D:\\notes\\a.md"));
  });

  it("keeps the leading double separator of a UNC path", () => {
    expect(normalizePathKey("\\\\host\\share\\a.md")).not.toBe(
      normalizePathKey("\\host\\share\\a.md"),
    );
  });

  it("ignores a trailing separator", () => {
    expect(normalizePathKey("D:\\notes\\")).toBe(normalizePathKey("D:\\notes"));
  });

  it("distinguishes genuinely different files", () => {
    expect(normalizePathKey("D:\\notes\\a.md")).not.toBe(normalizePathKey("D:\\notes\\b.md"));
  });

  it("returns a stable value for empty and root inputs instead of throwing", () => {
    expect(normalizePathKey("")).toBe("");
    expect(normalizePathKey("/")).toBe("/");
  });
});

describe("samePath", () => {
  it("matches the two spellings the app produces for one file", () => {
    // The native side canonicalizes; a file dialog does not. Before this helper
    // the same file opened as two tabs with two Recent Files rows.
    expect(samePath("\\\\?\\D:\\notes\\a.md", "D:\\notes\\a.md")).toBe(true);
    expect(
      samePath("\\\\?\\UNC\\host\\share\\a.md", "\\\\host\\share\\a.md"),
    ).toBe(true);
  });

  it("does not match different files", () => {
    expect(samePath("D:\\notes\\a.md", "D:\\notes\\b.md")).toBe(false);
  });

  it("treats null and undefined as matching nothing, including each other", () => {
    expect(samePath(null, null)).toBe(false);
    expect(samePath(undefined, "D:\\notes\\a.md")).toBe(false);
    expect(samePath("D:\\notes\\a.md", null)).toBe(false);
  });

  it("treats an empty string as matching nothing", () => {
    expect(samePath("", "")).toBe(false);
  });
});
