import { describe, it, expect } from "vitest";
import {
  validateName,
  ensureMdExtension,
  parentPath,
  joinPath,
  targetDirForEntry,
} from "./file-tree-ops";

describe("validateName", () => {
  it("accepts an ordinary name", () => {
    expect(validateName("notes.md")).toBeNull();
    expect(validateName("My Folder")).toBeNull();
  });

  it("rejects empty / whitespace-only names", () => {
    expect(validateName("")).toMatch(/required/i);
    expect(validateName("   ")).toMatch(/required/i);
  });

  it("rejects path separators (no traversal / nesting via the name field)", () => {
    expect(validateName("a/b")).toMatch(/slash/i);
    expect(validateName("a\\b")).toMatch(/slash/i);
  });

  it("rejects Windows-reserved characters", () => {
    for (const ch of ['<', '>', ':', '"', '|', '?', '*']) {
      expect(validateName(`bad${ch}name`)).toMatch(/invalid character/i);
    }
  });

  it("rejects . and .. and trailing dots/spaces (Windows-hostile)", () => {
    expect(validateName(".")).not.toBeNull();
    expect(validateName("..")).not.toBeNull();
    expect(validateName("name.")).not.toBeNull();
    expect(validateName("name ")).not.toBeNull();
  });
});

describe("ensureMdExtension", () => {
  it("appends .md to an extensionless name", () => {
    expect(ensureMdExtension("notes")).toBe("notes.md");
  });
  it("leaves a recognized text extension untouched", () => {
    expect(ensureMdExtension("notes.md")).toBe("notes.md");
    expect(ensureMdExtension("readme.markdown")).toBe("readme.markdown");
    expect(ensureMdExtension("log.txt")).toBe("log.txt");
    expect(ensureMdExtension("spec.mdx")).toBe("spec.mdx");
  });
  it("leaves an explicit (even non-text) extension as the user typed it", () => {
    // Non-text extensions won't appear in the filtered tree — a documented v1
    // limitation — but we don't silently rewrite the user's chosen name.
    expect(ensureMdExtension("data.json")).toBe("data.json");
  });
});

describe("parentPath", () => {
  it("strips the last segment of a Windows path", () => {
    expect(parentPath("C:\\Users\\a\\notes.md")).toBe("C:\\Users\\a");
  });
  it("strips the last segment of a POSIX path", () => {
    expect(parentPath("/home/x/notes.md")).toBe("/home/x");
  });
  it("returns empty string when there is no parent", () => {
    expect(parentPath("notes.md")).toBe("");
  });
});

describe("joinPath", () => {
  it("joins with the separator already used by the directory", () => {
    expect(joinPath("C:\\Users\\a", "new.md")).toBe("C:\\Users\\a\\new.md");
    expect(joinPath("/home/x", "new.md")).toBe("/home/x/new.md");
  });
  it("does not double a trailing separator", () => {
    expect(joinPath("C:\\Users\\a\\", "new.md")).toBe("C:\\Users\\a\\new.md");
    expect(joinPath("/home/x/", "new.md")).toBe("/home/x/new.md");
  });
});

describe("targetDirForEntry", () => {
  const root = "/home/x/project";
  it("uses the directory itself when the right-clicked entry is a folder", () => {
    expect(targetDirForEntry({ path: "/home/x/project/sub", isDirectory: true }, root)).toBe(
      "/home/x/project/sub",
    );
  });
  it("uses the parent dir when the right-clicked entry is a file", () => {
    expect(targetDirForEntry({ path: "/home/x/project/sub/a.md", isDirectory: false }, root)).toBe(
      "/home/x/project/sub",
    );
  });
  it("falls back to the root when there is no entry (empty-area click)", () => {
    expect(targetDirForEntry(null, root)).toBe(root);
  });
});
