import MarkdownIt from "markdown-it";
// markdown-it-task-lists does not publish TypeScript declarations.
// @ts-expect-error untyped CommonJS plugin with a stable markdown-it signature
import taskListPlugin from "markdown-it-task-lists";
import markdownItKatex from "@vscode/markdown-it-katex";
import { splitFrontmatter } from "./frontmatter";
import {
  computeMarkdownTokenTextStats,
  type MarkdownStatsToken,
  type TextStats,
} from "./text-stats";

type MarkdownPlugin = Parameters<MarkdownIt["use"]>[0];

// Match App's tiptap-markdown tokenizer. Rendering customizations are not
// needed here: stats consume tokens, not HTML. The two tokenizing plugins are
// load-bearing for task-list marker removal and math atom exclusion.
const parser = new MarkdownIt({ html: true, linkify: false, breaks: false });
parser.use(taskListPlugin as MarkdownPlugin);
const katexPlugin =
  (markdownItKatex as unknown as { default?: unknown }).default ?? markdownItKatex;
parser.use(katexPlugin as MarkdownPlugin);

/** Standalone, DOM-free parser used by the Source stats Web Worker. */
export function computeStandaloneMarkdownTextStats(markdown: string): TextStats {
  const { body } = splitFrontmatter(markdown);
  return computeMarkdownTokenTextStats(parser.parse(body, {}) as MarkdownStatsToken[]);
}
