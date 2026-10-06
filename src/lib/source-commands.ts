import type { TextRange } from "./text-search";
export type SourceCommand = "Bold" | "Italic" | "Strikethrough" | "Code" | "Heading 1" | "Heading 2" | "Heading 3" | "Heading 4" | "Heading 5" | "Heading 6" | "Bullet List" | "Ordered List" | "Task List" | "Blockquote" | "Code Block" | "Horizontal Rule" | "Insert Table";
export interface SourceCommandResult extends TextRange { text: string }

export function applySourceCommand(text: string, range: TextRange, command: SourceCommand): SourceCommandResult {
  let { start, end } = range;
  const wrap = ({ Bold: "**", Italic: "*", Strikethrough: "~~", Code: "`" } as Partial<Record<SourceCommand, string>>)[command];
  if (wrap) {
    if (text.slice(Math.max(0, start - wrap.length), start) === wrap && text.slice(end, end + wrap.length) === wrap) {
      return { text: text.slice(0, start - wrap.length) + text.slice(start, end) + text.slice(end + wrap.length), start: start - wrap.length, end: end - wrap.length };
    }
    return { text: text.slice(0, start) + wrap + text.slice(start, end) + wrap + text.slice(end), start: start + wrap.length, end: end + wrap.length };
  }
  if (command === "Horizontal Rule" || command === "Insert Table") {
    const insert = command === "Horizontal Rule" ? "\n\n---\n\n" : "\n\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n\n";
    return { text: text.slice(0, start) + insert + text.slice(end), start: start + insert.length, end: start + insert.length };
  }
  const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const after = text.indexOf("\n", Math.max(start, end - 1));
  const lineEnd = after < 0 ? text.length : after;
  const body = text.slice(lineStart, lineEnd);
  if (command === "Code Block") {
    const before = text.slice(0, lineStart);
    const opening = /(?:^|\n)(```[^\n]*|~~~[^\n]*)\n$/.exec(before);
    const closing = /^\n(```|~~~)(?=\n|$)/.exec(text.slice(lineEnd));
    if (opening && closing && opening[1]!.slice(0, 3) === closing[1]) {
      const fenceStart = before.length - opening[0].length + (opening[0].startsWith("\n") ? 1 : 0);
      const removed = lineStart - fenceStart;
      return { text: text.slice(0, fenceStart) + body + text.slice(lineEnd + closing[0].length), start: start - removed, end: end - removed };
    }
    if (body.startsWith("```\n") && body.endsWith("\n```")) {
      const inner = body.slice(4, -4);
      return { text: text.slice(0, lineStart) + inner + text.slice(lineEnd), start: lineStart, end: lineStart + inner.length };
    }
    return { text: text.slice(0, lineStart) + "```\n" + body + "\n```" + text.slice(lineEnd), start: start + 4, end: end + 4 };
  }
  const heading = command.startsWith("Heading ") ? Number(command.slice(-1)) : null;
  const prefix = heading ? "#".repeat(heading) + " " : command === "Bullet List" ? "- " : command === "Ordered List" ? "1. " : command === "Task List" ? "- [ ] " : "> ";
  const pattern = heading ? /^ {0,3}#{1,6}\s+/ : command === "Blockquote" ? /^>\s?/ : /^(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
  const lines = body.split("\n");
  const remove = lines.every(line => command === "Ordered List" ? /^\d+[.)]\s/.test(line) : line.startsWith(prefix));
  let oldOffset = lineStart, newOffset = lineStart;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const oldPrefix = pattern.exec(line)?.[0] ?? "";
    const newPrefix = remove ? "" : (command === "Ordered List" ? `${i + 1}. ` : prefix);
    const changed = newPrefix + line.slice(oldPrefix.length);
    if (range.start >= oldOffset && range.start <= oldOffset + line.length) start = newOffset + Math.max(newPrefix.length, range.start - oldOffset - oldPrefix.length + newPrefix.length);
    if (range.end >= oldOffset && range.end <= oldOffset + line.length) end = newOffset + Math.max(newPrefix.length, range.end - oldOffset - oldPrefix.length + newPrefix.length);
    oldOffset += line.length + 1; newOffset += changed.length + 1; lines[i] = changed;
  }
  return { text: text.slice(0, lineStart) + lines.join("\n") + text.slice(lineEnd), start, end };
}

export function sourceShortcut(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): SourceCommand | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  const key = e.key.toLowerCase();
  if (e.altKey) {
    if (/^[1-6]$/.test(key)) return `Heading ${key}` as SourceCommand;
    return key === "c" ? "Code Block" : null;
  }
  if (e.shiftKey) {
    if (key === "x") return "Strikethrough";
    if (key === "b") return "Blockquote";
    if (e.code === "Digit8" || key === "8" || key === "*") return "Bullet List";
    if (e.code === "Digit7" || key === "7" || key === "&") return "Ordered List";
    if (e.code === "Digit9" || key === "9" || key === "(") return "Task List";
    return null;
  }
  return ({ b: "Bold", i: "Italic", e: "Code" } as Record<string, SourceCommand>)[key] ?? null;
}
