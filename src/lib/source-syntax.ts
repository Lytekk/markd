import { common, createLowlight } from "lowlight";
import { splitFrontmatter } from "./frontmatter";
const highlighter = createLowlight({ markdown: common.markdown!, yaml: common.yaml! });
export interface SyntaxSpan { start: number; end: number; className: string }
// Markdown's grammar calls link labels "string". Keep language-specific roles
// separate so labels do not inherit code/YAML string colors.
const markdownRoles: Record<string, string> = {
  "hljs-section": "source-heading",
  "hljs-strong": "source-strong",
  "hljs-emphasis": "source-emphasis",
  "hljs-code": "source-code",
  "hljs-string": "source-link-label",
  "hljs-link": "source-link-url",
  "hljs-symbol": "source-link-url",
  "hljs-bullet": "source-list",
  "hljs-quote": "source-quote",
};
interface HighlightNode { type: string; value?: string; properties?: { className?: string[] }; children?: HighlightNode[] }
/** Lowlight returns a syntax tree, never trusted HTML. Offsets refer to the
 * exact raw textarea text, so coloring cannot alter editing or search ranges. */
export function sourceSyntax(text: string): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  let offset = 0;
  const walk = (node: HighlightNode, markdown: boolean, inherited = "") => {
    const scopes = node.properties?.className ?? [];
    const roles = markdown ? scopes.map(scope => markdownRoles[scope]).filter(Boolean) : [];
    const classes = [inherited, ...scopes, ...roles].filter(Boolean).join(" ");
    if (node.type === "text") {
      const end = offset + (node.value?.length ?? 0);
      if (end > offset) spans.push({ start: offset, end, className: classes });
      offset = end;
    } else node.children?.forEach(child => walk(child, markdown, classes));
  };
  const { frontmatter, body } = splitFrontmatter(text);
  if (frontmatter) walk(highlighter.highlight("yaml", frontmatter), false);
  walk(highlighter.highlight("markdown", body), true);
  return spans;
}
