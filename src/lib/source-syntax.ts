import { common, createLowlight } from "lowlight";
import { splitFrontmatter } from "./frontmatter";
const highlighter = createLowlight({ markdown: common.markdown!, yaml: common.yaml! });
export interface SyntaxSpan { start: number; end: number; className: string }
interface HighlightNode { type: string; value?: string; properties?: { className?: string[] }; children?: HighlightNode[] }
/** Lowlight returns a syntax tree, never trusted HTML. Offsets refer to the
 * exact raw textarea text, so coloring cannot alter editing or search ranges. */
export function sourceSyntax(text: string): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  let offset = 0;
  const walk = (node: HighlightNode, inherited = "") => {
    const classes = [inherited, ...(node.properties?.className ?? [])].filter(Boolean).join(" ");
    if (node.type === "text") {
      const end = offset + (node.value?.length ?? 0);
      if (end > offset) spans.push({ start: offset, end, className: classes });
      offset = end;
    } else node.children?.forEach(child => walk(child, classes));
  };
  const { frontmatter, body } = splitFrontmatter(text);
  if (frontmatter) walk(highlighter.highlight("yaml", frontmatter));
  walk(highlighter.highlight("markdown", body));
  return spans;
}
