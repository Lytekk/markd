import { describe, it, expect } from "vitest";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
  it("returns empty frontmatter when there is none", () => {
    const md = "# Title\n\nBody";
    expect(splitFrontmatter(md)).toEqual({ frontmatter: "", body: md });
  });

  it("splits a standard block and round-trips byte-for-byte (no corruption)", () => {
    const md = "---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n";
    const { frontmatter, body } = splitFrontmatter(md);
    expect(frontmatter).toBe("---\ntitle: Hello\ntags: [a, b]\n---\n");
    expect(body).toBe("\n# Body\n");
    expect(joinFrontmatter(frontmatter, body)).toBe(md);
  });

  it("does not treat a horizontal rule mid-document as frontmatter", () => {
    const md = "# Title\n\n---\n\nMore";
    expect(splitFrontmatter(md).frontmatter).toBe("");
  });

  it("does not treat a --- that isn't on line 1 as frontmatter", () => {
    const md = "\n---\ntitle: x\n---\n";
    expect(splitFrontmatter(md).frontmatter).toBe("");
  });

  it("handles the ... closing fence", () => {
    const md = "---\ntitle: x\n...\nBody";
    expect(splitFrontmatter(md).frontmatter).toBe("---\ntitle: x\n...\n");
    expect(splitFrontmatter(md).body).toBe("Body");
  });

  it("joinFrontmatter with empty frontmatter returns body unchanged", () => {
    expect(joinFrontmatter("", "body")).toBe("body");
  });
});
