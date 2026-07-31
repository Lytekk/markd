import { describe, expect, it } from "vitest";
import { isPathInside } from "./path-scope";

describe("isPathInside", () => {
  it("matches the path itself", () => {
    expect(isPathInside("/notes/a.md", "/notes/a.md")).toBe(true);
  });

  it("matches a descendant of a folder", () => {
    expect(isPathInside("/notes/sub/a.md", "/notes")).toBe(true);
    expect(isPathInside("D:\\notes\\sub\\a.md", "D:\\notes")).toBe(true);
  });

  it("does not match a sibling that merely shares a name prefix", () => {
    // "/notes-archive" starts with "/notes" as a string but is a different tree.
    expect(isPathInside("/notes-archive/a.md", "/notes")).toBe(false);
    expect(isPathInside("D:\\notes-archive\\a.md", "D:\\notes")).toBe(false);
  });

  it("ignores separator style and Windows path spelling", () => {
    expect(isPathInside("\\\\?\\D:\\notes\\a.md", "D:/notes")).toBe(true);
    expect(isPathInside("D:/notes/a.md", "D:\\notes")).toBe(true);
  });

  it("is case-insensitive on Windows paths and case-sensitive on POSIX", () => {
    expect(isPathInside("D:\\Notes\\A.md", "d:\\notes")).toBe(true);
    expect(isPathInside("/Notes/a.md", "/notes")).toBe(false);
  });

  it("treats a missing path as inside nothing", () => {
    expect(isPathInside(null, "/notes")).toBe(false);
    expect(isPathInside("/notes/a.md", "")).toBe(false);
  });

  it("tolerates a trailing separator on the root", () => {
    expect(isPathInside("/notes/a.md", "/notes/")).toBe(true);
  });
});
