import { parser, GFM } from "@lezer/markdown";
import { common, createLowlight } from "lowlight";
import { splitFrontmatter } from "./frontmatter";

const markdownParser = parser.configure(GFM);
const yamlHighlighter = createLowlight({ yaml: common.yaml! });
export interface SyntaxSpan { start: number; end: number; className: string }
interface HighlightNode { type: string; value?: string; properties?: { className?: string[] }; children?: HighlightNode[] }

const roles: Record<string, string> = {
  StrongEmphasis: "hljs-strong source-strong",
  Emphasis: "hljs-emphasis source-emphasis",
  Strikethrough: "source-emphasis",
  InlineCode: "hljs-code source-code",
  FencedCode: "hljs-code source-code",
  CodeBlock: "hljs-code source-code",
  Blockquote: "source-quote",
  ListMark: "source-list",
  TaskMarker: "source-list",
  Link: "source-link-label",
  Image: "source-link-label",
  LinkLabel: "source-link-label",
  URL: "source-link-url",
  LinkTitle: "source-link-url",
};

/** Parse Markdown into source-positioned syntax nodes. Code, escapes and
 * emphasis delimiters follow Markdown boundaries, including inside quotes and
 * headings. Coloring never changes the original text or relies on rendered HTML. */
export function sourceSyntax(text: string): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  const emit = (start: number, end: number, className: string) => {
    if (end <= start) return;
    const previous = spans[spans.length - 1];
    if (previous?.end === start && previous.className === className) previous.end = end;
    else spans.push({ start, end, className });
  };
  const { frontmatter, body } = splitFrontmatter(text);
  let offset = 0;
  const walkYaml = (node: HighlightNode, inherited = "") => {
    const classes = [inherited, ...(node.properties?.className ?? [])].filter(Boolean).join(" ");
    if (node.type === "text") {
      const end = offset + (node.value?.length ?? 0);
      emit(offset, end, classes);
      offset = end;
    } else node.children?.forEach(child => walkYaml(child, classes));
  };
  if (frontmatter) walkYaml(yamlHighlighter.highlight("yaml", frontmatter));

  const prefix = frontmatter.length;
  const cursor = markdownParser.parse(body).cursor();
  const walkMarkdown = (inherited: string): void => {
    const name = cursor.name;
    const role = /^(ATX|Setext)Heading[1-6]$/.test(name) ? "hljs-section source-heading" : roles[name];
    let classes = [inherited, role].filter(Boolean).join(" ");
    // Brackets and parentheses stay neutral; label and URL content are distinct.
    if (name === "LinkMark") classes = inherited.split(" ").filter(c => c !== "source-link-label").join(" ");
    let from = cursor.from;
    const end = cursor.to;
    // Code is opaque: its backticks, wildcards and underscores are not markup.
    if (!['InlineCode', 'FencedCode', 'CodeBlock'].includes(name) && cursor.firstChild()) {
      do {
        emit(prefix + from, prefix + cursor.from, classes);
        walkMarkdown(classes);
        from = cursor.to;
      } while (cursor.nextSibling());
      cursor.parent();
    }
    emit(prefix + from, prefix + end, classes);
  };
  walkMarkdown("");
  return spans;
}
