import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { splitFrontmatter } from "./frontmatter";

export interface TextStats {
  words: number;
  chars: number;
}

export interface MarkdownStatsToken {
  type: string;
  content: string;
  children?: MarkdownStatsToken[] | null;
  level?: number;
  attrs?: Array<[string, string]> | null;
}

/**
 * Word/char counts shown in the status bar. Words are whitespace-separated
 * runs; characters include the newlines that separate visible blocks.
 */
export function computeTextStats(text: string): TextStats {
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    chars: text.length,
  };
}

/**
 * Count the text a rendered ProseMirror document exposes to the reader.
 *
 * `textContent` concatenates adjacent blocks ("hello" + "world" becomes
 * "helloworld"), corrupting both word and character counts. `textBetween`
 * preserves one logical newline between blocks while still excluding Markdown
 * syntax and non-text atoms.
 */
export function computeDocumentTextStats(doc: PMNode): TextStats {
  return computeTextStats(doc.textBetween(0, doc.content.size, "\n"));
}

const INLINE_ATOM_PLACEHOLDER = "\ufffc";
const COLLAPSIBLE_HTML_WHITESPACE = /[\t\n\f\r ]+/g;

/**
 * Reproduce the text ProseMirror gets after markdown-it's inline tokens pass
 * through HTML whitespace normalization. Atom nodes (images, raw-HTML chips,
 * math, hard breaks) are temporarily represented by a non-space placeholder:
 * they contribute no characters to `textBetween`, but their DOM position keeps
 * adjacent leading/trailing spaces from being trimmed (notably task items).
 */
function visibleInlineText(children: MarkdownStatsToken[]): string {
  let text = "";
  let previousTokenRenderedElement = false;
  for (const token of children) {
    if (token.type === "text") {
      text += token.content;
      // markdown-it can emit empty text tokens immediately after a closing
      // mark. They produce no DOM sibling, so retain the element boundary for
      // the following softbreak normalization.
      if (token.content) previousTokenRenderedElement = false;
    } else if (token.type === "code_inline") {
      text += token.content;
      previousTokenRenderedElement = true;
    } else if (token.type === "softbreak") {
      // tiptap-markdown removes a leading newline from every text node that
      // follows a rendered element. That makes `**bold**\nnext`, image/math/raw
      // atoms followed by a softbreak, etc. concatenate exactly this way in PM.
      if (!previousTokenRenderedElement) text += " ";
      previousTokenRenderedElement = false;
    } else if (token.type.endsWith("_close")) {
      previousTokenRenderedElement = true;
    } else if (!token.type.endsWith("_open")) {
      text += INLINE_ATOM_PLACEHOLDER;
      previousTokenRenderedElement = true;
    }
  }

  return text
    .replace(COLLAPSIBLE_HTML_WHITESPACE, " ")
    .replace(/^ | $/g, "")
    .split(INLINE_ATOM_PLACEHOLDER)
    .join("");
}

/**
 * Count visible document text directly from markdown-it tokens. Every inline
 * token group and code fence maps to one ProseMirror textblock; joining those
 * groups with `\n` matches `PMNode.textBetween(..., "\n")`. Block atoms such
 * as rules, raw HTML, and display math intentionally contribute no text.
 */
export function computeMarkdownTokenTextStats(tokens: MarkdownStatsToken[]): TextStats {
  const blocks: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.type === "list_item_open") {
      const next = tokens[index + 1];
      // ProseMirror list items require an initial paragraph. markdown-it emits
      // none for `-` / `1.` (and for a nested block with no prose), so the DOM
      // parser inserts an empty textblock that `textBetween` separates.
      if (!next || next.type !== "paragraph_open") blocks.push("");
    }
    // tiptap-markdown marks an entire bullet list as a task list when any item
    // is a task. If the first direct item is regular, ProseMirror repairs the
    // incompatible taskList -> listItem structure by inserting one empty task
    // paragraph before splitting the regular/task runs. Account for that real
    // rendered textblock so Source and rendered character counts stay exact.
    if (
      token.type === "bullet_list_open" &&
      token.attrs?.some(([name, value]) => name === "class" && value.includes("contains-task-list"))
    ) {
      const listLevel = token.level ?? 0;
      const firstItem = tokens
        .slice(index + 1)
        .find((candidate) => candidate.type === "list_item_open" && candidate.level === listLevel + 1);
      const firstItemIsTask = firstItem?.attrs?.some(
        ([name, value]) => name === "class" && value.includes("task-list-item"),
      );
      if (firstItem && !firstItemIsTask) blocks.push("");
    }
    if (token.type === "inline") {
      blocks.push(visibleInlineText(token.children ?? []));
    } else if (token.type === "fence" || token.type === "code_block") {
      blocks.push(token.content.endsWith("\n") ? token.content.slice(0, -1) : token.content);
    }
  }
  return computeTextStats(blocks.join("\n"));
}

/**
 * Tokenize Markdown without mutating the live editor, then count the textblocks
 * that the same configured parser would expose in rendered mode. This avoids
 * the parser's Markdown -> HTML -> DOM -> ProseMirror conversion, which blocked
 * the main thread for hundreds of milliseconds on large Source documents.
 * Frontmatter is excluded because it lives outside the ProseMirror document.
 *
 * `null` is fail-safe: a parser failure must not mutate source content or
 * invent a misleading baseline.
 */
export function computeMarkdownTextStats(editor: Editor, markdown: string): TextStats | null {
  try {
    const parser = editor.storage.markdown.parser as unknown as {
      md?: { parse: (source: string, env: Record<string, unknown>) => MarkdownStatsToken[] };
    };
    if (!parser.md) return null;
    const { body } = splitFrontmatter(markdown);
    return computeMarkdownTokenTextStats(parser.md.parse(body, {}));
  } catch {
    return null;
  }
}
