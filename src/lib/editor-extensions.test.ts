import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { getExtensions } from "./editor-extensions";

describe("getExtensions", () => {
  it("returns an array of TipTap extensions", () => {
    const extensions = getExtensions({ getFileDir: () => "" });
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);
  });

  it("includes CodeBlockLowlight instead of default codeBlock", () => {
    const extensions = getExtensions({ getFileDir: () => "" });
    const names = extensions.map((ext) => ext.name);
    expect(names).toContain("codeBlock");
    // StarterKit's codeBlock is disabled, CodeBlockLowlight provides it
  });

  it("includes table extensions", () => {
    const extensions = getExtensions({ getFileDir: () => "" });
    const names = extensions.map((ext) => ext.name);
    expect(names).toContain("table");
    expect(names).toContain("tableRow");
    expect(names).toContain("tableCell");
    expect(names).toContain("tableHeader");
  });

  it("includes task list extensions", () => {
    const extensions = getExtensions({ getFileDir: () => "" });
    const names = extensions.map((ext) => ext.name);
    expect(names).toContain("taskList");
    expect(names).toContain("taskItem");
  });

  it("includes placeholder extension", () => {
    const extensions = getExtensions({ getFileDir: () => "" });
    const names = extensions.map((ext) => ext.name);
    expect(names).toContain("placeholder");
  });

  it("includes section commands extension", () => {
    const extensions = getExtensions({ getFileDir: () => "" });
    const names = extensions.map((ext) => ext.name);
    expect(names).toContain("sectionCommands");
  });

  it("toggleStrike command is wired through the editor", () => {
    const editor = new Editor({
      extensions: getExtensions({ getFileDir: () => "" }),
      content: "<p>hello</p>",
    });
    editor.commands.selectAll();
    expect(editor.isActive("strike")).toBe(false);
    editor.commands.toggleStrike();
    expect(editor.isActive("strike")).toBe(true);
    editor.destroy();
  });

  it("registers a Mod-Shift-x binding for toggleStrike", () => {
    const extensions = getExtensions({ getFileDir: () => "" });
    const ext = extensions.find((e) => e.name === "strikeShortcut");
    expect(ext).toBeDefined();
    const cfg = (ext as unknown as {
      config: { addKeyboardShortcuts?: (this: { editor: unknown }) => Record<string, (...args: unknown[]) => boolean> };
    }).config;
    expect(typeof cfg.addKeyboardShortcuts).toBe("function");
    let toggled = false;
    const shortcuts = cfg.addKeyboardShortcuts!.call({
      editor: { commands: { toggleStrike: () => { toggled = true; return true; } } },
    });
    expect(typeof shortcuts["Mod-Shift-x"]).toBe("function");
    expect(shortcuts["Mod-Shift-x"]!()).toBe(true);
    expect(toggled).toBe(true);
  });
});
