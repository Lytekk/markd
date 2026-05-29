import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildCodeBlockDecorations,
  copyToClipboard,
  createCodeBlockToolbar,
} from "./code-block-enhance";
import { createTestDoc } from "@/test/editor-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // jsdom has no execCommand; tests that add it must not leak it to other tests.
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

/** jsdom doesn't implement execCommand, so install a stub the impl can call. */
function stubExecCommand(impl: () => boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  (document as unknown as { execCommand: unknown }).execCommand = fn;
  return fn;
}

describe("buildCodeBlockDecorations", () => {
  it("adds no decorations when the document has no code blocks", () => {
    const doc = createTestDoc([
      { type: "heading", text: "Title", level: 1 },
      { type: "paragraph", text: "no code here" },
    ]);
    expect(buildCodeBlockDecorations(doc).find().length).toBe(0);
  });

  it("adds exactly one widget decoration per code block", () => {
    const doc = createTestDoc([
      { type: "paragraph", text: "intro" },
      { type: "code", text: "const x = 1;", language: "js" },
    ]);
    expect(buildCodeBlockDecorations(doc).find().length).toBe(1);
  });

  it("adds a decoration for each of several code blocks", () => {
    const doc = createTestDoc([
      { type: "code", text: "a", language: "js" },
      { type: "paragraph", text: "between" },
      { type: "code", text: "b" },
      { type: "code", text: "c", language: "rust" },
    ]);
    expect(buildCodeBlockDecorations(doc).find().length).toBe(3);
  });
});

describe("createCodeBlockToolbar", () => {
  it("shows the language label", () => {
    const bar = createCodeBlockToolbar("rust", () => "");
    expect(bar.querySelector(".markd-code-lang")?.textContent).toBe("rust");
  });

  it("falls back to 'text' for null / plaintext languages", () => {
    expect(
      createCodeBlockToolbar(null, () => "").querySelector(".markd-code-lang")?.textContent,
    ).toBe("text");
    expect(
      createCodeBlockToolbar("plaintext", () => "").querySelector(".markd-code-lang")
        ?.textContent,
    ).toBe("text");
  });

  it("is non-editable so the webview cannot place the caret inside it", () => {
    expect(createCodeBlockToolbar("js", () => "").getAttribute("contenteditable")).toBe("false");
  });

  it("copies the code text (read live at click time) when the button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    let current = "const x = 1;";
    const bar = createCodeBlockToolbar("js", () => current);
    const btn = bar.querySelector("button") as HTMLButtonElement;

    current = "const x = 2;"; // text changes before the click
    btn.click();

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 2;"));
    await vi.waitFor(() => expect(btn.textContent).toBe("Copied!"));
  });
});

describe("copyToClipboard", () => {
  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the clipboard API is missing", async () => {
    vi.stubGlobal("navigator", {});
    const exec = stubExecCommand(() => true);
    await expect(copyToClipboard("hi")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("returns false when both clipboard paths fail", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    stubExecCommand(() => false); // execCommand runs but reports failure
    await expect(copyToClipboard("x")).resolves.toBe(false);
  });
});
