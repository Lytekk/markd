import { expect, it } from "vitest";
import { applySourceCommand } from "./source-commands";
it("formats the selected text and keeps it selected for the next command", () => {
  expect(applySourceCommand("alpha beta", { start: 6, end: 10 }, "Bold")).toEqual({ text: "alpha **beta**", start: 8, end: 12 });
  expect(applySourceCommand("alpha **beta**", { start: 8, end: 12 }, "Bold")).toEqual({ text: "alpha beta", start: 6, end: 10 });
});
it("applies heading and list actions to the current source lines", () => {
  expect(applySourceCommand("one\ntwo", { start: 0, end: 7 }, "Bullet List").text).toBe("- one\n- two");
  expect(applySourceCommand("## title", { start: 3, end: 8 }, "Heading 1").text).toBe("# title");
});
it("supports the complete source toolbar command set", () => {
  for (const command of ["Bold", "Italic", "Strikethrough", "Code", "Heading 1", "Heading 2", "Heading 3", "Bullet List", "Ordered List", "Task List", "Blockquote", "Code Block", "Horizontal Rule", "Insert Table"] as const) {
    const result = applySourceCommand("text", { start: 0, end: 4 }, command);
    expect(result.text).not.toBe("text");
    expect(result.start).toBeGreaterThanOrEqual(0);
    expect(result.end).toBeLessThanOrEqual(result.text.length);
  }
});

it("toggles numbered lists and fenced code without duplicating delimiters", () => {
  expect(applySourceCommand("1. one\n2. two", { start: 3, end: 13 }, "Ordered List").text).toBe("one\ntwo");
  expect(applySourceCommand("```\none\ntwo\n```", { start: 4, end: 11 }, "Code Block").text).toBe("one\ntwo");
});
