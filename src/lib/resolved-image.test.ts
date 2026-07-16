import { describe, expect, it } from "vitest";
import { resolveImageSrc } from "./resolved-image";

describe("resolveImageSrc", () => {
  it("rejects markdown-supplied local-protocol image URLs", () => {
    expect(resolveImageSrc("asset://localhost/etc/passwd", "/workspace")).toBe("");
    expect(resolveImageSrc("file:///etc/passwd", "/workspace")).toBe("");
    expect(resolveImageSrc("tauri://localhost/etc/passwd", "/workspace")).toBe("");
  });

  it("preserves non-filesystem image sources", () => {
    expect(resolveImageSrc("https://example.com/image.png", "/workspace")).toBe("https://example.com/image.png");
    expect(resolveImageSrc("data:image/png;base64,abc", "/workspace")).toBe("data:image/png;base64,abc");
    expect(resolveImageSrc("blob:https://example.com/image", "/workspace")).toBe("blob:https://example.com/image");
  });
});
